import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CloudProvider,
  EngineChoice,
  NotesModelInfo,
  NotesModelsResponse,
  NotesSettingsView
} from '../../shared/notes-api'

/**
 * Onboarding-style model picker (FluidVoice's Voice Engine screen is the
 * reference): one card per catalog model with download/activate states,
 * plus the optional BYOK cloud section.
 */
export default function ModelsView({ active }: { active: boolean }): React.JSX.Element {
  const [data, setData] = useState<NotesModelsResponse | null>(null)
  const [settings, setSettings] = useState<NotesSettingsView | null>(null)
  const [downloading, setDownloading] = useState<{ id: string; progress: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [provider, setProvider] = useState<CloudProvider>('anthropic')
  const [cloudModel, setCloudModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [keySaved, setKeySaved] = useState(false)
  const cloudFormSeeded = useRef(false)

  const refresh = useCallback(() => {
    void window.notes
      .models()
      .then(setData)
      .catch(() => setData(null))
    void window.notes
      .getSettings()
      .then((view) => {
        setSettings(view)
        // Seed the cloud form once from saved settings.
        if (!cloudFormSeeded.current && view.cloud) {
          cloudFormSeeded.current = true
          setProvider(view.cloud.provider)
          setCloudModel(view.cloud.model ?? '')
        }
      })
      .catch(() => setSettings(null))
  }, [])

  useEffect(() => {
    if (active) refresh()
  }, [active, refresh])

  useEffect(
    () =>
      window.notes.onDownloadProgress((ev) => {
        setDownloading((d) => (d && d.id === ev.modelId ? { ...d, progress: ev.progress } : d))
      }),
    []
  )

  const activate = async (modelId: string): Promise<void> => {
    setError(null)
    setDownloading({ id: modelId, progress: 0 })
    const result = await window.notes.activateModel(modelId)
    setDownloading(null)
    if (!result.ok) setError(result.error ?? 'activation failed')
    refresh()
  }

  const chooseEngine = async (choice: EngineChoice): Promise<void> => {
    setError(null)
    const view = await window.notes.setSettings({ engineChoice: choice })
    setSettings(view)
  }

  const saveCloudKey = async (): Promise<void> => {
    setError(null)
    const view = await window.notes.setSettings({
      cloud: {
        provider,
        ...(cloudModel.trim() ? { model: cloudModel.trim() } : {}),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {})
      }
    })
    setSettings(view)
    setApiKey('')
    if (view.error) {
      setError(view.error)
    } else if (view.cloud?.hasKey) {
      setKeySaved(true)
      setTimeout(() => setKeySaved(false), 2000)
    }
  }

  const renderAction = (m: NotesModelInfo): React.JSX.Element => {
    if (downloading?.id === m.id) {
      const pct = Math.round(downloading.progress * 100)
      return (
        <div className="model-progress">
          <div className="progress-track">
            <div className="progress-bar" style={{ width: `${pct}%` }} />
          </div>
          <span className="progress-label">
            {downloading.progress > 0 ? `downloading… ${pct}%` : 'preparing…'}
          </span>
        </div>
      )
    }
    if (m.active) {
      return <span className="badge badge-active">Active</span>
    }
    if (!m.available) {
      return <span className="model-note">needs {m.minRamGB} GB RAM</span>
    }
    return (
      <button type="button" disabled={downloading !== null} onClick={() => void activate(m.id)}>
        {m.downloaded ? 'Activate' : 'Download & activate'}
      </button>
    )
  }

  const engineChoice: EngineChoice = settings?.engineChoice ?? 'local'

  return (
    <div className="models">
      <header className="models-header">
        <h2>Notes model</h2>
        <p className="models-sub">
          Doodle Note polishes your meeting notes with a model that runs entirely on this Mac
          {data ? ` (${data.ramGB} GB RAM)` : ''}. Download one once — nothing leaves your machine.
        </p>
      </header>

      {error && <div className="models-error">{error}</div>}

      <div className="model-cards">
        {data === null && <span className="placeholder">loading models…</span>}
        {data?.models.map((m) => (
          <div
            key={m.id}
            className={`model-card${m.available ? '' : ' unavailable'}${m.active ? ' is-active' : ''}`}
          >
            <div className="model-head">
              <span className="model-label">{m.label}</span>
              {m.downloaded && !m.active && <span className="badge">Downloaded</span>}
            </div>
            <div className="model-desc">{m.description}</div>
            <div className="model-meta">
              {m.sizeGB.toFixed(1)} GB download · needs {m.minRamGB} GB RAM
            </div>
            <div className="model-action">{renderAction(m)}</div>
          </div>
        ))}
      </div>

      <section className="keys-section">
        <h3>AI keys (optional)</h3>
        <p className="models-sub">
          On-device is the default and needs no account. Add your own API key only if you want
          cloud-quality notes — the key is encrypted with the macOS keychain and never shown again.
        </p>

        <div className="engine-choice">
          <label>
            <input
              type="radio"
              name="engine-choice"
              checked={engineChoice === 'local'}
              onChange={() => void chooseEngine('local')}
            />
            On-device (default)
          </label>
          <label>
            <input
              type="radio"
              name="engine-choice"
              checked={engineChoice === 'cloud'}
              onChange={() => void chooseEngine('cloud')}
            />
            Cloud with my key
            {engineChoice === 'cloud' && !settings?.cloud?.hasKey && (
              <span className="model-note"> (no key saved yet — on-device will be used)</span>
            )}
          </label>
        </div>

        <div className="key-form">
          <select value={provider} onChange={(e) => setProvider(e.target.value as CloudProvider)}>
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
          </select>
          <input
            type="text"
            spellCheck={false}
            placeholder="model (optional, e.g. claude-sonnet-5)"
            value={cloudModel}
            onChange={(e) => setCloudModel(e.target.value)}
          />
          <input
            type="password"
            placeholder={settings?.cloud?.hasKey ? '••••••••  (key saved)' : 'API key'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <button type="button" onClick={() => void saveCloudKey()}>
            Save
          </button>
          {(keySaved || settings?.cloud?.hasKey) && <span className="key-saved">key saved ✓</span>}
        </div>
      </section>
    </div>
  )
}
