import argparse
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import urllib.error
import zipfile

spec = importlib.util.spec_from_file_location('candidate', Path(__file__).with_name('verify-existing-mac-candidate.py'))
candidate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(candidate)


class CandidateVerificationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        self.args = argparse.Namespace(run_id='17', artifact_id='23', candidate_sha='a' * 40,
                                      harness_sha='b' * 40, version='0.4.35', archive_sha256='c' * 64)
        self.run = {'id': 17, 'repository': {'id': 1, 'full_name': candidate.REPO},
                    'head_repository': {'full_name': candidate.REPO}, 'path': candidate.WORKFLOW,
                    'event': 'workflow_dispatch', 'status': 'completed', 'conclusion': 'success',
                    'head_sha': self.args.candidate_sha}
        self.artifact = {'id': 23, 'expired': False, 'name': 'doodlenote-mac-' + 'a' * 40,
                         'digest': 'sha256:' + 'c' * 64, 'size_in_bytes': 123,
                         'workflow_run': {'id': 17, 'head_sha': 'a' * 40,
                                          'repository_id': 1, 'head_repository_id': 1}}

    def test_inputs_reject_injection_and_moving_refs(self):
        candidate.validate_inputs(self.args)
        for key, value in [('run_id', '../17'), ('artifact_id', '0'), ('candidate_sha', 'main'),
                           ('harness_sha', '$(command)'), ('version', '../0.4.35'),
                           ('archive_sha256', 'c' * 63)]:
            with self.subTest(key=key):
                changed = copy.copy(self.args)
                setattr(changed, key, value)
                with self.assertRaises(ValueError):
                    candidate.validate_inputs(changed)

    def test_metadata_binds_successful_run_repo_and_source(self):
        candidate.validate_metadata(self.args, self.run, self.artifact)
        for key, value in [('id', 18), ('path', '.github/workflows/ci.yml'),
                           ('head_repository', {'full_name': 'attacker/fork'}),
                           ('repository', {'id': 1, 'full_name': 'attacker/fork'}),
                           ('event', 'pull_request'), ('conclusion', 'failure'),
                           ('status', 'in_progress'), ('head_sha', 'd' * 40)]:
            with self.subTest(key=key):
                changed = {**self.run, key: value}
                with self.assertRaises(ValueError):
                    candidate.validate_metadata(self.args, changed, self.artifact)

    def test_artifact_provenance_expiry_size_and_digest(self):
        for key, value in [('id', 24), ('expired', True), ('name', 'latest'),
                           ('digest', 'sha256:' + 'd' * 64), ('size_in_bytes', 0),
                           ('size_in_bytes', candidate.MAX_ARCHIVE + 1),
                           ('workflow_run', {**self.artifact['workflow_run'], 'id': 18}),
                           ('workflow_run', {**self.artifact['workflow_run'], 'head_sha': 'd' * 40}),
                           ('workflow_run', {**self.artifact['workflow_run'], 'head_repository_id': 99})]:
            with self.subTest(key=key, value=value):
                with self.assertRaises(ValueError):
                    candidate.validate_metadata(self.args, self.run, {**self.artifact, key: value})

    def archive(self, entries):
        target = self.root / 'test.zip'
        with zipfile.ZipFile(target, 'w') as archive:
            for name, content in entries:
                archive.writestr(name, content)
        return target

    def test_outer_archive_validates_all_members_before_any_extraction(self):
        names = candidate.payload_names(self.args.version)
        archive = self.archive([(name, name.encode()) for name in names])
        candidate.extract_outer(archive, self.root / 'good', self.args.version)
        self.assertEqual({p.name for p in (self.root / 'good').iterdir()}, names)
        for bad in ('../outside', '/absolute', 'sub/../../outside', 'sub\\outside', 'extra'):
            archive = self.archive([(name, b'good') for name in names] + [(bad, b'bad')])
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                candidate.extract_outer(archive, self.root / 'unsafe', self.args.version)
            self.assertFalse((self.root / 'unsafe').exists())

    def test_missing_duplicate_and_special_outer_members(self):
        names = candidate.payload_names(self.args.version)
        for entries in ([('latest-mac.yml', b'missing')],
                        [(name, b'x') for name in names] + [('LATEST-MAC.YML', b'collision')]):
            archive = self.archive(entries)
            with zipfile.ZipFile(archive) as z, self.assertRaises(ValueError):
                candidate.inspect_zip(z, names)
        for kind in (stat.S_IFLNK, stat.S_IFIFO):
            member = zipfile.ZipInfo('latest-mac.yml')
            member.external_attr = (kind | 0o644) << 16
            archive = self.archive([(member, b'target')])
            with zipfile.ZipFile(archive) as z, self.assertRaises(ValueError):
                candidate.inspect_zip(z, names)

    def test_inner_framework_links_allowed_but_traversal_and_link_writes_rejected(self):
        member = zipfile.ZipInfo('DoodleNote.app/Framework/Current')
        member.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive = self.archive([(member, b'A'), ('DoodleNote.app/Framework/A/file', b'fixture')])
        with zipfile.ZipFile(archive) as z:
            candidate.inspect_zip(z)
        for target, extra in [(b'../../../escape', []), (b'/tmp/escape', []),
                              (b'A', [('DoodleNote.app/Framework/Current/file', b'bad')])]:
            archive = self.archive([(member, target)] + extra)
            with zipfile.ZipFile(archive) as z, self.assertRaises(ValueError):
                candidate.inspect_zip(z)

    def test_expansion_limit(self):
        archive = self.archive([('DoodleNote.app/large', b'1234')])
        with patch.object(candidate, 'MAX_EXPANDED', 3), zipfile.ZipFile(archive) as z:
            with self.assertRaisesRegex(ValueError, 'expands'):
                candidate.inspect_zip(z)

    def receipt(self):
        lines = ['Source commit: ' + self.args.candidate_sha, 'Version: ' + self.args.version,
                 'Signing team: ' + candidate.TEAM,
                 'Verified app/ZIP/DMG payloads, signatures, tickets, Gatekeeper, version and manifest SHA-512 hashes.']
        for name in sorted(candidate.payload_names(self.args.version) - {'release-receipt.txt'}):
            file = self.root / name
            file.write_text(name)
            lines.append(candidate.digest(file) + '  /historical/runner/' + name)
        receipt = self.root / 'release-receipt.txt'
        receipt.write_text('\n'.join(lines) + '\n')
        return receipt

    def test_receipt_is_readonly_and_binds_payloads(self):
        receipt = self.receipt()
        before = receipt.read_bytes()
        self.assertEqual(len(candidate.verify_receipt(self.root, self.args)), 3)
        self.assertEqual(receipt.read_bytes(), before)
        (self.root / 'latest-mac.yml').write_text('tampered')
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            candidate.verify_receipt(self.root, self.args)

    def test_receipt_rejects_wrong_version_source_team_and_duplicate_payload(self):
        receipt = self.receipt()
        original = receipt.read_text()
        for old, new in [(self.args.candidate_sha, 'd' * 40), ('Version: 0.4.35', 'Version: 0.4.33'),
                         (candidate.TEAM, 'WRONGTEAM1')]:
            receipt.write_text(original.replace(old, new))
            with self.subTest(old=old), self.assertRaises(ValueError):
                candidate.verify_receipt(self.root, self.args)
        lines = original.splitlines(); lines[-1] = lines[-2]
        receipt.write_text('\n'.join(lines))
        with self.assertRaises(ValueError):
            candidate.verify_receipt(self.root, self.args)

    def test_download_hash_checked_and_bearer_not_forwarded(self):
        payload = b'immutable artifact bytes'
        self.args.archive_sha256 = hashlib.sha256(payload).hexdigest()
        redirect = urllib.error.HTTPError('https://api.github.com/redacted', 302, 'redirect',
                                         {'Location': 'https://storage.example/signed'}, None)
        with patch.object(candidate, 'api_request', side_effect=redirect), \
             patch.object(candidate.urllib.request, 'urlopen', return_value=io.BytesIO(payload)) as open_url:
            candidate.download(self.args, 'private-token', self.root / 'download.zip')
            open_url.assert_called_once_with('https://storage.example/signed', timeout=30)
        with patch.object(candidate, 'api_request', return_value=io.BytesIO(b'wrong')):
            with self.assertRaisesRegex(ValueError, 'digest mismatch'):
                candidate.download(self.args, 'private-token', self.root / 'bad.zip')

    def test_download_rejects_insecure_redirect_and_oversize(self):
        for location in ('http://storage.example/x', 'https://user:password@storage.example/x'):
            redirect = urllib.error.HTTPError('https://api.github.com/redacted', 302, 'redirect',
                                             {'Location': location}, None)
            with patch.object(candidate, 'api_request', side_effect=redirect), \
                 patch.object(candidate.urllib.request, 'urlopen') as fetch, self.assertRaises(ValueError):
                candidate.download(self.args, 'secret', self.root / 'bad.zip')
            fetch.assert_not_called()
        with patch.object(candidate, 'api_request', return_value=io.BytesIO(b'1234')), \
             patch.object(candidate, 'MAX_ARCHIVE', 3), self.assertRaisesRegex(ValueError, 'exceeds'):
            candidate.download(self.args, 'secret', self.root / 'large.zip')

    def test_runtime_env_excludes_all_inherited_secrets(self):
        with patch.dict(os.environ, {'GITHUB_TOKEN': 'private', 'APPLE_ID': 'private', 'BLOB_READ_WRITE_TOKEN': 'private'}):
            env = candidate.runtime_env(self.root)
        self.assertEqual(set(env), {'PATH', 'LANG', 'HOME', 'TMPDIR', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME'})
        self.assertTrue(Path(env['HOME']).is_relative_to(self.root))

    def test_timeout_kills_descendants_and_retains_failure_log(self):
        marker = self.root / 'must-not-exist'
        child_code = f'import time,pathlib; time.sleep(.5); pathlib.Path({str(marker)!r}).touch()'
        parent = 'import subprocess,sys,time; subprocess.Popen([sys.executable,"-c",' + repr(child_code) + ']); time.sleep(10)'
        with self.assertRaisesRegex(ValueError, 'timed out'):
            candidate.run([sys.executable, '-c', parent], self.root, candidate.runtime_env(self.root), timeout=.1)
        time.sleep(.6)
        self.assertFalse(marker.exists())
        self.assertIn('TIMEOUT', (self.root / 'commands.log').read_text())

    def redirected_descendant(self, exit_code, timeout=False):
        marker, pid_file = self.root / 'late-marker', self.root / 'child.pid'
        child = (f'import os,pathlib,time; pathlib.Path({str(pid_file)!r}).write_text(str(os.getpid())); '
                 f'time.sleep(.3); pathlib.Path({str(marker)!r}).touch(); time.sleep(30)')
        parent = ('import subprocess,sys,pathlib,time; '
                  f'subprocess.Popen([sys.executable,"-c",{child!r}], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); '
                  f'target=pathlib.Path({str(pid_file)!r});'
                  '\nwhile not target.exists(): time.sleep(.005)\n'
                  'print("parent diagnostic", flush=True)\n' +
                  ('time.sleep(30)' if timeout else f'raise SystemExit({exit_code})'))
        unrelated = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'],
                                     start_new_session=True)
        try:
            if timeout or exit_code:
                with self.assertRaisesRegex(ValueError, 'timed out' if timeout else 'Command failed'):
                    candidate.run([sys.executable, '-c', parent], self.root,
                                  candidate.runtime_env(self.root), timeout=.2 if timeout else 2)
            else:
                self.assertIn('parent diagnostic', candidate.run([sys.executable, '-c', parent],
                              self.root, candidate.runtime_env(self.root), timeout=2))
            time.sleep(.4)
            self.assertFalse(marker.exists(), 'Owned child wrote after run returned')
            with self.assertRaises(ProcessLookupError):
                os.kill(int(pid_file.read_text()), 0)
            self.assertIsNone(unrelated.poll(), 'Unrelated process was terminated')
            self.assertIn('parent diagnostic', (self.root / 'commands.log').read_text())
        finally:
            if pid_file.exists():
                try: os.kill(int(pid_file.read_text()), signal.SIGKILL)
                except ProcessLookupError: pass
            unrelated.kill(); unrelated.wait(timeout=2)

    def test_failed_parent_cleans_redirected_descendant(self):
        self.redirected_descendant(3)

    def test_successful_parent_cleans_redirected_descendant(self):
        self.redirected_descendant(0)

    def test_timeout_cleans_redirected_descendant(self):
        self.redirected_descendant(0, timeout=True)

    def test_cleanup_error_preserves_primary_failure_and_logs(self):
        real_killpg = os.killpg
        def denied_after_cleanup(group, sig):
            if sig == signal.SIGKILL:
                try: real_killpg(group, sig)
                except ProcessLookupError: pass
                raise PermissionError('synthetic cleanup failure')
            return real_killpg(group, sig)
        with patch.object(candidate.os, 'killpg', side_effect=denied_after_cleanup):
            with self.assertRaisesRegex(ValueError, 'Command failed'):
                candidate.run([sys.executable, '-c', 'print("primary output"); raise SystemExit(3)'],
                              self.root, candidate.runtime_env(self.root))
        log = (self.root / 'commands.log').read_text()
        self.assertIn('primary output', log)
        self.assertIn('CLEANUP FAILED', log)

    def test_cleanup_error_cannot_report_success(self):
        with patch.object(candidate.os, 'killpg', side_effect=PermissionError('synthetic cleanup failure')):
            with self.assertRaisesRegex(ValueError, 'cleanup'):
                candidate.run([sys.executable, '-c', 'print("completed")'],
                              self.root, candidate.runtime_env(self.root))

    def test_group_drain_has_a_deadline(self):
        from unittest.mock import Mock
        process = Mock(pid=12345)
        started = time.monotonic()
        with patch.object(candidate.os, 'killpg') as kill:
            with self.assertRaisesRegex(ValueError, 'cleanup timed out'):
                candidate.cleanup_group(process, timeout=.02)
        self.assertLess(time.monotonic() - started, .5)
        self.assertEqual(kill.call_args_list[0].args, (12345, signal.SIGKILL))
        self.assertTrue(all(call.args[0] == 12345 for call in kill.call_args_list))
        process.wait.assert_called_once()

    def test_timeout_remains_primary_when_cleanup_reports_failure(self):
        cleanup = candidate.cleanup_group
        def cleanup_then_fail(process):
            cleanup(process)
            raise OSError('synthetic cleanup diagnostic')
        with patch.object(candidate, 'cleanup_group', side_effect=cleanup_then_fail):
            with self.assertRaisesRegex(ValueError, 'Command timed out'):
                candidate.run([sys.executable, '-c', 'import time; print("before timeout", flush=True); time.sleep(30)'],
                              self.root, candidate.runtime_env(self.root), timeout=.1)
        log = (self.root / 'commands.log').read_text()
        self.assertIn('before timeout', log)
        self.assertIn('TIMEOUT', log)
        self.assertIn('CLEANUP FAILED', log)

    def test_nonzero_command_is_failure(self):
        with self.assertRaisesRegex(ValueError, 'Command failed'):
            candidate.run([sys.executable, '-c', 'raise SystemExit(3)'], self.root, candidate.runtime_env(self.root))
        self.assertIn('COMMAND', (self.root / 'commands.log').read_text())

    def test_wrong_metadata_never_downloads_or_executes_candidate(self):
        with patch.object(candidate.sys, 'platform', 'darwin'), \
             patch.object(candidate, 'run', side_effect=['14.8\n', 'arm64\n', '23G123\n']), \
             patch.dict(os.environ, {'GITHUB_TOKEN': 'secret'}), \
             patch.object(candidate, 'api_json', side_effect=[{**self.run, 'head_sha': 'd' * 40}, self.artifact]), \
             patch.object(candidate, 'download') as download, \
             patch.object(candidate, 'verify_payload') as verify, \
             patch.object(candidate, 'audio_smoke') as audio:
            with self.assertRaisesRegex(ValueError, 'source mismatch'):
                candidate.execute(self.args, self.root)
            download.assert_not_called(); verify.assert_not_called(); audio.assert_not_called()

    def test_payload_failure_prevents_runtime_execution(self):
        with patch.object(candidate.sys, 'platform', 'darwin'), \
             patch.object(candidate, 'run', side_effect=['14.8\n', 'arm64\n', '23G123\n']) as command, \
             patch.dict(os.environ, {'GITHUB_TOKEN': 'secret'}), \
             patch.object(candidate, 'api_json', side_effect=[self.run, self.artifact]), \
             patch.object(candidate, 'download'), patch.object(candidate, 'extract_outer'), \
             patch.object(candidate, 'verify_payload', side_effect=ValueError('Receipt mismatch')), \
             patch.object(candidate, 'audio_smoke') as audio:
            with self.assertRaisesRegex(ValueError, 'Receipt mismatch'):
                candidate.execute(self.args, self.root)
            audio.assert_not_called()
            self.assertEqual(command.call_count, 3)  # OS probes only

    def test_other_os_fails_not_skips(self):
        with patch.object(candidate.sys, 'platform', 'darwin'), \
             patch.object(candidate, 'run', return_value='15.0\n'), patch.object(candidate, 'api_json') as api:
            with self.assertRaisesRegex(ValueError, 'macOS14'):
                candidate.execute(self.args, self.root)
            api.assert_not_called()

    def test_failure_report_retains_both_identities_without_http_secrets(self):
        output = self.root / 'evidence'
        argv = ['--run-id', '17', '--artifact-id', '23', '--candidate-sha', 'a' * 40,
                '--harness-sha', 'b' * 40, '--version', '0.4.35', '--archive-sha256', 'c' * 64,
                '--output', str(output)]
        with patch.object(candidate, 'execute', side_effect=urllib.error.URLError('secret-url')), \
             patch('sys.stdout', new_callable=io.StringIO):
            self.assertEqual(candidate.main(argv), 1)
        report = json.loads((output / 'result.json').read_text())
        self.assertFalse(report['passed'])
        self.assertEqual(report['candidateSHA'], 'a' * 40)
        self.assertEqual(report['harnessSHA'], 'b' * 40)
        self.assertNotIn('secret-url', json.dumps(report))

    def test_inventory_detects_changed_files_and_symlink_escape(self):
        app = self.root / 'app'; app.mkdir()
        file = app / 'file'; file.write_text('original')
        before = candidate.inventory(app)
        file.write_text('modified')
        self.assertNotEqual(candidate.inventory(app), before)
        (app / 'outside').symlink_to(self.root)
        with self.assertRaisesRegex(ValueError, 'escapes'):
            candidate.inventory(app)

    def test_generated_audio_content_and_silence_rejection(self):
        audio = self.root / 'fixture.wav'
        candidate.write_wave(audio, channels=2)
        candidate.check_wave(audio, channels=2)
        import wave
        with wave.open(str(audio), 'wb') as output:
            output.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            output.writeframes(b'\0' * 32000)
        with self.assertRaisesRegex(ValueError, 'silent'):
            candidate.check_wave(audio)


if __name__ == '__main__':
    unittest.main()
