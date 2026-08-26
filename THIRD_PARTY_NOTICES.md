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
| sherpa-onnx Zipformer speech model  | k2-fsa sherpa-onnx release assets           | The upstream model archive and notices         |

Before redistributing a model, mirroring it, or bundling it into an installer,
review the current upstream model card and license. A model being downloadable
at no charge does not necessarily make its license OSI-approved open source.
