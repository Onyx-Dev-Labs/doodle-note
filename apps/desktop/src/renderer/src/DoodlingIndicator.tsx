import { useEffect, useState } from 'react'

/**
 * The "generating notes" state, on brand: a trot of paw prints padding
 * across the pill while short doodle-flavored phrases rotate underneath the
 * cursor — DoodleNote's doodle-dog mascot and the
 * doodles everyone leaves in the margins of real notepads. Replaces the raw
 * streamed-word counter (which was noise, not progress).
 */

const PHRASES = ['Doodling your notes…', 'Fetching the highlights…', 'Connecting the dots…']
const PHRASE_ROTATE_MS = 2_800

function PawPrint({ size = 11 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <ellipse cx="12" cy="16.5" rx="5.2" ry="4.6" />
      <ellipse cx="4.6" cy="10.5" rx="2.4" ry="3.1" transform="rotate(-20 4.6 10.5)" />
      <ellipse cx="9.4" cy="6.6" rx="2.5" ry="3.3" transform="rotate(-8 9.4 6.6)" />
      <ellipse cx="14.6" cy="6.6" rx="2.5" ry="3.3" transform="rotate(8 14.6 6.6)" />
      <ellipse cx="19.4" cy="10.5" rx="2.4" ry="3.1" transform="rotate(20 19.4 10.5)" />
    </svg>
  )
}

function DoodlingIndicator({ statusText }: { statusText?: string | null }): React.JSX.Element {
  const [phrase, setPhrase] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setPhrase((p) => (p + 1) % PHRASES.length), PHRASE_ROTATE_MS)
    return () => clearInterval(timer)
  }, [])

  return (
    <span className="doodling" role="status" aria-label="Generating notes">
      <span className="paw-walk" aria-hidden="true">
        <span className="paw paw-1">
          <PawPrint />
        </span>
        <span className="paw paw-2">
          <PawPrint />
        </span>
        <span className="paw paw-3">
          <PawPrint />
        </span>
        <span className="paw paw-4">
          <PawPrint />
        </span>
      </span>
      {/* key remount restarts the fade-in on every phrase change; concrete
          progress (long-meeting condensation) overrides the whimsy */}
      <span className="doodling-phrase" key={statusText ?? phrase}>
        {statusText ?? PHRASES[phrase]}
      </span>
    </span>
  )
}

export default DoodlingIndicator
