import { useId, type ReactNode } from 'react'

/** New connections stay unavailable until Google approves app verification. */
export function GoogleCalendarPending({
  buttonClassName,
  children
}: {
  buttonClassName: string
  children: ReactNode
}): React.JSX.Element {
  const descriptionId = useId()
  return (
    <div className="google-calendar-pending">
      <button type="button" className={buttonClassName} disabled aria-describedby={descriptionId}>
        {children}
      </button>
      <span id={descriptionId} className="google-calendar-pending-note">
        Awaiting Google verification approval.
      </span>
    </div>
  )
}
