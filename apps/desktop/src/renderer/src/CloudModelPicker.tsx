import { useEffect, useState } from 'react'
import type { CloudProvider, CloudModelsResult } from '../../shared/notes-api'

export default function CloudModelPicker({
  provider,
  saved,
  revision,
  value,
  defaultModel,
  onChange,
  onSave,
  canSave
}: {
  provider: CloudProvider
  saved: boolean
  revision: number
  value: string
  defaultModel: string
  onChange: (model: string) => void
  onSave: () => void
  canSave: boolean
}): React.JSX.Element {
  const [catalog, setCatalog] = useState<{ key: string; result: CloudModelsResult } | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [manual, setManual] = useState(false)
  const requestKey = `${provider}:${revision}:${refresh}`
  const loading = saved && catalog?.key !== requestKey
  const result = saved && catalog?.key === requestKey ? catalog.result : { models: [] }
  useEffect(() => {
    let cancelled = false
    if (saved) {
      void window.notes
        .cloudModels(provider)
        .then((next) => {
          if (!cancelled) setCatalog({ key: requestKey, result: next })
        })
        .catch(() => {
          if (!cancelled)
            setCatalog({
              key: requestKey,
              result: {
                models: [],
                error: 'Could not load models. Try again or enter a model ID manually.'
              }
            })
        })
    }
    return () => {
      cancelled = true
    }
  }, [provider, saved, requestKey])
  return (
    <div className="cal-subcard">
      <label>
        Model
        <select
          aria-label="Available provider models"
          value={value}
          disabled={!saved || loading}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Default ({defaultModel})</option>
          {value && !result.models.some((model) => model.id === value) && (
            <option value={value}>{value} (current selection)</option>
          )}
          {result.models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label === model.id ? model.id : `${model.label} (${model.id})`}
            </option>
          ))}
        </select>
      </label>
      <button type="button" disabled={!saved || loading} onClick={() => setRefresh((n) => n + 1)}>
        {loading ? 'Loading models…' : 'Refresh models'}
      </button>
      <button type="button" disabled={!saved || !canSave} onClick={onSave}>
        Save model
      </button>
      <p className="models-sub" role="status">
        {!saved
          ? 'Save your provider key first to load its model list.'
          : result.error ||
            (loading
              ? 'Reading the provider’s model catalog. No meeting content is sent.'
              : `${result.models.length} models listed by your provider. Choose a model and click Save model. Availability still depends on account permissions, billing, quota, and model compatibility.`)}
      </p>
      <button type="button" onClick={() => setManual((current) => !current)}>
        {manual ? 'Hide manual model entry' : 'Enter a model ID manually'}
      </button>
      {manual && (
        <input
          aria-label="Custom model ID"
          type="text"
          spellCheck={false}
          value={value}
          placeholder={defaultModel}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  )
}
