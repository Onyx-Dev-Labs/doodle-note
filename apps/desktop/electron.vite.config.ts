import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // electron-vite externalizes every package.json dependency of the main
    // build by default. @repo/ai is unbuilt workspace TS source, so it must
    // be BUNDLED (excluded here); its native dep node-llama-cpp must stay
    // EXTERNAL — it ships prebuilt binaries and is ESM-only with top-level
    // await, so it is loaded at runtime via a lazy import() from
    // node_modules instead of being bundled.
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@repo/ai', '@repo/meetings-store']
      })
    ],
    build: {
      rollupOptions: {
        // engine-win is the Windows ASR utilityProcess entry — built as its
        // own chunk so utilityProcess.fork can load out/main/engine-win.js.
        input: {
          index: resolve('src/main/index.ts'),
          'engine-win': resolve('src/main/engine-win.ts')
        },
        external: ['node-llama-cpp', 'sherpa-onnx-node']
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
