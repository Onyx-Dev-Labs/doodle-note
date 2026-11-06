# Third-party software and model notices

DoodleNote's original source code is MIT-licensed. Dependencies, native
libraries, speech models, and optional local AI models remain subject to their
own licenses. This document highlights components that redistributors should
review; it does not replace the license files shipped by each dependency.

## Runtime software

| Component                    | Role                        | Upstream terms                                         |
| ---------------------------- | --------------------------- | ------------------------------------------------------ |
| FluidAudio                   | Apple Silicon speech engine | Apache License 2.0                                     |
| sherpa-onnx                  | Windows speech engine       | Apache License 2.0                                     |
| Koffi                        | Explicit Windows speech DLL loading | MIT and bundled notices                         |
| node-llama-cpp and llama.cpp | Local GGUF inference        | Upstream MIT terms and bundled notices                 |
| Electron and Chromium        | Desktop runtime             | Upstream MIT, BSD, and component notices               |
| sharp / libvips binaries     | Image processing            | The package reports LGPL and bundled third-party terms |

Production Node dependencies can be inventoried with:

```sh
pnpm licenses list --prod
```

Redistributed desktop installers should retain the applicable license and
notice files, including any source, relinking, or reverse-engineering rights
required by an LGPL-covered binary.

## Downloaded models

The app downloads models from their upstream hosts on first use. The models are
not relicensed under DoodleNote's MIT License.

| Model family                        | Current source                              | Terms to review                                |
| ----------------------------------- | ------------------------------------------- | ---------------------------------------------- |
| Qwen3                               | `unsloth/Qwen3-4B-Instruct-2507-GGUF`       | Apache License 2.0 model terms                 |
| Llama 3.1                           | `bartowski/Meta-Llama-3.1-8B-Instruct-GGUF` | Meta Llama 3.1 Community License               |
| Gemma 3                             | `unsloth/gemma-3-12b-it-GGUF`               | Google Gemma terms                             |
| Parakeet / FluidAudio speech models | Downloaded through FluidAudio               | The upstream model card and distribution terms |
| NVIDIA Parakeet Unified en 0.6b (Windows live captions, int8 ONNX export by k2-fsa) | k2-fsa sherpa-onnx `asr-models` release assets | NVIDIA Open Model License (`nvidia/parakeet-unified-en-0.6b` model card) |
| NVIDIA Parakeet TDT 0.6b v2 and v3 (Windows imports, int8 ONNX export by k2-fsa) | k2-fsa sherpa-onnx `asr-models` release assets | CC BY 4.0 (`nvidia/parakeet-tdt-0.6b-v2`, `nvidia/parakeet-tdt-0.6b-v3` model cards) |
| Silero VAD (Windows)                | k2-fsa sherpa-onnx `asr-models` release asset `silero_vad.onnx` | MIT (snakers4/silero-vad) |
| sherpa-onnx Zipformer, Whisper tiny.en | Downloaded by earlier Windows builds; no longer downloaded, and existing copies are left in place | The upstream model archive and notices |

Windows speech models are attributed as: "Parakeet TDT 0.6b v2/v3 by NVIDIA,
licensed under CC BY 4.0" and "Parakeet Unified en 0.6b, licensed by NVIDIA
Corporation under the NVIDIA Open Model License", each converted to int8 ONNX
by the k2-fsa sherpa-onnx project. The Unified archive's model-card notes
(bias, explainability, privacy, safety) are kept next to the downloaded model.
Silero VAD is © Silero Team, MIT License. The models are downloaded on first
use, verified by SHA256, and are not bundled in the installer.

The Windows speech benchmark (`apps/desktop/scripts/asr-bench`) downloads its
audio on demand and never redistributes it: the AMI Meeting Corpus (CC BY 4.0)
and CMU ARCTIC (free use with the copyright notice retained).

Before redistributing a model, mirroring it, or bundling it into an installer,
review the current upstream model card and license. A model being downloadable
at no charge does not necessarily make its license OSI-approved open source.
