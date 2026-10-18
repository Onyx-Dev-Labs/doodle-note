import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import BriefPanel from '../../src/renderer/src/BriefPanel'
import HomeView from '../../src/renderer/src/HomeView'
import type { BriefApi, BriefView } from '../../src/shared/briefs-api'
import type { CalendarEvent, CalendarState } from '../../src/shared/calendar-api'
import '../../src/renderer/src/assets/main.css'
const listeners = new Set<(view: BriefView) => void>()
const call = async <T,>(name: string, args: unknown[] = []): Promise<T> => {
  const response = await fetch('/api/' + name, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error)
  return value
}
const invoke = <T,>(method: string, args: unknown[]): Promise<T> =>
  call('invoke', [method, ...args])
const api: BriefApi = {
  available: (...a) => invoke('available', a),
  open: (...a) => invoke('open', a),
  select: (...a) => invoke('select', a),
  refresh: (...a) => invoke('refresh', a),
  generate: (...a) => invoke('generate', a),
  edit: (...a) => invoke('edit', a),
  candidates: (...a) => invoke('candidates', a),
  link: (...a) => invoke('link', a),
  previewHistory: (...a) => invoke('previewHistory', a),
  applyHistory: (...a) => invoke('applyHistory', a),
  previewForget: (...a) => invoke('previewForget', a),
  forget: (...a) => invoke('forget', a),
  citation: (...a) => invoke('citation', a),
  play: (...a) => invoke('play', a),
  cancel: (...a) => invoke('cancel', a),
  close: (...a) => invoke('close', a),
  onWarning: () => () => {},
  onState: (fn) => {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }
}
const events = new EventSource('/events')
events.onmessage = (e) => {
  const payload = JSON.parse(e.data)
  if (payload.channel === 'briefs:state') listeners.forEach((fn) => fn(payload.value))
}
await new Promise<void>((r) => {
  events.onopen = () => r()
})
const event = await call<CalendarEvent>('info')
// Unrelated Home surfaces are inert test doubles. No Electron, account, recording or native access.
Object.assign(window, {
  briefs: api,
  citedAsk: { status: async () => ({ enabled: false }) },
  notes: {
    getGlobalChat: async () => [],
    globalChat: async () => [],
    onGlobalAskToken: () => () => {},
    globalAskHistory: async () => [],
    models: async () => ({ models: [] }),
    getSettings: async () => ({})
  }
})
const calendar = { signedIn: true, events: [event] } as CalendarState
function Harness(): React.JSX.Element {
  const [opened, setOpened] = useState(false)
  return (
    <main style={{ maxWidth: 1100, margin: '20px auto', padding: 16 }}>
      <p>
        Synthetic renderer + actual Brief IPC/service/store/source worker. Deterministic generator;
        no native recording/model.
      </p>
      <HomeView
        meetings={[]}
        folders={[]}
        filter={{ kind: 'all' }}
        search=""
        calendar={calendar}
        onOpenBrief={() => setOpened(true)}
        onStartCalendarMeeting={() => {
          throw new Error('Capture forbidden')
        }}
        onOpenMeeting={() => {}}
        onNewMeeting={() => {}}
        onNewNote={() => {}}
        onChanged={() => {}}
        onOpenSettings={() => {}}
      />
      {opened && (
        <BriefPanel
          eventId={event.id}
          api={api}
          onClose={() => setOpened(false)}
          onOpenSettings={() => {}}
        />
      )}
    </main>
  )
}
const root = createRoot(document.getElementById('root')!)
Object.assign(window, { qa: { call, unmount: () => root.unmount() } })
root.render(
  <StrictMode>
    <Harness />
  </StrictMode>
)
