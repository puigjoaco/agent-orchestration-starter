"""Installer tests use a fixture repository and a throwaway HOME with spaces."""
import os
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ('delegate-work', 'review-fix-loop')
AGENTS = ('scout', 'worker', 'designer', 'advisor', 'reviewer')


class InstallTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        self.repo = self.base / 'fixture repo'
        self.repo.mkdir()
        shutil.copy2(ROOT / 'install.sh', self.repo / 'install.sh')
        shutil.copytree(ROOT / 'hooks', self.repo / 'hooks', ignore=shutil.ignore_patterns('__pycache__'))
        self.write_repo('instructions/CLAUDE.md', 'fixture instructions\n')
        for agent in AGENTS:
            self.write_repo(f'agents/{agent}.md', f'{agent}\n')
        for skill in SKILLS:
            self.write_repo(f'skills/{skill}/SKILL.md', f'{skill}\n')
        self.write_repo('bin/heavy', '#!/bin/sh\nexec "$@"\n')
        self.home = self.base / 'home with spaces'
        self.home.mkdir()
        self.env = dict(os.environ, HOME=str(self.home))

    def write_repo(self, relative, text):
        target = self.repo / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
        return target

    def install(self, *flags, script=None, ok=True):
        result = subprocess.run(
            ['/bin/bash', str(script or self.repo / 'install.sh'), *flags],
            env=self.env, text=True, capture_output=True, timeout=20)
        if ok:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout)
        return result

    def assert_link(self, relative, source):
        link = self.home / relative
        self.assertTrue(link.is_symlink(), link)
        self.assertEqual(os.readlink(link), str(self.repo / source))

    def test_default_links_and_idempotency(self):
        self.install()
        self.assert_link('.claude/CLAUDE.md', 'instructions/CLAUDE.md')
        for agent in AGENTS:
            self.assert_link(f'.claude/agents/{agent}.md', f'agents/{agent}.md')
        for skill in SKILLS:
            self.assert_link(f'.claude/skills/{skill}', f'skills/{skill}')
        self.assertFalse((self.home / '.agents').exists())
        self.assertFalse((self.home / '.codex').exists())
        self.assertFalse((self.home / '.local').exists())
        rerun = self.install()
        self.assertEqual(len(rerun.stdout.splitlines()), 8)
        self.assertTrue(all(line.startswith('ok ') for line in rerun.stdout.splitlines()))
        self.assertEqual(list(self.home.rglob('*.bak-*')), [])

    def test_file_and_directory_backups(self):
        conflict = self.home / '.claude/CLAUDE.md'
        conflict.parent.mkdir()
        conflict.write_text('keep file')
        directory = self.home / '.claude/skills/delegate-work'
        directory.mkdir(parents=True)
        (directory / 'old').write_text('keep directory')
        self.install()
        self.assert_link('.claude/CLAUDE.md', 'instructions/CLAUDE.md')
        self.assert_link('.claude/skills/delegate-work', 'skills/delegate-work')
        backups = list(conflict.parent.glob('CLAUDE.md.bak-*'))
        self.assertEqual(len(backups), 1)
        self.assertRegex(backups[0].name, r'^CLAUDE\.md\.bak-\d{8}-\d{6}$')
        self.assertEqual(backups[0].read_text(), 'keep file')
        saved_directory = list(directory.parent.glob('delegate-work.bak-*'))
        self.assertEqual(len(saved_directory), 1)
        self.assertEqual((saved_directory[0] / 'old').read_text(), 'keep directory')
        self.install()
        self.assertEqual(len(list(conflict.parent.glob('CLAUDE.md.bak-*'))), 1)

    def test_dry_run_changes_nothing(self):
        conflict = self.home / '.claude/CLAUDE.md'
        conflict.parent.mkdir()
        conflict.write_text('keep file')
        before = sorted(str(path.relative_to(self.home)) for path in self.home.rglob('*'))
        result = self.install('--dry-run', '--codex', '--with-heavy')
        self.assertIn('would back up', result.stdout)
        self.assertIn('would link', result.stdout)
        self.assertEqual(conflict.read_text(), 'keep file')
        after = sorted(str(path.relative_to(self.home)) for path in self.home.rglob('*'))
        self.assertEqual(before, after)
        self.assertFalse((self.home / '.agents').exists())

    def test_optional_links(self):
        settings = self.home / '.claude/settings.json'
        settings.parent.mkdir()
        settings.write_text('{"keep": true}\n')
        self.install('--codex', '--with-heavy')
        for skill in SKILLS:
            self.assert_link(f'.agents/skills/{skill}', f'skills/{skill}')
        self.assert_link('.codex/AGENTS.md', 'instructions/CLAUDE.md')
        self.assert_link('.local/bin/heavy', 'bin/heavy')
        self.assertEqual(settings.read_text(), '{"keep": true}\n')

    def test_dry_run_does_not_create_home(self):
        self.home.rmdir()
        self.install('--dry-run')
        self.assertFalse(self.home.exists())

    def test_discovers_additional_skills(self):
        self.write_repo('skills/extra skill/SKILL.md', 'extra\n')
        self.write_repo('skills/not-a-skill/README.md', 'ignore\n')
        self.install('--codex')
        self.assert_link('.claude/skills/extra skill', 'skills/extra skill')
        self.assert_link('.agents/skills/extra skill', 'skills/extra skill')
        self.assertFalse((self.home / '.claude/skills/not-a-skill').exists())

    def test_missing_source_aborts_before_touching_home(self):
        for relative, flags in (
            ('instructions/CLAUDE.md', ()),
            ('agents/reviewer.md', ()),
            ('bin/heavy', ('--with-heavy',)),
        ):
            with self.subTest(relative=relative):
                source = self.repo / relative
                content = source.read_text()
                source.unlink()
                result = self.install(*flags, ok=False)
                self.assertIn('Missing repo item', result.stderr)
                self.assertEqual(list(self.home.iterdir()), [])
                source.write_text(content)

    def test_no_skills_aborts_before_touching_home(self):
        shutil.rmtree(self.repo / 'skills')
        self.install(ok=False)
        self.assertEqual(list(self.home.iterdir()), [])

    def test_replaces_directory_symlink_without_descending(self):
        target = self.base / 'untouched'
        target.mkdir()
        sentinel = target / 'sentinel'
        sentinel.write_text('safe')
        link = self.home / '.claude/skills/delegate-work'
        link.parent.mkdir(parents=True)
        link.symlink_to(target, target_is_directory=True)
        self.install()
        self.assertEqual(list(target.iterdir()), [sentinel])
        self.assertEqual(sentinel.read_text(), 'safe')
        self.assert_link('.claude/skills/delegate-work', 'skills/delegate-work')

    def test_replaces_dangling_symlink(self):
        link = self.home / '.claude/CLAUDE.md'
        link.parent.mkdir()
        link.symlink_to(self.base / 'missing')
        self.install()
        self.assert_link('.claude/CLAUDE.md', 'instructions/CLAUDE.md')

    def test_refuses_parent_symlink_before_any_writes(self):
        target = self.base / 'untouched'
        target.mkdir()
        (self.home / '.claude').symlink_to(target, target_is_directory=True)
        result = self.install(ok=False)
        self.assertIn('parent symlink', result.stderr)
        self.assertEqual(list(target.iterdir()), [])
        self.assertEqual(list(self.home.iterdir()), [self.home / '.claude'])

    def test_install_through_relative_symlink(self):
        entry = self.base / 'entry'
        entry.symlink_to(os.path.relpath(self.repo / 'install.sh', entry.parent))
        self.install(script=entry)
        self.assert_link('.claude/CLAUDE.md', 'instructions/CLAUDE.md')

    def test_no_gnu_only_link_flags(self):
        binary = self.base / 'commands'
        binary.mkdir()
        for command in ('ln', 'mv', 'readlink'):
            real = shutil.which(command)
            self.assertIsNotNone(real)
            shim = binary / command
            shim.write_text(
                '#!/bin/sh\nfor arg do\n'
                'case "$arg" in -*T*|-f) exit 97;; esac\ndone\n'
                f'exec "{real}" "$@"\n')
            shim.chmod(0o755)
        self.env['PATH'] = str(binary) + os.pathsep + self.env['PATH']
        self.install()

    def test_link_failure_restores_backup(self):
        binary = self.base / 'commands'
        binary.mkdir()
        shim = binary / 'ln'
        shim.write_text('#!/bin/sh\nexit 1\n')
        shim.chmod(0o755)
        self.env['PATH'] = str(binary) + os.pathsep + self.env['PATH']
        target = self.home / '.claude/CLAUDE.md'
        target.parent.mkdir()
        target.write_text('restore me')
        self.install(ok=False)
        self.assertEqual(target.read_text(), 'restore me')
        self.assertEqual(list(target.parent.glob('*.bak-*')), [])
        self.assertEqual(list(target.parent.glob('*.link-*')), [])

    def test_unknown_option_changes_nothing(self):
        result = self.install('--unknown', ok=False)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(list(self.home.iterdir()), [])

    def test_t3_installs_instructions_and_merges_hooks(self):
        settings = self.home / '.claude/settings.json'
        settings.parent.mkdir()
        existing = {'env': {'KEEP': 'yes'}, 'hooks': {'Stop': [{'hooks': [
            {'type': 'command', 'command': 'custom-hook'}]}]}}
        settings.write_text(json.dumps(existing))
        self.install('--t3')
        self.assert_link('.t3/codex-home/AGENTS.md', 'instructions/CLAUDE.md')
        self.assert_link('.agents/skills/delegate-work', 'skills/delegate-work')
        for hook in ('background_job_guard.py', 'orchestration_mode.py', 'signin_handoff_check.py'):
            self.assert_link(f'.claude/hooks/{hook}', f'hooks/{hook}')
        data = json.loads(settings.read_text())
        self.assertEqual(data['env'], existing['env'])
        self.assertEqual(data['hooks']['Stop'][0], existing['hooks']['Stop'][0])
        self.assertEqual(len(data['hooks']['Stop']), 2)
        self.assertIn("'", data['hooks']['Stop'][1]['hooks'][0]['command'])
        for relative in ('.codex/hooks.json', '.t3/codex-home/hooks.json'):
            self.assertEqual(len(json.loads((self.home / relative).read_text())['hooks']['Stop']), 1)
        backup = list(settings.parent.glob('settings.json.bak-*'))
        self.assertEqual(len(backup), 1)
        self.assertEqual(json.loads(backup[0].read_text()), existing)
        before = settings.read_bytes()
        self.install('--t3')
        self.assertEqual(settings.read_bytes(), before)
        self.assertEqual(list(settings.parent.glob('settings.json.bak-*')), backup)

    def test_hooks_are_opt_in(self):
        self.install('--with-hooks')
        self.assertTrue((self.home / '.claude/settings.json').exists())
        self.assertFalse((self.home / '.codex').exists())
        self.assertFalse((self.home / '.t3').exists())

    def test_t3_dry_run_writes_nothing(self):
        result = self.install('--t3', '--dry-run')
        self.assertIn('would merge hooks', result.stdout)
        self.assertEqual(list(self.home.iterdir()), [])

    def test_invalid_config_aborts_before_any_links(self):
        settings = self.home / '.claude/settings.json'
        settings.parent.mkdir()
        for text in ('{broken', '[]', '{"hooks": []}', '{"hooks": {"Stop": {}}}'):
            settings.write_text(text)
            self.install('--t3', ok=False)
            self.assertEqual(settings.read_text(), text)
            self.assertEqual(list(self.home.rglob('*')), [settings.parent, settings])

    def test_config_symlinks_and_parent_symlinks_are_refused(self):
        external = self.base / 'external'
        external.mkdir()
        saved = external / 'saved.json'
        saved.write_text('{}')
        settings = self.home / '.claude/settings.json'
        settings.parent.mkdir()
        settings.symlink_to(saved)
        self.install('--t3', ok=False)
        self.assertEqual(saved.read_text(), '{}')
        self.assertFalse((self.home / '.agents').exists())
        settings.unlink()
        (self.home / '.t3').symlink_to(external)
        self.install('--t3', ok=False)
        self.assertEqual(list(external.iterdir()), [saved])
        self.assertFalse((self.home / '.agents').exists())

    def test_hook_source_preflight(self):
        (self.repo / 'hooks/codex-hooks.json').unlink()
        self.install('--t3', ok=False)
        self.assertEqual(list(self.home.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
