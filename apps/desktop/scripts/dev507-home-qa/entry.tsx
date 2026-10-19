import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import CitedHome from '../../src/renderer/src/CitedHome'
import '../../src/renderer/src/assets/main.css'
import '../../src/renderer/src/cited-ask.css'
const changed = new Set()
const call = async (name, args = []) => {
  const r = await fetch('/api/' + name, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  })
  const v = await r.json()
  if (!r.ok) throw Error(v.error)
  return v
}
window.qa = {
  call,
  changed() {
    changed.forEach((f) => f())
  }
}
window.citedAsk = {
  status: async () => ({ enabled: true }),
  ask: (q) => call('ask', [q]),
  history: () => call('history'),
  clear: () => call('clear'),
  cancel: (id) => call('cancel', [id]),
  resolve: (a, b) => call('resolve', [a, b]),
  census: async () => ({}),
  play: async () => {
    throw Error('no audio fixture')
  },
  onChanged: (f) => {
    changed.add(f)
    return () => changed.delete(f)
  },
  onProgress: () => () => {}
}
const root = createRoot(document.getElementById('root'))
window.qa.unmount = () => root.unmount()
root.render(
  <StrictMode>
    <main style={{ maxWidth: 1000, margin: '24px auto', padding: 16 }}>
      <p>Synthetic React + real Home/shared service/store. Mock generator.</p>
      <CitedHome folders={[]} onOpenSettings={() => {}} />
    </main>
  </StrictMode>
)
