"""open_agent_chrome finds the agents' profile and opens a window without printing Local State."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/open_agent_chrome.py"
spec = importlib.util.spec_from_file_location("open_agent_chrome", SCRIPT)
oac = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oac)

SECRET = "os-crypt-key-must-not-print"


class OpenAgentChromeTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.base = Path(temp.name)
        self.home = self.base / "home"
        self.bin = self.base / "bin"
        self.bin.mkdir()
        self.log = self.base / "launched"
        shim = self.bin / "google-chrome"
        shim.write_text(f'#!/bin/sh\nprintf "%s\\n" "$@" > "{self.log}"\n')
        shim.chmod(0o755)
        self.env = dict(os.environ, HOME=str(self.home), PATH=f"{self.bin}{os.pathsep}{os.environ['PATH']}")
        self.env.pop("CODEX_SANDBOX_NETWORK_DISABLED", None)

    def write_state(self, profiles, platform="linux"):
        path = self.home / (".config/google-chrome" if platform == "linux" else "Library/Application Support/Google/Chrome") / "Local State"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"os_crypt": {"encrypted_key": SECRET},
                                    "profile": {"info_cache": {d: {"name": n} for d, n in profiles.items()}}}))

    def run_script(self, *args):
        return subprocess.run([sys.executable, str(SCRIPT), *args], env=self.env, text=True, capture_output=True)

    def wait_for_log(self):
        for _ in range(50):
            if self.log.exists() and self.log.read_text():
                return self.log.read_text().splitlines()
            time.sleep(0.05)
        self.fail("google-chrome was not started")

    @unittest.skipIf(sys.platform == "darwin", "Linux launcher")
    def test_opens_window_in_named_profile(self):
        self.write_state({"Default": "Personal", "Profile 1": "Agent Use"})
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "opened Profile 1\n")
        self.assertEqual(self.wait_for_log(), ["--profile-directory=Profile 1"])
        self.assertNotIn(SECRET, result.stdout + result.stderr)

    @unittest.skipIf(sys.platform == "darwin", "Linux paths")
    def test_print_dir_and_name_override_do_not_launch(self):
        self.write_state({"Default": "Personal", "Profile 3": "Bots"})
        result = self.run_script("--name", "Bots", "--print-dir")
        self.assertEqual((result.returncode, result.stdout), (0, "Profile 3\n"))
        time.sleep(0.2)
        self.assertFalse(self.log.exists())

    @unittest.skipIf(sys.platform == "darwin", "Linux paths")
    def test_missing_or_duplicate_profile_exits_two_without_launch(self):
        for profiles in ({"Default": "Personal"}, {"Profile 1": "Agent Use", "Profile 2": "Agent Use"}):
            self.write_state(profiles)
            result = self.run_script()
            self.assertEqual(result.returncode, 2)
            self.assertIn("create or select the agent profile", result.stderr)
            self.assertNotIn(SECRET, result.stdout + result.stderr)
        self.assertFalse(self.log.exists())

    @unittest.skipIf(sys.platform == "darwin", "Linux sandbox")
    def test_sandboxed_session_refuses_to_launch(self):
        self.write_state({"Default": "Personal", "Profile 1": "Agent Use"})
        self.env["CODEX_SANDBOX_NETWORK_DISABLED"] = "1"
        result = self.run_script()
        self.assertEqual(result.returncode, oac.SANDBOX_EXIT)
        self.assertIn("ask the orchestrator", result.stderr)
        self.assertEqual(self.run_script("--print-dir").stdout, "Profile 1\n")
        time.sleep(0.2)
        self.assertFalse(self.log.exists())

    def test_unreadable_local_state_exits_one(self):
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertIn("FileNotFoundError", result.stderr)

    def test_macos_paths_and_command(self):
        self.assertEqual(oac.open_command("Profile 2", "darwin"),
                         ["open", "-na", "Google Chrome", "--args", "--profile-directory=Profile 2"])
        self.assertEqual(oac.open_command("Profile 2", "linux"),
                         ["google-chrome", "--profile-directory=Profile 2"])
        old_home = os.environ.get("HOME")
        os.environ["HOME"] = str(self.home)
        self.addCleanup(lambda: os.environ.__setitem__("HOME", old_home) if old_home else os.environ.pop("HOME"))
        self.write_state({"Profile 2": "Agent Use"}, platform="darwin")
        self.assertEqual(oac.profile_dir("Agent Use", "darwin"), "Profile 2")


if __name__ == "__main__":
    unittest.main()
