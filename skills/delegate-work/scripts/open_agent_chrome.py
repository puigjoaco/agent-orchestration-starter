#!/usr/bin/env python3
"""Open a window in the agents' Chrome profile, in the running Chrome or a new one.

Chrome extensions run only while their profile has a window open, so an agent
that can't see the "Agent Use" profile opens a window there. This never
restarts or closes Chrome. Prints only the profile directory; Local State
holds other data that must not be printed.
"""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

DEFAULT_NAME = "Agent Use"
SANDBOX_EXIT = 3  # agent-chrome.mjs reads this exit code


def local_state_path(platform: str = sys.platform) -> Path:
    if platform == "darwin":
        return Path.home() / "Library/Application Support/Google/Chrome/Local State"
    return Path.home() / ".config/google-chrome/Local State"


def profile_dir(name: str, platform: str = sys.platform) -> str:
    """Return the profile directory named `name`; raise LookupError if none matches."""
    with open(local_state_path(platform), encoding="utf-8") as handle:
        cache = json.load(handle).get("profile", {}).get("info_cache", {})
    matches = sorted(d for d, info in cache.items() if isinstance(info, dict) and info.get("name") == name)
    if len(matches) != 1:
        raise LookupError(f"{len(matches)} Chrome profiles named {name!r}")
    return matches[0]


def open_command(directory: str, platform: str = sys.platform) -> list:
    if platform == "darwin":
        # -n passes the arguments on even when Chrome is running; Chrome then
        # hands them to the running browser, which opens the window.
        return ["open", "-na", "Google Chrome", "--args", f"--profile-directory={directory}"]
    return ["google-chrome", f"--profile-directory={directory}"]


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--name", default=DEFAULT_NAME, help="profile name (default: %(default)s)")
    parser.add_argument("--print-dir", action="store_true", help="print the profile directory without opening a window")
    args = parser.parse_args(argv)
    try:
        directory = profile_dir(args.name)
    except LookupError as error:
        print(f"no single Chrome profile named {args.name!r} ({error}); create or select the agent profile", file=sys.stderr)
        return 2
    except (OSError, ValueError) as error:
        print(f"can't read Chrome's profile list: {type(error).__name__}", file=sys.stderr)
        return 1
    if args.print_dir:
        print(directory)
        return 0
    if sys.platform != "darwin" and os.environ.get("CODEX_SANDBOX_NETWORK_DISABLED"):
        # Chrome started inside Codex's Linux sandbox crashes on launch.
        print("this session is sandboxed and cannot start Chrome; ask the orchestrator to run this command from its own shell",
              file=sys.stderr)
        return SANDBOX_EXIT
    try:
        subprocess.Popen(open_command(directory), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, start_new_session=True)
    except OSError as error:
        print(f"can't start Chrome: {error}", file=sys.stderr)
        return 1
    print(f"opened {directory}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
