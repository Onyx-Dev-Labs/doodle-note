import { useEffect, useState } from 'react'
import type {
  AppDisplay,
  DictationSettingsUpdate,
  DictationStatus,
  TidyLevel
} from '../../shared/dictation-api'
import {
  STYLE_CATEGORIES,
  STYLE_CATEGORY_LABELS,
  STYLE_SAMPLE_INPUT,
  STYLE_TONES,
  STYLE_TONE_HINTS,
  STYLE_TONE_LABELS,
  appsInCategory,
  moveApp,
  removeApp,
  styleSample,
  type StyleCategory
} from '../../shared/dictation-style'
import { tidyLight } from '../../shared/dictation-tidy'
import {
  MAX_TRANSFORMS,
  MAX_TRANSFORM_NAME,
  MAX_TRANSFORM_PROMPT,
  newTransformId,
  resetTransforms,
  type TransformDef
} from '../../shared/dictation-transforms'
import { appDisplayName } from '../../shared/dictation-app-names'
import { acceleratorFrom } from './dictation-accelerator'
import { Toggle } from './ModelsView'

interface Props {
  status: DictationStatus
  update: (patch: DictationSettingsUpdate) => Promise<void>
}

const TIDY_CARDS: Array<{ level: TidyLevel; title: string; blurb: string }> = [
  {
    level: 'off',
    title: 'Off',
    blurb: 'Your words exactly as they were recognised. No styles either.'
  },
  {
    level: 'light',
    title: 'Light',
    blurb:
      'Instant and on this Mac, no model. Drops um and uh, stutters and repeats, applies "no, I mean", turns "first, second" into bullets, fixes capitals and the full stop.'
  },
  {
    level: 'full',
    title: 'Full',
    blurb:
      'A model turns a rambling brain dump into clear sentences, paragraphs or bullets. It keeps your meaning and voice and adds no facts, names or numbers.'
  }
]

const SAMPLE_BRAIN_DUMP =
  'um so i was thinking, we should meet at three, no, I mean four, and uh bring the the slides'

export function DictationTidySettings({ status, update }: Props): React.JSX.Element {
  const { settings, cleanup, model } = status
  const byok = cleanup.byok
  const consented =
    byok !== null &&
    settings.byokConsent?.provider === byok.provider &&
    settings.byokConsent?.model === byok.model
  return (
    <section className="keys-section">
      <h3>Tidy-up</h3>
      <p className="models-sub">
        Speech is recognised on this Mac. Tidy-up decides what happens to the words before they are
        typed. If a model step fails or looks doubtful, the words as you said them are typed
        instead, and the pill says so. Nothing is lost.
      </p>
      <div role="radiogroup" aria-label="Tidy-up level" className="choice-grid">
        {TIDY_CARDS.map((card) => (
          <button
            key={card.level}
            type="button"
            role="radio"
            aria-checked={settings.tidyLevel === card.level}
            className={settings.tidyLevel === card.level ? 'choice-card on' : 'choice-card'}
            onClick={() => void update({ tidyLevel: card.level })}
          >
            <strong>{card.title}</strong>
            <span className="cal-row-sub">{card.blurb}</span>
            {card.level === 'light' && (
              <>
                <span className="cal-row-sub">Before: {SAMPLE_BRAIN_DUMP}</span>
                <span className="cal-row-sub">After: {tidyLight(SAMPLE_BRAIN_DUMP)}</span>
              </>
            )}
          </button>
        ))}
      </div>
      <div className="cal-subcard" style={{ marginTop: 10 }}>
        <div className="cal-row">
          <span className="cal-row-main">
            <span className="cal-row-label">Model for Full tidy-up and transforms</span>
            <span className="cal-row-sub">
              {model.path === 'local' && `Uses ${model.label} on this Mac. Nothing leaves it.`}
              {model.path === 'byok' &&
                `Uses your provider (${model.label}). Only the finished text is sent, never audio.`}
              {model.path === 'needs-consent' &&
                `${model.label} is set up, but you have not allowed sending text to it yet.`}
              {model.path === 'none' &&
                'No notes model is installed and no provider is set up. Full falls back to Light, and transforms cannot run. Light and styles still work. Install one under Notes model.'}
            </span>
          </span>
        </div>
        {byok && (
          <div className="cal-row">
            <span className="cal-row-main">
              <span className="cal-row-label">Allow sending text to {byok.provider}</span>
              <span className="cal-row-sub">
                Used only when no notes model is installed. Covers the dictated text and any text
                you ask a transform to rewrite, never audio. Changing provider or model asks again.
              </span>
            </span>
            <Toggle
              checked={consented}
              label="Allow sending dictated and transformed text to the provider"
              onChange={() =>
                void update({
                  byokConsent: consented ? null : { provider: byok.provider, model: byok.model }
                })
              }
            />
          </div>
        )}
      </div>
    </section>
  )
}

