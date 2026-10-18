import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { CensusRequest } from '@repo/meetings-store/evidence-contract'
import type { CitedAudioPlayback } from '../shared/cited-ask-api'
import {
  HOME_CITED_STATUS,
  HOME_CITED_ASK,
  HOME_CITED_CANCEL,
  HOME_CITED_HISTORY,
  HOME_CITED_CLEAR,
  HOME_CITED_RESOLVE,
  HOME_CITED_PLAY,
  HOME_CITED_CENSUS,
  HOME_CITED_PROGRESS,
  HOME_CITED_CHANGED
} from '../shared/home-cited-api'
import type { CitedRendererOwners, CitedOwnerLease } from './cited-ask-host'
import type { HomeCitedController } from './home-cited-controller'

export function installHomeCitedIpc(deps: {
  ipc: Pick<IpcMain, 'handle'>
  owners: CitedRendererOwners
  controller: HomeCitedController
  enabled(): boolean
  play?(
    entryId: unknown,
    evidenceId: unknown,
    token: unknown,
    owner: CitedOwnerLease
  ): Promise<CitedAudioPlayback>
}): void {
  const bind = (
    channel: string,
    arity: number,
    operation: (owner: CitedOwnerLease, args: unknown[]) => unknown
  ): void => {
    deps.ipc.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const owner = deps.owners.capture(event)
      if (args.length !== arity) throw new Error('Invalid cited request.')
      return operation(owner, args)
    })
  }
  bind(HOME_CITED_STATUS, 0, () => ({ enabled: deps.enabled() }))
  bind(HOME_CITED_ASK, 1, (owner, [request]) =>
    deps.controller.ask(request, owner, (phase) => {
      const runId = (request as { runId: string }).runId
      deps.owners.publish(owner.ownerId, HOME_CITED_PROGRESS, { runId, phase })
    })
  )
  bind(HOME_CITED_CANCEL, 1, (owner, [runId]) => deps.controller.cancel(runId, owner))
  bind(HOME_CITED_HISTORY, 0, (owner) => deps.controller.history(owner))
  bind(HOME_CITED_CLEAR, 0, async (owner) => {
    await deps.controller.clear(owner)
    deps.owners.publish(owner.ownerId, HOME_CITED_CHANGED, {})
  })
  bind(HOME_CITED_RESOLVE, 2, (owner, [entryId, evidenceId]) =>
    deps.controller.resolve(entryId, evidenceId, owner)
  )
  bind(HOME_CITED_PLAY, 3, (owner, [entryId, evidenceId, token]) => {
    if (!deps.enabled() || !deps.play) throw new Error('Recording playback is unavailable.')
    return deps.play(entryId, evidenceId, token, owner)
  })
  bind(HOME_CITED_CENSUS, 1, (owner, [request]) =>
    deps.controller.census(request as CensusRequest, owner)
  )
}
