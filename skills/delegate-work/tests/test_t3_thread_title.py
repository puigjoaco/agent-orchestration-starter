"""t3_thread_title prints the title of the thread the user is working in."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/t3_thread_title.py"
spec = importlib.util.spec_from_file_location("t3_thread_title", SCRIPT)
ttt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ttt)

THREADS = {
    "user": {"title": "  PR  automatico\n", "parentThreadId": None, "relationshipToParent": None},
    "worker": {"title": "Worker", "parentThreadId": "user", "relationshipToParent": "subagent"},
    "chrome": {"title": "Chrome task", "parentThreadId": "worker", "relationshipToParent": "subagent"},
    "launched": {"title": "Own thread", "parentThreadId": "user", "relationshipToParent": "handoff"},
    "loop": {"title": "Loop", "parentThreadId": "loop", "relationshipToParent": "subagent"},
    "untitled": {"title": None, "parentThreadId": None},
}


def title(thread_id):
    env = {"T3CODE_THREAD_ID": thread_id, "T3CODE_CLI_PATH": "t3"}
    return ttt.user_thread_title(env, lambda cli, wanted: THREADS[wanted])


class ThreadTitleTest(unittest.TestCase):
    def test_subagents_report_the_thread_that_started_them(self):
        self.assertEqual(title("user"), "PR automatico")
        self.assertEqual(title("worker"), "PR automatico")
        self.assertEqual(title("chrome"), "PR automatico")

    def test_a_thread_that_is_not_a_subagent_keeps_its_own_title(self):
        self.assertEqual(title("launched"), "Own thread")

    def test_no_title_outside_t3_or_without_an_answer(self):
        self.assertIsNone(ttt.user_thread_title({}, lambda *args: self.fail("no lookup outside T3")))
        self.assertIsNone(title("loop"))
        self.assertIsNone(title("untitled"))

    def run_script(self, cli_body):
        with tempfile.TemporaryDirectory() as temp:
            cli = Path(temp) / "t3"
            cli.write_text(f"#!/bin/sh\n{cli_body}\n")
            cli.chmod(0o755)
            env = {**os.environ, "T3CODE_THREAD_ID": "chrome", "T3CODE_CLI_PATH": str(cli)}
            return subprocess.run([sys.executable, str(SCRIPT)], env=env, capture_output=True, text=True, timeout=30)

    def test_script_prints_only_the_title(self):
        answers = "\n".join(f'  {name}) cat <<\'JSON\'\n{json.dumps({"thread": thread})}\nJSON\n;;'
                            for name, thread in THREADS.items())
        done = self.run_script(f'[ "$1 $2 $4 $5 $6" = "thread show --json --messages 0" ] || exit 9\ncase "$3" in\n{answers}\nesac')
        self.assertEqual((done.returncode, done.stdout, done.stderr), (0, "PR automatico\n", ""))

    def test_script_fails_quietly_when_the_cli_fails(self):
        done = self.run_script("echo private >&2; exit 3")
        self.assertEqual((done.returncode, done.stdout, done.stderr), (1, "", ""))


if __name__ == "__main__":
    unittest.main()
