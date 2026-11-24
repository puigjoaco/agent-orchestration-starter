#!/usr/bin/env python3
"""Print the title of the T3 thread the user is working in.

A Chrome worker names its session with it, so the Chrome tab group shows which
thread owns it. A subagent thread reports the thread that started it, however
deep. Prints nothing and exits 1 outside T3 or when the title cannot be read.
"""

import json
import os
import subprocess
import sys

MAX_DEPTH = 10


def read_thread(cli: str, thread_id: str) -> dict:
    result = subprocess.run([cli, "thread", "show", thread_id, "--json", "--messages", "0"],
                            capture_output=True, text=True, timeout=30, check=True)
    return json.loads(result.stdout)["thread"]


def user_thread_title(env=os.environ, read=read_thread):
    """Return the title of the nearest thread that is not a subagent, or None."""
    thread_id, cli = env.get("T3CODE_THREAD_ID"), env.get("T3CODE_CLI_PATH")
    if not thread_id or not cli:
        return None
    for _ in range(MAX_DEPTH):
        thread = read(cli, thread_id)
        parent = thread.get("parentThreadId")
        if not parent or thread.get("relationshipToParent") != "subagent":
            title = thread.get("title")
            return " ".join(title.split()) or None if isinstance(title, str) else None
        thread_id = parent
    return None


def main() -> int:
    try:
        title = user_thread_title()
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError, AttributeError):
        title = None
    if not title:
        return 1
    print(title)
    return 0


if __name__ == "__main__":
    sys.exit(main())
