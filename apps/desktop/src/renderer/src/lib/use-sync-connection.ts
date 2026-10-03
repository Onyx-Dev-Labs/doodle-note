import { useCallback, useEffect, useRef, useState } from 'react'
import type { SyncStatus } from '../../../shared/sync-api'
import { latestSyncStatus } from './sync-status'

export function useSyncConnection(active = true): {
  status: SyncStatus | null
  error: string | null
  adoptStatus: (next: SyncStatus) => void
  connect: () => Promise<void>
  cancel: () => Promise<void>
} {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const command = useRef({ generation: 0, mounted: false })
  const adoptStatus = useCallback((next: SyncStatus) => {
    setStatus((previous) => latestSyncStatus(previous, next))
  }, [])

  useEffect(() => {
    const lifecycle = command.current
    let mounted = true
    lifecycle.mounted = true
    const adopt = (next: SyncStatus): void => {
      if (mounted) adoptStatus(next)
    }
    const off = window.sync.onStatus(adopt)
    if (active)
      void window.sync
        .getStatus()
        .then(adopt)
        .catch(() => {
          if (mounted)
            setError('Could not load cloud connection status. Reopen Settings to try again.')
        })
    return () => {
      mounted = false
      lifecycle.mounted = false
      lifecycle.generation++
      off()
    }
  }, [active, adoptStatus, command])

  const run = useCallback(
    async (action: 'connect' | 'cancelConnect') => {
      const lifecycle = command.current
      const request = ++lifecycle.generation
      setError(null)
      try {
        const next = await window.sync[action]()
        if (lifecycle.mounted && request === lifecycle.generation) adoptStatus(next)
      } catch {
        if (lifecycle.mounted && request === lifecycle.generation) {
          setError('Could not update the cloud connection. Please try again.')
        }
      }
    },
    [adoptStatus, command]
  )

  return {
    status,
    error,
    adoptStatus,
    connect: () => run('connect'),
    cancel: () => run('cancelConnect')
  }
}