/** An app's own icon, or its first letter while the icon is not known. */
function AppTile({
  name,
  icon,
  dim
}: {
  name: string
  icon: string | null
  /** The app is not on this Mac, so only a letter can be drawn. */
  dim: boolean
}): React.JSX.Element {
  return (
    <span className={dim ? 'app-tile dim' : 'app-tile'} aria-hidden="true">
      {icon ? <img src={icon} alt="" draggable={false} /> : <span>{[...name][0] ?? ''}</span>}
    </span>
  )
}

export function DictationStyleSettings({ status, update }: Props): React.JSX.Element {
  const { settings, recentApps } = status
  const [category, setCategory] = useState<StyleCategory>('personal')
  const [newApp, setNewApp] = useState('')
  const [info, setInfo] = useState<{ asked: string; apps: Record<string, AppDisplay> }>({
    asked: '',
    apps: {}
  })
  const apps = appsInCategory(category, settings.styleApps)
  // Real names and icons for the listed apps, asked of the helper whenever the list changes.
  const wanted = apps.map((app) => app.bundleId).join('\n')
  useEffect(() => {
    if (!wanted) return
    let current = true
    void window.dictation.getAppInfo(wanted.split('\n')).then((result) => {
      if (current) setInfo({ asked: wanted, apps: result })
    })
    return () => {
      current = false
    }
  }, [wanted])
  return (
    <section className="keys-section">
      <h3>Style</h3>
      <p className="models-sub">
        How the words are cased and punctuated depends on the app you are typing into. English only:
        other languages are typed as they are. Applied after tidy-up, so it does nothing while
        tidy-up is Off.
      </p>
      <div role="tablist" aria-label="App category" className="choice-tabs">
        {STYLE_CATEGORIES.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={category === id}
            className={category === id ? 'pill-btn on' : 'pill-btn'}
            onClick={() => setCategory(id)}
          >
            {STYLE_CATEGORY_LABELS[id]}
          </button>
        ))}
      </div>
      <p className="models-sub">Before: {STYLE_SAMPLE_INPUT}</p>
      <div className="choice-grid">
        {STYLE_TONES.map((tone) => (
          <button
            key={tone}
            type="button"
            role="radio"
            aria-checked={settings.styles[category] === tone}
            className={settings.styles[category] === tone ? 'choice-card on' : 'choice-card'}
            onClick={() => void update({ styles: { ...settings.styles, [category]: tone } })}
          >
            <strong>{STYLE_TONE_LABELS[tone]}</strong>
            <span className="cal-row-sub">{STYLE_TONE_HINTS[tone]}</span>
            <span className="cal-row-sub">After: {styleSample(tone)}</span>
          </button>
        ))}
      </div>
      <div className="cal-subcard" style={{ marginTop: 10 }}>
        <div className="cal-row">
          <span className="cal-row-main">
            <span className="cal-row-label">Apps in {STYLE_CATEGORY_LABELS[category]}</span>
            <span className="cal-row-sub">
              {category === 'other'
                ? 'Every app not placed elsewhere. Mail in a browser cannot be told apart from any other page, so place the browser here or move it.'
                : 'Chosen by the app you are typing into. Add the ones you use, or move a built-in one.'}
            </span>
          </span>
        </div>
        {apps.map((app) => {
          const shown = info.apps[app.bundleId]
          const name = appDisplayName(
            app.bundleId,
            shown?.name,
            recentApps.find((r) => r.bundleId === app.bundleId)?.name
          )
          // Only once the helper has answered: an app that is not on this Mac gets a dim letter tile.
          const notInstalled = info.asked === wanted && !shown?.name && !shown?.icon
          return (
            <div className="cal-row" key={app.bundleId}>
              <AppTile name={name} icon={shown?.icon ?? null} dim={notInstalled} />
              <span className="cal-row-main" title={app.bundleId}>
                <span className="cal-row-label">{name}</span>
                <span className="cal-row-sub">{app.builtin ? 'Built in' : 'Added by you'}</span>
              </span>
              <select
                aria-label={`Category for ${name}`}
                value={category}
                onChange={(event) =>
                  void update({
                    styleApps: moveApp(
                      settings.styleApps,
                      app.bundleId,
                      event.target.value as StyleCategory
                    )
                  })
                }
              >
                {STYLE_CATEGORIES.map((id) => (
                  <option key={id} value={id}>
                    {STYLE_CATEGORY_LABELS[id]}
                  </option>
                ))}
              </select>
              {!app.builtin && (
                <button
                  type="button"
                  className="pill-btn"
                  onClick={() =>
                    void update({ styleApps: removeApp(settings.styleApps, app.bundleId) })
                  }
                >
                  Remove
                </button>
              )}
            </div>
          )
        })}
        <div className="cal-row">
          <span className="cal-row-main">
            <span className="cal-row-label">Add an app</span>
            <span className="cal-row-sub">
              Pick one you dictated into lately, or type its bundle id (for example
              com.tinyspeck.slackmacgap).
            </span>
          </span>
          <select
            aria-label="Recent apps"
            value=""
            onChange={(event) => {
              if (event.target.value) {
                void update({
                  styleApps: moveApp(settings.styleApps, event.target.value, category)
                })
              }
            }}
          >
            <option value="">Recent apps…</option>
            {recentApps.map((app) => (
              <option key={app.bundleId} value={app.bundleId}>
                {app.name}
              </option>
            ))}
          </select>
          <input
            aria-label="Bundle id"
            value={newApp}
            placeholder="com.example.App"
            onChange={(event) => setNewApp(event.target.value)}
          />
          <button
            type="button"
            className="pill-btn"
            disabled={!newApp.trim()}
            onClick={() => {
              void update({ styleApps: moveApp(settings.styleApps, newApp, category) })
              setNewApp('')
            }}
          >
            Add
          </button>
        </div>
      </div>
    </section>
  )
}

