import { resolve } from 'path'
import { readFileSync } from 'node:fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * Windows: what Bark's helper must match, baked into the main bundle (inside app.asar, covered by
 * the app's signature) so a packaged app never trusts the manifest file beside the helper on its
 * own. Read from the manifest scripts/write-dictation-helper-manifest.cjs writes after the helper
 * is built (and, in a release, signed); package:win runs that before electron-vite build.
 * null when there is no Windows helper build (macOS, or a dev build without one).
 */
function helperIntegrity(): string {
  try {
    const manifest = JSON.parse(
      readFileSync(resolve('../../engine/.build/windows/dictation-helper.manifest.json'), 'utf8')
    ) as { authenticodeSha256?: unknown; publisherCn?: unknown; thumbprints?: unknown }
    if (typeof manifest.authenticodeSha256 !== 'string') return 'null'
    return JSON.stringify({
      digest: manifest.authenticodeSha256,
      publisherCn: typeof manifest.publisherCn === 'string' ? manifest.publisherCn : null,
      thumbprints: Array.isArray(manifest.thumbprints) ? manifest.thumbprints : []
    })
  } catch {
    return 'null'
  }
}

export default defineConfig({
  main: {
    define: {
      __DOODLENOTE_FIGTREE__: JSON.stringify(
        readFileSync(resolve('src/renderer/src/assets/fonts/figtree.woff2')).toString('base64')
      ),
      __DOODLENOTE_FRAUNCES__: JSON.stringify(
        readFileSync(resolve('src/renderer/src/assets/fonts/fraunces.woff2')).toString('base64')
      ),
      __DOODLENOTE_BARK_PINE__: JSON.stringify(
        readFileSync(resolve('src/renderer/src/assets/bark/bark-pine.png')).toString('base64')
      ),
      __DOODLENOTE_BARK_WHITE__: JSON.stringify(
        readFileSync(resolve('src/renderer/src/assets/bark/bark-white.png')).toString('base64')
      ),
      // Which lineage this build belongs to. Anything but an explicit `dev` is production.
      __DOODLENOTE_CHANNEL__: JSON.stringify(
        process.env.DOODLENOTE_CHANNEL === 'dev' ? 'dev' : 'release'
      ),
      __DOODLENOTE_HELPER_INTEGRITY__: helperIntegrity(),
      __DOODLENOTE_GOOGLE_CLIENT_SECRET__: JSON.stringify(
        process.env.DOODLENOTE_GOOGLE_CLIENT_SECRET?.trim() ?? ''
      )
    },
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
          'engine-win': resolve('src/main/engine-win.ts'),
          'source-index-worker': resolve('src/main/source-index-worker.ts')
        },
        external: ['node-llama-cpp', 'sherpa-onnx-node']
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        // dictation-capture: the preload of Bark's hidden Windows capture window.
        input: {
          index: resolve('src/preload/index.ts'),
          'dictation-capture': resolve('src/preload/dictation-capture.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        // dictation-capture.html: Bark's hidden Windows capture page.
        input: {
          index: resolve('src/renderer/index.html'),
          'dictation-capture': resolve('src/renderer/dictation-capture.html')
        }
      }
    }
  }
})
