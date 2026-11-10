import { useEffect, useRef, type ReactNode } from 'react'

/** Native, keyboard-accessible disclosure; controls stay mounted when collapsed. */
export function SettingsFold({
  title,
  description,
  children,
  attention
}: {
  title: string
  description: string
  children: ReactNode
  /** Reveal new errors or recovery work without resetting normal disclosure state. */
  attention?: string | number | boolean | null
}): React.JSX.Element {
  const details = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (attention && details.current) details.current.open = true
  }, [attention])

  return (
    <details open ref={details} className="keys-section settings-fold" aria-label={title}>
      <summary>
        <h3>
          {title}
          <small className="settings-fold-description">{description}</small>
        </h3>
      </summary>
      <div className="settings-fold-body">{children}</div>
    </details>
  )
}
