import type { EngineApi } from '../shared/engine-events'

declare global {
  interface Window {
    engine: EngineApi
  }
}

export {}
