"""Failure-path checks for the localization CI gate, using isolated catalog copies."""
import hashlib
import json
import pathlib
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]

class CoverageGateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temporary.name)
        for relative in ['scripts/check-localization.py', 'Sources/Localization/Localizable.xcstrings',
                         'Sources/Localization/StatusKeys.json', 'docs/localization-review.json',
                         'docs/localization-exemptions.json']:
            target = self.root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / relative, target)
        self.catalog = self.root / 'Sources/Localization/Localizable.xcstrings'
    def tearDown(self):
        self.temporary.cleanup()
    def run_gate(self, *arguments):
        return subprocess.run(['python3', str(self.root / 'scripts/check-localization.py'), *arguments], capture_output=True, text=True)
    def mutate(self, edit):
        value = json.loads(self.catalog.read_text()); edit(value)
        self.catalog.write_text(json.dumps(value))
        ledger = self.root / 'docs/localization-review.json'
        value = json.loads(ledger.read_text()); value['catalogSHA256'] = hashlib.sha256(self.catalog.read_bytes()).hexdigest()
        ledger.write_text(json.dumps(value))
    def test_complete_catalog_passes_and_missing_language_fails(self):
        self.assertEqual(self.run_gate().returncode, 0)
        self.mutate(lambda value: value['strings']['New note']['localizations'].pop('da'))
        self.assertIn('missing language', self.run_gate().stderr)
    def test_wrong_argument_type_is_rejected(self):
        self.mutate(lambda value: value['strings']['Google account %@']['localizations']['de']['stringUnit'].update(value='Konto %lld'))
        self.assertIn('placeholder mismatch', self.run_gate().stderr)
    def test_new_controller_status_requires_translation(self):
        (self.root / 'Sources/NewController.swift').write_text('let problem = "This new failure needs a translation."')
        result = self.run_gate()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Unclassified app prose', result.stderr)
    def test_extracted_ui_key_requires_translation(self):
        extracted = self.root / 'Extraction'; extracted.mkdir()
        (extracted / 'Probe.stringsdata').write_text(json.dumps({'source': '/apps/mobile-native/Sources/Probe.swift', 'tables': {'Localizable': [{'key': 'Brand new UI'}]}}))
        result = self.run_gate('--extracted-dir', str(extracted))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Uncataloged extracted UI key', result.stderr)
    def test_review_cannot_be_claimed_without_evidence(self):
        path = self.root / 'docs/localization-review.json'; value = json.loads(path.read_text())
        value['languages']['da']['status'] = 'reviewed'; path.write_text(json.dumps(value))
        self.assertIn('human review claimed without reviewer/date', self.run_gate().stderr)

if __name__ == '__main__':
    unittest.main()
