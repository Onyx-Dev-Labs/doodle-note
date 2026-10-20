import { ipcMain } from 'electron'
import { libraryIpc } from './library-ipc'
import { RecipeRunner } from './recipe-runner'
import {
  RECIPE_CHANNELS,
  type RecipeResult,
  type RecipeRun,
  type RecipesApi
} from '../shared/recipes-api'

async function result<T>(work: () => T | Promise<T>): Promise<RecipeResult<T>> {
  try {
    return { value: await work() }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}
export function registerRecipes(runner: RecipeRunner): void {
  libraryIpc.handle(RECIPE_CHANNELS.list, (_event, meetingId: string) =>
    result(() => runner.list(meetingId))
  )
  libraryIpc.handle(RECIPE_CHANNELS.save, (_event, ...args: Parameters<RecipesApi['save']>) =>
    result(() => runner.save(...args))
  )
  ipcMain.handle(RECIPE_CHANNELS.run, async (event, request: RecipeRun) => {
    const cancel = (): void => {
      if (request) runner.cancel(request, event.sender.id)
    }
    event.sender.on('destroyed', cancel)
    event.sender.on('render-process-gone', cancel)
    event.sender.on('did-start-loading', cancel)
    try {
      return await result(() => runner.run(request, event.sender.id))
    } finally {
      event.sender.removeListener('destroyed', cancel)
      event.sender.removeListener('render-process-gone', cancel)
      event.sender.removeListener('did-start-loading', cancel)
    }
  })
  // Cancellation bypasses the relocation barrier and is scoped to the renderer owner + run.
  ipcMain.handle(RECIPE_CHANNELS.cancel, (event, identity) =>
    identity ? runner.cancel(identity, event.sender.id) : false
  )
}
