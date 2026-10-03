# Model readiness and first run (ONY-243)

The fresh native app opens with language selection and a direct Start taking notes action. There is no account, download, microphone permission or AI consent requirement for plain notes. Models is available from the library. The selected app language is stored separately from each existing note's spoken language. Translation coverage is tracked in ONY-248; setting a locale here is not evidence that all screens have been translated.

Speech, speaker labels and generation have independent readiness. The generation contract uses Apple Foundation Models on device and checks both model availability and the selected locale at runtime. It does not create a cloud client or fall back to remote inference. Model support, human-speech quality, licensing qualification for existing speaker assets, minimum hardware and the provisional iOS 26 floor remain subject to ONY-241. This source implementation does not qualify Sean's iPadOS 18.5 device.

## Download and storage behavior

- Speaker downloads report streamed URLSession progress without buffering the model in memory. Manifest paths, file sizes and SHA256 values are validated before publishing an installed model.
- Downloads are limited to one mutation in the shared store. A canceled/failed attempt keeps only completed verified files in its revision-specific preparation directory. Relaunch/retry hashes those files and transfers missing or corrupt ones again. Incomplete individual transfers restart; this is file-level recovery, not an HTTP byte-range promise.
- Each transfer checks free capacity for the file plus 32 MiB reserve. URLSession and filesystem errors remain visible, including space disappearing after that check.
- A valid previous installation stays in place until the new package is complete. Same-version repair uses filesystem replacement; distinct versions remain until explicit removal. Installed readiness revalidates actual bytes, not just a marker.
- Remove speaker model removes only the dedicated speaker-assets directory, including partial/older packages. It does not remove notes, drawings, audio or speaker annotations. Mutation controls are disabled during capture/preparation. Model files are protected until first unlock and excluded from device backup.
- Apple owns speech asset integrity/storage. DoodleNote requests a speech reservation, shows installation progress and can release the reservation. Apple decides when shared files are physically removed. Generation assets are managed through Apple Intelligence in system Settings, not an invented app download/delete API.

## Execution and cancellation

Model hashing, preparation and inference execute on actors separate from capture and the main UI. Speaker transfer cancellation reaches URLSession. Speech cancellation requests cancellation of Apple's task and keeps a waiting state until that task actually returns. Inference does not claim that a running uninterruptible system call has stopped: the generation actor remains busy until completion and discards a canceled result. There is no automatic inference retry, truncation or cloud fallback. System context/guardrail/runtime errors propagate to the feature caller; meeting chunking and generated-note presentation belong to ONY-250.

## Verification

Controlled-asset tests cover interrupted recovery, canceled transfer and concurrent-removal exclusion, corruption despite a marker, unsafe manifest paths, low storage with preservation of the previous version, safe repeated replacement, failed replacement preserving installed bytes, offline installed access and explicit removal preserving sibling notes. The first-run UI test creates and types a note without preparing models, then relaunches into the library.

Physical fresh-install/partial-download/airplane-mode and multilingual generation accuracy tests remain pending. Simulator capability messages are not proof of on-device generation quality. ONY-243 stays In Review after merge until required physical QA is attached.

## Sources and rollback

Implementation checked against Xcode 26.6 / iPhoneSimulator 26.5 Swift interfaces and Apple's [SystemLanguageModel](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel) and [AssetInstallationRequest](https://developer.apple.com/documentation/speech/assetinstallationrequest) documentation. No production credentials, model infrastructure or schema changes are introduced. Reverting the app source preserves notes and ignores the additional preferences/preparation directory; previously completed speaker packages retain the existing on-disk layout.
