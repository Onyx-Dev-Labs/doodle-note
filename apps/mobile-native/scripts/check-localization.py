#!/usr/bin/env python3
"""Validate compiled extraction plus app-owned status inventory. Human review is a separate gate."""
import argparse
import hashlib
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
CATALOG = ROOT / 'Sources/Localization/Localizable.xcstrings'
LANGUAGES = {'en', 'da', 'es', 'fr', 'de'}
parser = argparse.ArgumentParser()
parser.add_argument('--extracted-dir', type=pathlib.Path)
args = parser.parse_args()
catalog = json.loads(CATALOG.read_text())
strings = catalog['strings']
errors = []

def placeholders(text):
    # Ignore literal percent signs and argument positions; preserve argument types and multiplicity.
    return sorted(re.findall(r'%(?:\d+\$)?(?:lld|ld|d|@|f)', text.replace('%%', '')))

def units(value):
    if 'stringUnit' in value:
        return [value['stringUnit']]
    result = []
    for variants in value.get('variations', {}).values():
        for child in variants.values():
            result.extend(units(child))
    return result

for key, value in strings.items():
    if set(value.get('localizations', {})) != LANGUAGES:
        errors.append(f'{key}: missing language')
    for language, localized in value.get('localizations', {}).items():
        translations = units(localized)
        if not translations:
            errors.append(f'{key}/{language}: no translations')
        for unit in translations:
            if not unit.get('value') or placeholders(unit['value']) != placeholders(key):
                errors.append(f'{key}/{language}: empty value or placeholder mismatch')
        plural = localized.get('variations', {}).get('plural')
        if plural is not None and not {'one', 'other'}.issubset(plural):
            errors.append(f'{key}/{language}: missing required plural forms')
ledger = json.loads((ROOT / 'docs/localization-review.json').read_text())
if ledger['catalogSHA256'] != hashlib.sha256(CATALOG.read_bytes()).hexdigest():
    errors.append('Review ledger must be refreshed after catalog changes; do not invent human approval')
if set(ledger['languages']) != LANGUAGES:
    errors.append('Review ledger missing languages')
for language, review in ledger['languages'].items():
    if review['status'] == 'reviewed' and (not review['reviewer'] or not review['reviewedAt']):
        errors.append(f'{language}: human review claimed without reviewer/date')

# Explicit app status inventory catches raw model/controller Strings that SwiftUI cannot extract.
# Entries contain semantic English messages only, never user-authored/transcript/provider payloads.
inventory = json.loads((ROOT / 'Sources/Localization/StatusKeys.json').read_text())
for key in inventory:
    if key not in strings:
        errors.append(f'Status message missing from catalog: {key}')

# Guard app-owned raw status prose too: Swift extracts literals passed to localized APIs,
# but a controller's `detail = "..."` needs this complementary check. This heuristic
# deliberately does not claim to parse Swift; explicit exemptions remain reviewable.
exemptions = json.loads((ROOT / 'docs/localization-exemptions.json').read_text())
for path in (ROOT / 'Sources').rglob('*.swift'):
    relative = str(path.relative_to(ROOT / 'Sources'))
    if any(marker in relative for marker in ('Fixture', 'CalendarPreview', 'MicrosoftTimeZones')):
        continue  # Synthetic payloads and provider wire-format timezone identifiers.
    for line_number, line in enumerate(path.read_text().splitlines(), 1):
        if line.lstrip().startswith('//'):
            continue
        for raw in re.findall(r'"((?:[^"\\]|\\.)*)"', line):
            if not re.search(r'[A-Za-z]{2} ', raw) or raw.startswith('https:'):
                continue
            if raw in strings:
                continue
            if '\\(' in raw:
                prefix = raw.split('\\(', 1)[0]
                if prefix in strings:
                    continue  # A translated app prefix wraps an unchanged system diagnostic.
                if re.search(r'\b(Text|Button|Label)\(', line):
                    continue  # Compiler extraction validates interpolated SwiftUI keys after build.
            reason = exemptions.get(relative, {}).get(raw)
            if not reason:
                errors.append(f'Unclassified app prose: {relative}:{line_number}: {raw}')

if args.extracted_dir:
    files = list(args.extracted_dir.rglob('*.stringsdata'))
    checked = 0
    for path in files:
        try:
            data = json.loads(path.read_text())
        except (ValueError, UnicodeDecodeError):
            continue
        source = data.get('source', '')
        if '/apps/mobile-native/Sources/' not in source or any(v in source for v in ['Fixture', 'CalendarPreview']):
            continue
        checked += 1
        for item in data.get('tables', {}).get('Localizable', []):
            if item['key'] not in strings:
                errors.append(f"Uncataloged extracted UI key: {item['key']} ({source})")
    if checked == 0:
        errors.append('No native Swift string extraction found; build with SWIFT_EMIT_LOC_STRINGS=YES')
if errors:
    print('\n'.join(errors), file=sys.stderr)
    sys.exit(1)
print(f'{len(strings)} keys: five-language values, placeholders, plurals and review ledger valid. Human review remains separate.')
