import { useEffect, useRef, useState } from 'react'
import type { RecipeDraft, RecipeList, RecipeOutput, RecipeResult } from '../../shared/recipes-api'
import { flushLibrarySaves } from './lib/library-flush'
import { invalidateRecipeRun, registerRecipeRun, RecipeAttempts } from './lib/recipe-run'
import './recipes.css'

const blank = (): RecipeDraft => ({
  name: '',
  prompt: '',
  scope: 'current-meeting',
  outputKind: 'markdown',
  policy: 'local-only',
  inputs: { personalNotes: true, transcript: true, selectedSummary: false }
})
function unwrap<T>(result: RecipeResult<T>): T {
  if (result.error !== undefined) throw new Error(result.error)
  return result.value
}
function exportOutput(output: RecipeOutput): void {
  const content = `# ${output.recipe.name} — v${output.recipe.version}\n\n${output.markdown}\n\n---\n\nProvenance:\n\n\`\`\`json\n${JSON.stringify({ ...output, markdown: undefined }, null, 2)}\n\`\`\`\n`
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `recipe-${output.runId}.md`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export default function RecipePanel({
  meetingId,
  disabled
}: {
  meetingId: string
  disabled: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<RecipeList | null>(null)
  const [selected, setSelected] = useState('')
  const [draft, setDraft] = useState<RecipeDraft>(blank)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)
  const run = useRef<string | null>(null)
  const generation = useRef(0)
  const attempts = useRef(new RecipeAttempts())
  const selectedVersion = list?.versions.find((v) => v.versionId === selected)
  const dirty =
    selectedVersion &&
    JSON.stringify(draft) !==
      JSON.stringify({
        name: selectedVersion.name,
        prompt: selectedVersion.prompt,
        scope: selectedVersion.scope,
        outputKind: selectedVersion.outputKind,
        policy: selectedVersion.policy,
        inputs: selectedVersion.inputs
      })
  useEffect(() => {
    let live = true
    if (open)
      void window.recipes
        .list(meetingId)
        .then((r) => {
          if (live) setList(unwrap(r))
        })
        .catch((e) => {
          if (live) setError(String(e.message ?? e))
        })
    return () => {
      live = false
    }
  }, [meetingId, open])
  useEffect(
    () => () => {
      generation.current++
      if (run.current) void window.recipes.cancel({ meetingId, runId: run.current })
    },
    [meetingId]
  )
  function select(id: string): void {
    setSelected(id)
    setError('')
    setStatus('')
    const v = list?.versions.find((v) => v.versionId === id)
    setDraft(
      v
        ? {
            name: v.name,
            prompt: v.prompt,
            scope: v.scope,
            outputKind: v.outputKind,
            policy: v.policy,
            inputs: v.inputs
          }
        : blank()
    )
  }
  async function save(duplicate = false): Promise<void> {
    if (!list) return
    setBusy(true)
    setError('')
    try {
      const v = unwrap(
        await window.recipes.save(
          list.scope,
          duplicate ? { ...draft, name: `${draft.name.slice(0, 113)} (copy)` } : draft,
          selected || undefined,
          duplicate
        )
      )
      setList((current) => (current ? { ...current, versions: [...current.versions, v] } : current))
      setSelected(v.versionId)
      setDraft({
        name: v.name,
        prompt: v.prompt,
        scope: v.scope,
        outputKind: v.outputKind,
        policy: v.policy,
        inputs: v.inputs
      })
      setStatus(`Saved ${v.name}, version ${v.version}. Previous versions are retained.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  async function execute(): Promise<void> {
    if (!list || !selected || dirty) return
    setBusy(true)
    setError('')
    setStatus('Preparing recipe…')
    const epoch = ++generation.current
    const runId = attempts.current.begin(JSON.stringify([meetingId, selected, list.scope]))
    run.current = runId
    setRunning(true)
    let invalidated = false
    const unregister = registerRecipeRun(meetingId, (reason) => {
      invalidated = true
      void window.recipes.cancel({ meetingId, runId })
      setStatus(
        reason === 'edited'
          ? 'Meeting edited. Canceling recipe…'
          : 'Canceling; waiting for model cleanup…'
      )
    })
    try {
      await flushLibrarySaves()
      if (invalidated || epoch !== generation.current) {
        if (epoch === generation.current)
          setStatus('Recipe canceled before generation. You can retry.')
        return
      }
      setStatus('Running recipe. Originals are preserved.')
      const output = unwrap(
        await window.recipes.run({ meetingId, runId, versionId: selected, library: list.scope })
      )
      if (epoch !== generation.current) return
      attempts.current.complete(runId)
      setList((current) =>
        current
          ? {
              ...current,
              outputs: [...current.outputs.filter((o) => o.runId !== output.runId), output]
            }
          : current
      )
      setStatus(`Saved output from ${output.recipe.name} v${output.recipe.version}.`)
    } catch (e) {
      if (epoch === generation.current) {
        setError(e instanceof Error ? e.message : String(e))
        setStatus(
          'Run did not return a result. Retry to recover this attempt; previous outputs are retained.'
        )
      }
    } finally {
      unregister()
      run.current = null
      setRunning(false)
      if (epoch === generation.current) {
        setBusy(false)
      }
    }
  }
  return (
    <section className="recipe-panel" aria-label="Meeting recipes">
      <button
        type="button"
        className="recipe-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Recipes <span>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="recipe-body">
          <p className="models-sub">
            Reusable prompts for this meeting. Outputs stay separate from your notes and summary.
            Email drafts are never sent.
          </p>
          <label>
            Recipe version
            <select value={selected} disabled={busy} onChange={(e) => select(e.target.value)}>
              <option value="">New recipe</option>
              {list?.versions.map((v) => (
                <option key={v.versionId} value={v.versionId}>
                  {v.name} · v{v.version}
                </option>
              ))}
            </select>
          </label>
          <fieldset disabled={busy}>
            <legend>Recipe configuration</legend>
            <label>
              Name
              <input
                maxLength={120}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              Instructions
              <textarea
                rows={4}
                value={draft.prompt}
                onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
                placeholder="Extract decisions and unresolved questions. Mark unknown owners explicitly."
              />
            </label>
            <div className="recipe-grid">
              <label>
                Output kind
                <select
                  value={draft.outputKind}
                  onChange={(e) =>
                    setDraft({ ...draft, outputKind: e.target.value as RecipeDraft['outputKind'] })
                  }
                >
                  <option value="markdown">Markdown</option>
                  <option value="checklist">Checklist</option>
                  <option value="email-draft">Email draft (unsent)</option>
                </select>
              </label>
              <label>
                Model policy
                <select
                  value={draft.policy}
                  onChange={(e) => {
                    setDraft({ ...draft, policy: e.target.value as RecipeDraft['policy'] })
                  }}
                >
                  <option value="local-only">On-device only (offline)</option>
                  <option value="explicit-cloud">Explicit cloud provider</option>
                </select>
              </label>
            </div>
            <p>Scope: current meeting only</p>
            <div className="recipe-inputs">
              {(['personalNotes', 'transcript', 'selectedSummary'] as const).map((key, index) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={draft.inputs[key]}
                    onChange={(e) =>
                      setDraft({ ...draft, inputs: { ...draft.inputs, [key]: e.target.checked } })
                    }
                  />
                  {['Personal notes', 'Transcript', 'Selected summary'][index]}
                </label>
              ))}
            </div>
            <div className="recipe-actions">
              <button
                type="button"
                onClick={() => void save()}
                disabled={!list || !draft.name.trim() || !draft.prompt.trim()}
              >
                {selected ? 'Save new version' : 'Create recipe'}
              </button>
              <button type="button" disabled={!selected} onClick={() => void save(true)}>
                Duplicate as new recipe
              </button>
            </div>
          </fieldset>
          {selectedVersion?.policy === 'explicit-cloud' && (
            <p>
              Cloud execution is currently unavailable: this source’s export authorization cannot be
              verified. Save an on-device version to run.
            </p>
          )}
          {dirty && <p>Save a new version or select a saved version before running.</p>}
          {disabled && (
            <p>Stop recording and wait for transcription to finish before running a recipe.</p>
          )}
          <div className="recipe-actions">
            <button
              type="button"
              disabled={
                busy ||
                disabled ||
                !selected ||
                !!dirty ||
                selectedVersion?.policy === 'explicit-cloud'
              }
              onClick={() => void execute()}
            >
              Run selected version
            </button>
            {running && (
              <button
                type="button"
                onClick={() => {
                  invalidateRecipeRun(meetingId, 'canceled')
                }}
              >
                Cancel run
              </button>
            )}
          </div>
          <p role="status" aria-live="polite">
            {status}
          </p>
          {error && (
            <p role="alert" className="recipe-error">
              {error}
            </p>
          )}
          <h3>Saved outputs</h3>
          {!list?.outputs.length && <p>No recipe outputs yet.</p>}
          {[...(list?.outputs ?? [])].reverse().map((o) => (
            <details className="recipe-output" key={o.runId}>
              <summary>
                {o.recipe.name} · v{o.recipe.version} · {new Date(o.completedAt).toLocaleString()}
              </summary>
              <p>
                {o.recipe.outputKind} · {o.recipe.policy} · {o.model.id}
              </p>
              <pre>{o.markdown}</pre>
              <details>
                <summary>Provenance</summary>
                <pre>{JSON.stringify({ ...o, markdown: undefined }, null, 2)}</pre>
              </details>
              <button type="button" onClick={() => exportOutput(o)}>
                Export Markdown with provenance
              </button>
            </details>
          ))}
        </div>
      )}
    </section>
  )
}
