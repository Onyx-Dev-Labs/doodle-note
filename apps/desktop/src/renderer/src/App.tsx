import { useState } from 'react'
import DevConsole from './DevConsole'
import MeetingView from './MeetingView'
import ModelsView from './ModelsView'

type ViewId = 'meeting' | 'models' | 'dev'

const VIEWS: ReadonlyArray<{ id: ViewId; label: string }> = [
  { id: 'meeting', label: 'Meeting' },
  { id: 'models', label: 'Models' },
  { id: 'dev', label: 'Dev console' }
]

/**
 * Tiny view switcher. All three views stay mounted (hidden with CSS) so a
 * running capture, the notes editor, and the dev console log survive tab
 * switches — the engine event stream is shared, each view just renders its
 * own slice of it.
 */
function App(): React.JSX.Element {
  const [view, setView] = useState<ViewId>('meeting')

  return (
    <div className="shell">
      <nav className="view-tabs">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={view === v.id ? 'tab on' : 'tab'}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </nav>
      <div className="view-host">
        <div className={view === 'meeting' ? 'view-slot' : 'view-slot view-hidden'}>
          <MeetingView active={view === 'meeting'} onOpenModels={() => setView('models')} />
        </div>
        <div className={view === 'models' ? 'view-slot' : 'view-slot view-hidden'}>
          <ModelsView active={view === 'models'} />
        </div>
        <div className={view === 'dev' ? 'view-slot' : 'view-slot view-hidden'}>
          <DevConsole />
        </div>
      </div>
    </div>
  )
}

export default App
