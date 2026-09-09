import { useEffect, useState } from 'react'
import { RemoteMcpSetup } from './RemoteMcpSetup'

/** Mount afresh on entering Integrations or changing the linked account/server. */
export function PaidRemoteMcpSetup({ baseUrl }: { baseUrl: string }): React.JSX.Element | null {
  const [eligible, setEligible] = useState(false)

  useEffect(() => {
    let request = 0
    const refresh = (): void => {
      const current = ++request
      setEligible(false)
      void window.sync.getRemoteMcpEligibility().then(
        (allowed) => {
          if (current === request) setEligible(allowed === true)
        },
        () => {
          if (current === request) setEligible(false)
        }
      )
    }
    refresh()
    const offline = (): void => {
      request++
      setEligible(false)
    }
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    window.addEventListener('offline', offline)
    return () => {
      request++
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      window.removeEventListener('offline', offline)
    }
  }, [])

  return eligible ? <RemoteMcpSetup baseUrl={baseUrl} /> : null
}
