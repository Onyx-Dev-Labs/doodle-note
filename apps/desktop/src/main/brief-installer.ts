import { BRIEFS_STATE } from '../shared/briefs-api'
import type { CitedAskHost } from './cited-ask-host'
import { BriefService, type BriefDependencies } from './brief-service'
import { BriefOriginals } from './brief-originals'
import { CalendarContextStore } from './calendar-context-store'
import { CalendarStartContext } from './calendar-start-context'
import { installBriefIpc } from './brief-ipc'
import type {
  RecordingStartCoordinator,
  RecordingStartObserver
} from './recording-start-coordinator'
import type { SourceIndexService } from './source-index-service'
import { libraryActivity, type LibraryActivity } from './library-activity'

interface Dependencies {
  root(): string
  assertAvailable(): void
  enabled(): boolean
  host: CitedAskHost
  calendar: BriefDependencies['calendar']
  sources: Pick<SourceIndexService, 'retrieveEvidence' | 'census'>
  ipc: Parameters<typeof installBriefIpc>[0]['ipc']
  recording: RecordingStartCoordinator
  power: {
    on(event: 'resume', listener: () => void): unknown
    removeListener(event: 'resume', listener: () => void): unknown
  }
  play?: BriefDependencies['play']
  warn(message: string): void
  activity?: LibraryActivity
}

/** Own all brief subscriptions and cleanup. The host owns the sole cited service/audio mapper. */
export function installBriefs(deps: Dependencies): {
  readonly pendingAttempt: string | undefined
  onCaptureStarted(
    attempt: string | undefined,
    captureId: string | undefined,
    meetingId: string | undefined
  ): Promise<void>
  settled(): Promise<void>
  dispose(): Promise<void>
} {
  let closed = false
  let disposal: Promise<void> | undefined
  const pending = new Set<Promise<unknown>>()
  const track = <T>(promise: Promise<T>): Promise<T> => {
    pending.add(promise)
    void promise.catch(() => {}).finally(() => pending.delete(promise))
    return promise
  }
  const available = (): boolean => !closed && deps.enabled()
  const activity = deps.activity ?? libraryActivity
  const store = new CalendarContextStore(
    deps.root,
    () => {
      if (!available()) throw new Error('Local briefs are disabled.')
      deps.assertAvailable()
    },
    activity
  )
  const originals = new BriefOriginals(store, deps.sources, activity)
  const briefs = new BriefService({
    store,
    originals,
    cited: deps.host.cited,
    calendar: deps.calendar,
    play: deps.play,
    activity,
    publish: (owner, view) => {
      if (available()) deps.host.owners.publish(owner, BRIEFS_STATE, view)
    }
  })
  const start = new CalendarStartContext({
    resolve: (id) => {
      const observation = deps.calendar.resolveBrief(id)
      if (!observation) return null
      const binding = store.fence()
      return {
        ...observation,
        assertCurrent: () => {
          binding.assertCurrent()
          observation.assertCurrent()
        }
      }
    },
    originalExists: (id) => originals.exists(id),
    readOriginal: (id, control) => originals.get(id, control),
    assertOriginalCurrent: (original) => originals.assertCurrent(original),
    persist: (accepted, control) => store.recordAcceptedStart(accepted, control),
    warn: (message) => {
      if (available()) deps.warn(message)
    }
  })
  const observer: RecordingStartObserver = {
    accepted: (request) => {
      if (available()) start.observer.accepted?.(request)
      else start.observer.reset?.()
    },
    attached: (request, meeting) => {
      if (available()) start.observer.attached?.(request, meeting)
    },
    engineBegin: (request, meeting) => {
      if (available()) start.observer.engineBegin?.(request, meeting)
    },
    reset: () => start.observer.reset?.()
  }
  const removeObserver = deps.recording.installObserver(observer)
  const removeIpc = installBriefIpc({
    ipc: deps.ipc,
    owners: deps.host.owners,
    service: briefs,
    enabled: available
  })
  const unsubscribe = deps.host.subscribeInvalidation(() => {
    // Host deliberately does not await this; retain our own cleanup promise for teardown.
    return track(briefs.invalidate())
  })
  const resume = (): void => {
    if (available()) void track(briefs.refreshAll()).catch(() => {})
  }
  deps.power.on('resume', resume)
  const settled = async (): Promise<void> => {
    while (pending.size) await Promise.allSettled([...pending])
  }
  return {
    get pendingAttempt() {
      return available() ? start.pendingAttempt : undefined
    },
    onCaptureStarted(attempt, captureId, meetingId) {
      if (!available() || !attempt || !captureId || !meetingId) return Promise.resolve()
      return track(start.started(attempt, captureId, meetingId))
    },
    settled,
    dispose() {
      if (disposal) return disposal
      closed = true
      removeObserver()
      unsubscribe()
      deps.power.removeListener('resume', resume)
      // Begin retirement synchronously before awaiting either handlers or producer cleanup.
      const ipcDrain = removeIpc()
      const serviceDrain = briefs.dispose()
      disposal = (async () => {
        await Promise.allSettled([ipcDrain, serviceDrain])
        await settled()
        await originals.dispose()
        await store.dispose()
      })()
      return disposal
    }
  }
}
