import { createRequire } from 'node:module'
import type { LibraryHandle } from 'koffi'

let runtime: LibraryHandle | undefined

/** Pin the speech package's runtime before loading its dependent native addon.
 * Windows can otherwise resolve onnxruntime.dll to the older System32 copy.
 * Keep the handle for the worker's lifetime; never change global DLL paths. */
export function loadWindowsAsrRuntime(): void {
  if (process.platform !== 'win32' || runtime) return
  // Resolve through sherpa's dependency graph, including pnpm's nested layout.
  const speechRequire = createRequire(require.resolve('sherpa-onnx-node'))
  const dll = speechRequire
    .resolve('sherpa-onnx-win-x64/onnxruntime.dll')
    .replace(/\.asar([\\/])/, '.asar.unpacked$1')
  // Koffi loads an absolute DLL path. Loading must fail closed if it is missing;
  // allowing the addon to fall back to System32 can terminate the worker.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  runtime = (require('koffi') as typeof import('koffi')).load(dll)
}

/**
 * The FFI module for the worker's own Win32 calls (the dictation helper check in
 * windows-helper-check.ts). Windows only; this file stays the only place that loads it.
 */
export function windowsFfi(): typeof import('koffi') {
  if (process.platform !== 'win32') throw new Error('The Win32 FFI is only available on Windows.')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('koffi') as typeof import('koffi')
}
