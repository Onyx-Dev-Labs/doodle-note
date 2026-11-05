/** The approved Settings preview icons, with a stronger stroke at UI sizes. */
const paths = {
  general: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 21v-3a7 7 0 0 1 14 0v3" />
    </>
  ),
  appearance: (
    <>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M9 22h6M12 18v4M3 14h18" />
    </>
  ),
  recording: (
    <>
      <rect x="9" y="2" width="6" height="13" rx="3" />
      <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 2v6M17 2v6M3 11h18M7 15h3M14 15h3" />
    </>
  ),
  cloud: <path d="M6 18a4 4 0 0 1-.7-7.94 7 7 0 0 1 13.4-.9A4.5 4.5 0 0 1 18 18z" />,
  sparkle: <path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z" />,
  storage: (
    <>
      <rect x="3" y="5" width="18" height="15" rx="2" />
      <path d="M3 10h18M9 15h6" />
    </>
  ),
  integrations: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M14 17.5h7M17.5 14v7" />
    </>
  ),
  notebook: (
    <>
      <rect x="5" y="3" width="15" height="18" rx="1.5" />
      <path d="M3 7h4M3 12h4M3 17h4M11 8h5M11 12h5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="3" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2" />
    </>
  ),
  shield: (
    <>
      <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" />
      <path d="m8 12 3 3 5-6" />
    </>
  )
}
export type SettingsIconName = keyof typeof paths
export function SettingsIcon({
  name,
  size = 22
}: {
  name: SettingsIconName
  size?: number
}): React.JSX.Element {
  return (
    <svg
      className="settings-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}
