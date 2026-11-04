import { useState } from 'react'
import type { DictationSettingsUpdate, DictationStatus } from '../../shared/dictation-api'
import { MAX_DICTIONARY_ENTRIES, MAX_PHRASE_CHARS } from '../../shared/dictation-dictionary'
import { Toggle } from './ModelsView'

interface Props {
  status: DictationStatus
  update: (patch: DictationSettingsUpdate) => Promise<void>
}

const REASONS = {
  invalid: 'Use one to four words, up to 60 characters, on one line.',
  full: `The dictionary holds up to ${MAX_DICTIONARY_ENTRIES} entries. Remove some first.`,
  unchanged: 'That entry is already in the dictionary.'
} as const

/** Words the speech recognizer gets wrong, and the learning that fills them in. */
export function DictationDictionarySettings({ status, update }: Props): React.JSX.Element {
  const { settings } = status
  const [heard, setHeard] = useState('')
  const [written, setWritten] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const learned = settings.dictionary.filter((entry) => entry.source === 'learned')

  const add = async (): Promise<void> => {
    const outcome = await window.dictation.addDictionaryEntry({ heard, written })
    if (outcome.ok) {
      setHeard('')
      setWritten('')
      setMessage(null)
    } else {
      setMessage(REASONS[outcome.reason])
    }
  }

  return (
    <section className="keys-section">
      <h3>Dictionary</h3>
      <p className="models-sub">
        Names and terms the recognizer spells wrong. Each entry says what it hears and how to write
        it, and applies to every dictation, whatever the tidy-up level. Leave the first box empty to
        always write a word exactly the way you type it (for example DoodleNote).
      </p>
      <div className="cal-subcard">
        <div className="cal-row">
          <span className="cal-row-main">
            <span className="cal-row-label">Learn from my corrections</span>
            <span className="cal-row-sub">
              After a dictation is typed, DoodleNote reads that one field back for a few minutes. If
              you fix a misheard word and send the message, the fix is added here. It only learns
              changes that look like a misspelling, never a different word you meant, never a
              password field, and it keeps the corrected words only: not the message, and nothing is
              sent anywhere.
            </span>
          </span>
          <Toggle
            checked={settings.learnFromEdits}
            label="Learn from my corrections"
            onChange={() => void update({ learnFromEdits: !settings.learnFromEdits })}
          />
        </div>
      </div>
      <form
        className="dict-add"
        onSubmit={(event) => {
          event.preventDefault()
          void add()
        }}
      >
        <label>
          <span>When it hears</span>
          <input
            type="text"
            value={heard}
            maxLength={MAX_PHRASE_CHARS}
            placeholder="Alec"
            onChange={(event) => setHeard(event.target.value)}
          />
        </label>
        <span className="dict-arrow" aria-hidden="true">
          →
        </span>
        <label>
          <span>Write</span>
          <input
            type="text"
            value={written}
            maxLength={MAX_PHRASE_CHARS}
            placeholder="Alex"
            onChange={(event) => setWritten(event.target.value)}
          />
        </label>
        <button type="submit" className="pill-btn" disabled={written.trim() === ''}>
          Add
        </button>
      </form>
      {message && (
        <p className="models-sub" role="status">
          {message}
        </p>
      )}
      {settings.dictionary.length === 0 ? (
        <p className="models-sub">
          Nothing here yet. Add a word above, or fix a misheard word in a message you dictated and
          it will appear.
        </p>
      ) : (
        <ul className="dict-list" aria-label="Dictionary entries">
          {settings.dictionary.map((entry) => (
            <li key={entry.id} className="dict-row">
              <span className="dict-words">
                {entry.from ? (
                  <>
                    <span className="dict-from">{entry.from}</span>
                    <span className="dict-arrow" aria-hidden="true">
                      →
                    </span>
                    <span className="dict-to">{entry.to}</span>
                  </>
                ) : (
                  <span className="dict-to">{entry.to}</span>
                )}
              </span>
              <span className={entry.source === 'learned' ? 'dict-tag learned' : 'dict-tag'}>
                {entry.source === 'learned' ? 'Learned' : entry.from ? 'Added' : 'Spelling'}
              </span>
              <button
                type="button"
                className="pill-btn"
                aria-label={`Remove ${entry.from ? `${entry.from} to ` : ''}${entry.to}`}
                onClick={() => void window.dictation.removeDictionaryEntry(entry.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {learned.length > 0 && (
        <div>
          <button
            type="button"
            className="pill-btn"
            onClick={() => void window.dictation.clearLearnedEntries()}
          >
            Remove all learned ({learned.length})
          </button>
        </div>
      )}
    </section>
  )
}
