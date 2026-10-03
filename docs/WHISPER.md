# Optional local batch transcription

Mac imports and Re-transcribe can use Parakeet (default) or Whisper large-v3-turbo.
Live captions are unchanged. Settings exposes one batch configuration, including
Parakeet English/v2 or multilingual/v3 and Whisper automatic or explicit language.
This reconciles the batch-language setting proposed in PR #117; PR #145's live
caption changes are separate.

Whisper model download happens only after explicit selection and starting a batch
job. The first use downloads 1,624,555,275 bytes from the pinned Hugging Face
revision below. Progress and cancellation share the import job. SHA256 and size
are checked before atomic promotion; partial failures leave no active model.
The cache is checked again before inference and works without a network when
valid. Corrupt models are downloaded again. Models remain in application support
under `models/whisper`, even when the content library moves.

Audio is normalized by the bundled Swift engine using AVFoundation, then passed
to a bundled static whisper.cpp executable. No audio is uploaded. Each native
child is awaited through exit on cancellation. External stereo is mixed once;
known DoodleNote capture parts retain split channels. Last successful settings
are recorded with the meeting. Failed/canceled passes leave its prior transcript.

## Build and package

Run `pnpm engine:build` and `pnpm whisper:build` before packaging a Mac app.
The latter requires CMake and an Apple Silicon compiler and builds a static
binary with embedded Metal shaders, macOS 14 minimum, portable armv8.4-a CPU
instructions. It does not download a speech model. The Mac packaging resources
include the executable and its MIT notice. Windows packaging is unchanged.

- whisper.cpp v1.9.4: commit `927cfce34f31707e17f2bff35c349632fb9e2c3a`
- Source: https://github.com/ggml-org/whisper.cpp
- Model: `ggml-large-v3-turbo.bin`
- Model revision: `5359861c739e955e79d9a303bcbc70fb988958b1`
- Model SHA256: `1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69`
- Model source/license: https://huggingface.co/ggerganov/whisper.cpp (MIT)
- OpenAI model license: https://github.com/openai/whisper/blob/main/LICENSE

The native source and model are MIT licensed. The native build copies its license
to the packaged resources; `apps/desktop/resources/whisper-model-LICENSE.txt`
contains the model notice. Model size and checksum were verified against upstream
metadata and a real downloaded artifact. Review exact package signing, embedded
native loading, device memory and language quality before public release.

## Local qualification, October 1, 2026

Hardware: Apple M4 Pro, 24 GiB unified memory. Source v1.9.4, portable static
Metal build as above. Synthetic macOS `say` fixtures only, not a measurement of
real spontaneous Danish or the reporter's private media:

- Danish/Sara reference: “Altså, jeg synes vi skal gennemgå budgettet i morgen.
  Måske kan vi mødes klokken ti, hvis det passer dig.” Explicit `da` and auto both
  recognized Danish and retained all words, normalizing “klokken ti” to “kl. 10”.
- English reference: “Well, I think we should review the budget tomorrow. Maybe
  we can meet at ten if that works for you.” Explicit `en` retained all words,
  normalizing “ten” to “10”.
- CLI elapsed times from `/usr/bin/time -l`: first Danish 19.43 s, warm automatic
  Danish 2.05 s, warm English 2.75 s. The first run overlapped heavy filesystem
  relocation, so it is not a clean cold-start benchmark. Peak memory footprint
  was 2.043, 2.035 and 2.034 GB respectively. These are observations on one Mac,
  not performance or quality guarantees for lower-memory devices.
- Full application adapter produced a neutral-speaker Danish transcript from
  AIFF with measured 10–6120 ms timing and 6.271 s audio duration.
- Actual native adapter tests passed dual-mono AAC once, split speaker retention,
  MP4 decoding, cancellation during native inference, and a successful retry.
- Model-cache tests exercise integrity failure, cancel cleanup, corrupt-cache
  repair and offline reuse. Ordinary tests never fetch the large model.

Human testing of real spontaneous Danish and the signed installed app remains
required before a public release; no near-flawless accuracy claim is made.