export function DictationTransformSettings({ status, update }: Props): React.JSX.Element {
  const { settings, model } = status
  const transforms = settings.transforms
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState({ name: '', prompt: '' })
  const [fresh, setFresh] = useState({ name: '', prompt: '' })

  const save = (items: TransformDef[], extra: Partial<typeof transforms> = {}): Promise<void> =>
    update({ transforms: { ...transforms, ...extra, items } })
  const patchItem = (id: string, patch: Partial<TransformDef>): Promise<void> =>
    save(transforms.items.map((item) => (item.id === id ? { ...item, ...patch } : item)))

  return (
    <section className="keys-section">
      <h3>Transforms</h3>
      <p className="models-sub">
        Rewrite text with a model: the text you have selected in any app, or your last dictation if
        nothing is selected. Each transform can have its own shortcut, and the pill&apos;s menu
        lists them too. The result replaces exactly what was selected, and Undo puts it back.
      </p>
      <div className="cal-subcard">
        <div className="cal-row">
          <span className="cal-row-main">
            <span className="cal-row-label">Turn on transforms</span>
            <span className="cal-row-sub">
              {model.path === 'none'
                ? 'No model is available yet, so they cannot run. See Tidy-up.'
                : model.path === 'needs-consent'
                  ? `Needs your OK to send text to ${model.label}. See Tidy-up.`
                  : `Runs on ${model.label ?? 'your model'}.`}
            </span>
          </span>
          <Toggle
            checked={transforms.enabled}
            label="Turn on transforms"
            onChange={() => void save(transforms.items, { enabled: !transforms.enabled })}
          />
        </div>
        {transforms.enabled && (
          <>
            <div className="cal-row">
              <span className="cal-row-main">
                <span className="cal-row-label">Auto apply after dictation</span>
                <span className="cal-row-sub">
                  Runs after tidy-up and style on every dictation. If it fails, the text before it
                  is typed. A pill offers View and Undo afterwards.
                </span>
              </span>
              <select
                aria-label="Transform to apply after dictation"
                value={transforms.autoApplyId ?? ''}
                onChange={(event) =>
                  void save(transforms.items, {
                    autoApplyId: event.target.value || null,
                    autoApply: transforms.autoApply && event.target.value !== ''
                  })
                }
              >
                <option value="">Choose one…</option>
                {transforms.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <Toggle
                checked={transforms.autoApply}
                label="Auto apply a transform after dictation"
                onChange={() =>
                  void save(transforms.items, {
                    autoApply: !transforms.autoApply && transforms.autoApplyId !== null
                  })
                }
              />
            </div>
            <div className="cal-row">
              <span className="cal-row-main">
                <span className="cal-row-label">View changes</span>
                <span className="cal-row-sub">
                  {status.hasLastChange
                    ? 'The last transform is held in memory until you quit.'
                    : 'Nothing to show yet.'}
                </span>
              </span>
              <button
                type="button"
                className="pill-btn"
                disabled={!status.hasLastChange}
                onClick={() => void window.dictation.viewLastChange()}
              >
                View
              </button>
              <button
                type="button"
                className="pill-btn"
                disabled={!status.hasLastChange}
                onClick={() => void window.dictation.undoLastChange()}
              >
                Undo
              </button>
            </div>
          </>
        )}
      </div>

      {transforms.enabled && (
        <>
          <h4 style={{ margin: '14px 0 6px' }}>My transforms</h4>
          <div className="cal-subcard">
            {transforms.items.length === 0 && (
              <div className="cal-row">
                <span className="cal-row-sub">
                  None. Create your own below, or reset to the defaults.
                </span>
              </div>
            )}
            {transforms.items.map((item) => (
              <div className="cal-row" key={item.id} style={{ alignItems: 'flex-start' }}>
                <span className="cal-row-main">
                  {editing === item.id ? (
                    <>
                      <input
                        aria-label="Transform name"
                        value={draft.name}
                        maxLength={MAX_TRANSFORM_NAME}
                        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      />
                      <textarea
                        aria-label="Transform prompt"
                        rows={4}
                        value={draft.prompt}
                        maxLength={MAX_TRANSFORM_PROMPT}
                        style={{ width: '100%' }}
                        onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
                      />
                    </>
                  ) : (
                    <>
                      <span className="cal-row-label">{item.name}</span>
                      <span className="cal-row-sub">{item.prompt}</span>
                    </>
                  )}
                  <span className="cal-row-sub">
                    {item.hotkey || 'No shortcut'}
                    {item.hotkey &&
                      status.transformShortcuts[item.id] === 'registered' &&
                      ' · active'}
                    {status.transformShortcuts[item.id] === 'conflict' &&
                      ' · another action already uses this combination'}
                    {status.transformShortcuts[item.id] === 'invalid' &&
                      ' · not a valid combination'}
                  </span>
                </span>
                <span
                  style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}
                >
                  <button
                    type="button"
                    className="pill-btn"
                    onKeyDown={(event) => {
                      if (recordingId !== item.id) return
                      event.preventDefault()
                      if (event.key === 'Escape') return setRecordingId(null)
                      const accelerator = acceleratorFrom(event)
                      if (accelerator) {
                        setRecordingId(null)
                        void patchItem(item.id, { hotkey: accelerator })
                      }
                    }}
                    onBlur={() => setRecordingId(null)}
                    onClick={() => setRecordingId(item.id)}
                  >
                    {recordingId === item.id ? 'Press the new shortcut…' : 'Shortcut'}
                  </button>
                  {item.hotkey && (
                    <button
                      type="button"
                      className="pill-btn"
                      onClick={() => void patchItem(item.id, { hotkey: '' })}
                    >
                      Clear
                    </button>
                  )}
                  {editing === item.id ? (
                    <button
                      type="button"
                      className="pill-btn"
                      disabled={!draft.name.trim() || !draft.prompt.trim()}
                      onClick={() => {
                        void patchItem(item.id, { name: draft.name, prompt: draft.prompt })
                        setEditing(null)
                      }}
                    >
                      Save
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="pill-btn"
                      onClick={() => {
                        setEditing(item.id)
                        setDraft({ name: item.name, prompt: item.prompt })
                      }}
                    >
                      Edit
                    </button>
                  )}
                  <button
                    type="button"
                    className="pill-btn"
                    onClick={() => void window.dictation.runTransform(item.id)}
                  >
                    Try
                  </button>
                  <button
                    type="button"
                    className="pill-btn"
                    onClick={() => {
                      const items = transforms.items.filter((other) => other.id !== item.id)
                      void save(items, {
                        ...(transforms.autoApplyId === item.id
                          ? { autoApplyId: null, autoApply: false }
                          : {})
                      })
                    }}
                  >
                    Delete
                  </button>
                </span>
              </div>
            ))}
          </div>

          <h4 style={{ margin: '14px 0 6px' }}>Create your own</h4>
          <div className="cal-subcard">
            <div
              className="cal-row"
              style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}
            >
              <input
                aria-label="Name for your transform"
                placeholder="Name, for example Friendly reply"
                value={fresh.name}
                maxLength={MAX_TRANSFORM_NAME}
                onChange={(event) => setFresh({ ...fresh, name: event.target.value })}
              />
              <textarea
                aria-label="What the transform should do"
                rows={3}
                placeholder="Describe how the text should be rewritten. The text is given to the model as data."
                value={fresh.prompt}
                maxLength={MAX_TRANSFORM_PROMPT}
                onChange={(event) => setFresh({ ...fresh, prompt: event.target.value })}
              />
              <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="pill-btn"
                  disabled={
                    !fresh.name.trim() ||
                    !fresh.prompt.trim() ||
                    transforms.items.length >= MAX_TRANSFORMS
                  }
                  onClick={() => {
                    const id = newTransformId(
                      fresh.name,
                      transforms.items.map((item) => item.id)
                    )
                    void save([
                      ...transforms.items,
                      {
                        id,
                        name: fresh.name.trim(),
                        prompt: fresh.prompt.trim(),
                        hotkey: '',
                        keepFacts: false
                      }
                    ])
                    setFresh({ name: '', prompt: '' })
                  }}
                >
                  Add transform
                </button>
                <button
                  type="button"
                  className="pill-btn"
                  onClick={() => void update({ transforms: resetTransforms(transforms) })}
                >
                  Reset to defaults
                </button>
              </span>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
