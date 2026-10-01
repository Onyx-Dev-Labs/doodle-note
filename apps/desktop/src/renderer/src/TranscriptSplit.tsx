import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

const STORAGE_KEY = 'doodle.transcriptPaneSize'
function readSize(): number {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY))
    return saved > 0 && saved < 100 ? saved : 50
  } catch {
    return 50
  }
}

/** Layout owns only presentation. Capture/listeners stay mounted in MeetingView. */
export function TranscriptSplit({
  open,
  children
}: {
  open: boolean
  children: ReactNode
}): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(readSize)
  const [bounds, setBounds] = useState({ width: 0, height: 0 })
  const wide = bounds.width >= 760
  const extent = (wide ? bounds.width : bounds.height) - 12
  const minimum = Math.min(45, Math.ceil(((wide ? 300 : 130) / Math.max(1, extent)) * 100))
  const maximum = Math.max(55, 100 - Math.ceil(((wide ? 280 : 160) / Math.max(1, extent)) * 100))
  const shown = Math.min(maximum, Math.max(minimum, size))
  useEffect(() => {
    const element = root.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) =>
      setBounds({ width: entry.contentRect.width, height: entry.contentRect.height })
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(size))
    } catch {
      /* Optional preference storage. */
    }
  }, [size])
  const resize = (value: number): void => setSize(Math.min(maximum, Math.max(minimum, value)))
  return (
    <div
      ref={root}
      className={`meeting-split${open ? ' is-open' : ''}${wide ? ' is-wide' : ''}`}
      style={{ '--notes-share': `${shown}%` } as CSSProperties}
    >
      {children}
      {open && (
        <div
          className="transcript-divider"
          role="separator"
          tabIndex={0}
          aria-label="Resize notes and transcript"
          aria-orientation={wide ? 'vertical' : 'horizontal'}
          aria-valuemin={minimum}
          aria-valuemax={maximum}
          aria-valuenow={Math.round(shown)}
          aria-valuetext={`${Math.round(shown)} percent notes`}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            event.preventDefault()
            event.currentTarget.focus()
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId) || !root.current) return
            const rect = root.current.getBoundingClientRect()
            resize(
              ((wide ? event.clientX - rect.left : event.clientY - rect.top) /
                Math.max(1, extent)) *
                100
            )
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onKeyDown={(event) => {
            const decrease = wide ? 'ArrowLeft' : 'ArrowUp'
            const increase = wide ? 'ArrowRight' : 'ArrowDown'
            if (![decrease, increase, 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            resize(
              event.key === 'Home'
                ? minimum
                : event.key === 'End'
                  ? maximum
                  : shown + (event.key === decrease ? -5 : 5)
            )
          }}
        >
          <span />
        </div>
      )}
    </div>
  )
}
