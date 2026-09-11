# Native note exports (ONY-263)

Open a note, choose **Note storage → Share note**, and select PDF or Markdown (.zip). Personal notes, transcript, and drawing select the current snapshot. Summary checkboxes select exact retained generated or edited versions; the current summary is selected initially. An empty selection shows an inline error. This works without an account or network connection.

The export snapshot contains only a title, selected text sections, and selected PencilKit drawing. It has no audio paths, voice embeddings, credentials, account metadata, or provider configuration. Exporting never sends content to a service. The system share sheet is the explicit transfer step; Save to Files is available from that sheet.

PDF uses Core Text pagination and selectable text with system font fallback. Transcripts retain source language, supplied speaker names, and start/end timestamps. Partial or unknown transcript status is labeled incomplete. Each ink tile is rendered on white at 2x and placed at natural point size on a separate PDF page. Large canvases tile in row-major order instead of shrinking all strokes into an unreadable thumbnail.

Markdown packages contain `note.md` plus every referenced `assets/ink-N.png`. The ZIP is standards-compliant, stored without compression, UTF-8 flagged, with CRC32 and fixed relative paths. Text is escaped as literal Markdown, including HTML and image syntax, so a user-authored remote image cannot implicitly load when the document opens. Text is not translated. Plain source formatting is preserved, rather than interpreting generated Markdown as rich layout.

Exports run on a cancellable background task. No note mutation occurs. Failures remove the operation's UUID temporary directory; successful/canceled sharing removes it on dismissal. Leftovers after process death expire after 24 hours, cleaned only from the feature's own temporary root. Output directories use file protection until first unlock. Markdown ink assets are capped at 32 MiB total and drawings at 256 tiles; the operation visibly refuses larger exports without silently omitting content. ZIP64 sizes are rejected explicitly.

## Verification

Generate with `xcodegen generate --spec apps/mobile-native/project.yml`. Run the DoodleNoteNative scheme with `CODE_SIGNING_ALLOWED=NO` and only-testing `DoodleNoteNativeTests/NoteExportTests` plus `DoodleNoteNativeUITests/NoteExportUITests` on a compatible iPhone simulator. Unit fixtures are synthetic and include all five languages, long multi-page text, ink, names/timestamps, version selection, corrupt drawings, cancellation, and cleanup isolation. PDFKit independently reads PDF page/text content. A separate test parser checks ZIP records and referenced images; `unzip -t` provides an independent CRC and directory check on the attached package.

## Check this

1. Create typed notes with accented text, a transcript, ink, and two summary versions. Export only the older summary; expect only that selected version plus the enabled current sections.
2. Open the PDF in Preview or Files. Check the final paragraph, all accents, names/timestamps and ink at page boundaries. Extract the Markdown ZIP; open `note.md` beside its `assets` directory and inspect all images.
3. Cancel the native share sheet. Reopen the note; its content must be unchanged. Disable all sections; expect a clear error and no share sheet.
4. With Airplane Mode enabled, repeat export to Files. Use large text and VoiceOver to verify all selections and the Close/Prepare controls remain usable.

Physical-device share destinations, VoiceOver and qualified human translation review remain release QA. The new non-English strings are machine drafts. No schema migration, network permission, paid resource or model download is added.

## Recorded local evidence (2026-09-11)

Xcode26.6/iOS26.5 iPhone17Pro simulator: all nine export unit tests passed. The native UI test passed empty selection, preparation, system share-sheet presentation, cancel, and original-note retention. Results are `/tmp/doodlenote-ony263-accepted.xcresult` (final unit run) and `/tmp/doodlenote-ony263-final.xcresult` (unit plus UI run before the additional erased-ink guard). No physical-device claim is made.

[Selection screenshot](qa/ony263/selection.png), [native share sheet](qa/ony263/share-sheet.png), [ink PDF](qa/ony263/ink.pdf), and [Markdown package](qa/ony263/markdown.zip) contain only synthetic fixtures. Independent macOS PDFKit rendering confirms readable ink and intact final text; `/usr/bin/unzip -t` verifies both PNGs and `note.md` CRCs. A six-page multilingual fixture retains every numbered row and the final paragraph. PDFKit text extraction can reposition an underscore in reading order despite its correct visual position, so pagination assertions use ordinary prose rather than underscore-separated sentinel text.
