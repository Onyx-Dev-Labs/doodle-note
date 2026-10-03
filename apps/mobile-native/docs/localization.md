# Five-language interface

The app ships English, Danish, Spanish, French and German string resources. Non-English translations are machine drafts, not qualified human approvals. `localization-review.json` records that distinction and the exact catalog digest. ONY-248 stays In Review until language-qualified and physical accessibility reviews are attached. Final qualification must repeat after all v1 features land.

`appLanguage` controls interface presentation only. It stores a supported `SpokenLanguage.rawValue` for compatibility with setup, but never assigns a note's primary recording language or a summary's output language. Setup and Models expose the preference. Changing it updates the root SwiftUI locale and persists across launches; original typed text, transcript passages, drawings, confirmed speaker names, event titles and provider profile names remain unchanged. Generation instructions use their independently selected output language.

## Conventions for new features

- Use normal SwiftUI literal keys (`Text("Ready")`, `Button("Retry")`) and add every extracted key to `Sources/Localization/Localizable.xcstrings` in all five languages.
- For a String outside SwiftUI, use `L10n.text("Ready")`. Use `L10n.key` only for a finite app-owned enum/display label. Never translate arbitrary source content.
- Existing controllers retain stable app-owned English status strings. Their views call `L10n.message(status)` so a language change rerenders a current error too. Add those keys to the catalog and `StatusKeys.json`. Known error prefixes translate separately from an underlying system diagnostic.
- Format count-bearing text with `L10n.format`, `%lld` and catalog one/other plural variants. Use `L10n.date`, `L10n.bytes`, or an explicit locale-aware Foundation format style for dates/numbers. Do not concatenate translated words to construct grammar; search counts join two independently pluralized labels with a separator.
- UIKit/Pencil accessibility strings must resolve through L10n, including accessibility values, and refresh when the SwiftUI locale changes. Confirmed participant names stay verbatim; default speaker labels opt into localized display without mutating stored annotations.
- Add strings for empty, loading, offline, permission, cancel, retry and failure states together with the happy path. Adding a string is not human translation approval: preserve `needs_review`, refresh the ledger digest and request qualified review.

`python3 apps/mobile-native/scripts/check-localization.py` validates locale completeness, nonempty values, placeholder types, plural forms, review metadata, the explicit status inventory and a complementary raw-status-prose scan. `localization-exemptions.json` documents protocol formats, debug fixtures and model instructions that must remain unchanged. The prose scan is a heuristic, not a Swift parser or proof that every runtime string is covered. Exemptions require a concrete non-UI reason. New one-word dynamic enum labels need explicit catalog entries even when no compiler extractor sees them.

After building with `SWIFT_EMIT_LOC_STRINGS=YES`, run the same command with `--extracted-dir <DerivedData>`. It checks compiler-extracted SwiftUI keys and fails if no native extraction exists. Native mobile CI runs both checks. Unsupported user/provider/system content is never added automatically to the catalog.

## System and provider boundaries

Microphone and speech permission purpose strings have localized InfoPlist resources. Apple's permission dialogs, system Settings, date pickers, keyboards and Google/Microsoft authorization websites follow their own system/account language controls. An in-app preference cannot change their language. Underlying OS diagnostics may retain Apple's original language; DoodleNote's surrounding guidance is translated. Account email/profile names, calendar names, event titles, timezone identifiers and confirmed participant names are content, not missing translation keys. The exact app-generated Google/Microsoft fallback account label is localized at display time while preserving its identifier.

## Verification and remaining review

`LocalizationTests` exercises all five resource bundles, plural forms, dates/numbers, existing error rerendering and unchanged source/participant data. `LocalizationUITests` opens setup and the editor in all five languages, captures screenshots, checks labels and persistence, includes German at the largest accessibility text size, and changes language later in Models without rewriting an existing note. Fixtures are DEBUG-only and use isolated synthetic note directories.

Automated accessibility-element labels and enlarged-text screenshots do not establish physical VoiceOver usability. A qualified reviewer must walk setup, library/search, editor/recording, Pencil, Models, calendars/reminders, storage/Trash and later sync/summary/export screens in each language on iPhone and iPad, including cancellation/errors and long text. Check focus order, spoken labels, reachable controls, date/count grammar, and unchanged note/transcript/output language. Record reviewer, date, exact build and results in the ledger/Linear before marking reviewed.

Rollback can revert these presentation resources/helpers and retain the language preference safely. No note migration, account move, cloud upload or source-data rewrite is performed.
