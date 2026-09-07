# Recording durability and recovery (ONY-244)

The native app records only a microphone session the user explicitly starts. It does not record calls, other apps or system audio. The existing audio background mode supports an active authorized session; physical lock, route and call behavior still needs device qualification.

## Source audio and analysis

The microphone tap copies admitted PCM buffers into a source writer queue bounded by 128 packets and 8 MiB. Source PCM is written in approximately five-second CAF chunks. Each successful buffer write accounts for confirmed frames. Admission, open, write and finalization failures return an incomplete result rather than silently marking capture finished. Frames not confirmed by a failed write may still exist in the preserved original and are described as unconfirmed, not asserted lost.

Speech and speaker conversion use a separate analysis queue bounded by 32 packets and 2 MiB. A slow or failed analysis path stops those results while source audio continues. Source finalization does not wait for analysis; the recording controller saves the truthful capture state before waiting for analysis finalization. Existing analyzer timeouts remain in their respective services.

Each completed session retains local frame-count/failure metadata. Abrupt termination before finalization has no complete session receipt; the existing recording state is recovered as interrupted. This cannot quantify audio that never reached the process or disk. No frame report establishes microphone accuracy or a complete physical recording by itself.

## Cancellation and interruption

Permission/model preparation has an attempt identity. Cancel and interruption are checked after each asynchronous preparation stage, before creating audio files or starting the engine. Late callbacks from an old attempt cannot alter a later capture. The editor exposes preparation cancellation and an explicit Resume action for interrupted notes.

Calls/audio-session interruptions, relevant route changes, engine configuration changes and media-service loss/reset stop capture. Resumption always requires user action. Foregrounding checks for denied microphone permission. Playback also stops on interruption, lost media services or headphone disconnection, and does not restart automatically.

## Local timeline and recovery

A chunk's local timing receipt contains its source start, frame count, rate and channels. It is saved before its open journal is cleared. Journal recovery can recreate that receipt, preserving the original CAF and selecting a validated recovered copy. Original bytes are never rewritten. Torn trailing bytes are reported; malformed or unsupported source/cached recovery remains visible as a recovery problem.

Timing receipts retain missing intervals. Seeking inside missing audio reports unavailable, later timestamps keep their original position, and continued recording starts after the known timeline end. Playback stops at a missing interval rather than silently joining the next chunk. Invalid, overlapping or future-version receipts fail closed and remain unchanged. Legacy chunks without receipts retain their prior sequential interpretation; missing legacy chunks cannot retroactively acquire unknown timing metadata.

If confirmed audio removal encounters a corrupt timeline whose endpoint cannot be established, cleanup remains available. A local uncertainty flag then prevents appending new audio to that note; the user can start a new note while preserving existing personal content. Older lifecycle records omit the flag, and later lifecycle writes cannot silently clear an established uncertainty.

Audio remains local. These sidecars contain no credentials or transcripts and are removed together with local audio through the existing confirmed storage workflow. They are not a cloud playback feature or a note schema migration.

## Verification and physical Check this:

Synthetic tests cover a 7,203-second 16 kHz mono stream (115,248,000 frames), chunk sample endpoints, bounded/failed admission, open/write/finalization failure, blocked analysis, pending permission cancellation, hardware start failure/retry, interruption and explicit resume, missing-range seeks, clock rollback, corrupt/overlapping receipts and preserved recovery originals. The long stream is accelerated fixture I/O, not a two-hour real-time microphone session.

Before release, on supported physical iPhone and iPad with authorized synthetic conversations:

1. Record for two hours while typing/drawing. Compare source duration/frame continuity and playback/seek near the start, each resume and the end. Continue beyond two hours and verify no truncation.
2. Lock/unlock, switch apps, receive a test call and change wired/Bluetooth input routes. Expect truthful interrupted state where appropriate and explicit Resume, with prior audio preserved.
3. Deny/revoke permission, cancel preparation, reset media services and stop while analysis is slow. Expect no unexpected microphone start, stale callback or false finished state.
4. On disposable test data, inject disk-full/backlog/finalization faults and force-terminate with an open chunk. Reopen and inspect original bytes, recovered tail, warnings and timeline. Do not treat unrecoverable bytes as successful capture.
5. Seek across resumed/recovered chunks and a deliberately removed test chunk. Expect correct later source times and explicit unavailable intervals. Remove local audio through confirmation and verify personal notes/ink remain.

Physical device identity, microphone accuracy, call/lock behavior, route latency, storage pressure, background execution and real two-hour capture/playback remain unqualified. ONY-241/ONY-265 retain their release gates under the approved development sequencing exception.

Primary references: [Apple route changes](https://developer.apple.com/documentation/avfaudio/responding-to-audio-route-changes), [media-service reset](https://developer.apple.com/documentation/avfaudio/avaudiosession/mediaserviceswereresetnotification), and [AVAudioFile buffer writes](https://developer.apple.com/documentation/avfaudio/avaudiofile/write%28from%3A%29-6qgec).
