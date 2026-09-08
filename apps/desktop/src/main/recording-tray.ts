import { Menu, Tray, nativeImage } from 'electron'
import { join } from 'node:path'
import type { RecordingState } from '../shared/recording-api'
import { recordingMenuAction } from './recording-start-coordinator'

/** Calendar countdown and PR #119's capture indicator remain separate. */
export class RecordingTray {
  private tray: Tray | null = null
  constructor(
    resourceDir: string,
    private readonly start: () => void,
    private readonly open: () => void
  ) {
    if (process.platform !== 'darwin') return
    const image = nativeImage.createFromPath(join(resourceDir, 'dogTemplate.png'))
    image.setTemplateImage(true)
    this.tray = new Tray(image)
    this.tray.setToolTip('DoodleNote')
    this.update({ phase: 'idle', eligible: false, meetingId: null })
  }
  update(state: RecordingState): void {
    this.tray?.setContextMenu(
      Menu.buildFromTemplate([
        { ...recordingMenuAction(state), click: () => this.start() },
        { type: 'separator' },
        { label: 'Open DoodleNote', click: () => this.open() }
      ])
    )
  }
  dispose(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
