/**
 * Shared UI icon set — hand-inlined stroke icons (lucide-style geometry,
 * 24×24 viewBox, currentColor) so nothing in the product chrome renders as
 * an emoji. Sized via the `size` prop; `.ico` handles inline baseline
 * alignment (see main.css).
 */

function Icon({
  children,
  size = 16
}: {
  children: React.ReactNode
  size?: number
}): React.JSX.Element {
  return (
    <svg
      className="ico"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function GearIcon({ size }: { size?: number }): React.JSX.Element {
  return (
    <Icon {...(size !== undefined ? { size } : {})}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  )
}

export function CalendarIcon({ size }: { size?: number }): React.JSX.Element {
  return (
    <Icon {...(size !== undefined ? { size } : {})}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </Icon>
  )
}

export function CloudIcon({ size }: { size?: number }): React.JSX.Element {
  return (
    <Icon {...(size !== undefined ? { size } : {})}>
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    </Icon>
  )
}

export function SparkleIcon({ size }: { size?: number }): React.JSX.Element {
  return (
    <Icon {...(size !== undefined ? { size } : {})}>
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z" />
      <path d="M19 3v4M21 5h-4" />
    </Icon>
  )
}

export function HomeIcon({ size }: { size?: number }): React.JSX.Element {
  return (
    <Icon {...(size !== undefined ? { size } : {})}>
      <path d="M3 10.2a2 2 0 0 1 .7-1.5l7-6a2 2 0 0 1 2.6 0l7 6a2 2 0 0 1 .7 1.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 21v-6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6" />
    </Icon>
  )
}

export function PencilIcon({ size }: { size?: number }): React.JSX.Element {
  return (
    <Icon {...(size !== undefined ? { size } : {})}>
      <path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </Icon>
  )
}

export function FolderIcon({ size }: { size?: number }): React.JSX.Element {
  return (
    <Icon {...(size !== undefined ? { size } : {})}>
      <path d="M3 7a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.7.9l.8 1.2a2 2 0 0 0 1.7.9H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Icon>
  )
}

export function TrashIcon({ size }: { size?: number }): React.JSX.Element {
  return (
    <Icon {...(size !== undefined ? { size } : {})}>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </Icon>
  )
}

export function DocIcon({ size }: { size?: number }): React.JSX.Element {
  return (
    <Icon {...(size !== undefined ? { size } : {})}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M8 13h8M8 17h5" />
    </Icon>
  )
}

export function MicIcon({ size }: { size?: number }): React.JSX.Element {
  return (
    <Icon {...(size !== undefined ? { size } : {})}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M19 10a7 7 0 0 1-14 0M12 17v4" />
    </Icon>
  )
}

export function UsersIcon({ size }: { size?: number }): React.JSX.Element {
  return (
    <Icon {...(size !== undefined ? { size } : {})}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </Icon>
  )
}

export function MailIcon({ size }: { size?: number }): React.JSX.Element {
  return (
    <Icon {...(size !== undefined ? { size } : {})}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </Icon>
  )
}

export function ImageIcon({ size }: { size?: number }): React.JSX.Element {
  return (
    <Icon {...(size !== undefined ? { size } : {})}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
    </Icon>
  )
}

export function LockIcon({ size }: { size?: number }): React.JSX.Element {
  return (
    <Icon {...(size !== undefined ? { size } : {})}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Icon>
  )
}

export function CheckSquareIcon({ size }: { size?: number }): React.JSX.Element {
  return (
    <Icon {...(size !== undefined ? { size } : {})}>
      <path d="m9 11 3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </Icon>
  )
}
