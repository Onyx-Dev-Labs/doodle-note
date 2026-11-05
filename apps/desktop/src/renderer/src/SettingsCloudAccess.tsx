import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SyncStatus } from '../../shared/sync-api'
import { SettingsIcon } from './SettingsIcon'

/** Presentation of the approved Cloud Sync design; service authorization stays in main. */
export function SettingsCloudAccess({
  active,
  status,
  children,
  onConnect,
  onDisconnect
}: {
  active: boolean
  status: SyncStatus | null
  children: ReactNode
  onConnect: () => void
  onDisconnect: () => void
}): React.JSX.Element {
  const [eligibleIdentity, setEligibleIdentity] = useState<string | null>(null)
  const identity = JSON.stringify([status?.baseUrl, status?.connectionRevision])
  const [checking, setChecking] = useState(false)
  const refreshRef = useRef<() => void>(() => {})
  const connected = status?.connected === true
  useEffect(() => {
    let request = 0
    const refresh = (): void => {
      const current = ++request
      setEligibleIdentity(null)
      if (!active || !connected) {
        setChecking(false)
        return
      }
      setChecking(true)
      void window.sync.getRemoteMcpEligibility().then(
        (allowed) => {
          if (current === request) {
            setEligibleIdentity(allowed === true ? identity : null)
            setChecking(false)
          }
        },
        () => {
          if (current === request) {
            setEligibleIdentity(null)
            setChecking(false)
          }
        }
      )
    }
    const offline = (): void => {
      request++
      setEligibleIdentity(null)
      setChecking(false)
    }
    refreshRef.current = refresh
    refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    window.addEventListener('offline', offline)
    return () => {
      request++
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      window.removeEventListener('offline', offline)
    }
  }, [active, connected, identity])
  const unlocked = active && connected && eligibleIdentity === identity
  return (
    <div className={`settings-cloud-access${unlocked ? '' : ' is-locked'}`}>
      <div
        className="settings-cloud-controls"
        inert={!unlocked}
        aria-hidden={!unlocked ? true : undefined}
      >
        {children}
      </div>
      {!unlocked && (
        <div className="settings-cloud-unlock">
          <span className="settings-cloud-lock">
            <SettingsIcon name="lock" />
          </span>
          <h2>{checking ? 'Checking Cloud Sync access…' : 'Unlock with Cloud Sync'}</h2>
          <p>Bring your notes together with cloud sync, remote MCP, and agent access.</p>
          <button
            type="button"
            className="pill-btn settings-cloud-upgrade"
            onClick={() => window.open('https://www.doodlenote.ai/pricing')}
          >
            Get Cloud Sync <SettingsIcon name="plus" size={16} />
          </button>
          {connected ? (
            <>
              <button
                type="button"
                className="settings-cloud-existing"
                disabled={checking}
                onClick={() => refreshRef.current()}
              >
                Check subscription again
              </button>
              <button type="button" className="settings-cloud-existing" onClick={onDisconnect}>
                Disconnect account
              </button>
            </>
          ) : (
            <button
              type="button"
              className="settings-cloud-existing"
              disabled={!status || status.linking}
              onClick={onConnect}
            >
              Already subscribed? Connect your account
            </button>
          )}
        </div>
      )}
    </div>
  )
}
