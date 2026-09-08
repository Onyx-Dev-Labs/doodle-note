import { Menu, Tray, nativeImage, nativeTheme } from 'electron'
import { join } from 'node:path'
import type { RecordingState } from '../shared/recording-api'
import { recordingMenuAction } from './recording-start-coordinator'

/** Persistent launcher; the red dot indicates confirmed capture, never preparation. */
export class RecordingTray {
  private tray: Tray | null = null
  private recording = false
  private images: ReturnType<typeof nativeImage.createFromPath>[] = []
  private updateImage = (): void => {
    const index = this.recording ? (nativeTheme.shouldUseDarkColors ? 2 : 1) : 0
    if (this.tray) this.tray.setImage(this.images[index])
  }

  constructor(
    resourceDir: string,
    private readonly start: () => void,
    private readonly open: () => void
  ) {
    if (process.platform !== 'darwin') return
    this.images = ['dogTemplate.png', 'dogRecordingLight.png', 'dogRecordingDark.png'].map(
      (name, index) => {
        const image = nativeImage.createFromPath(join(resourceDir, name))
        // Template rendering would turn the recording dot monochrome.
        image.setTemplateImage(index === 0)
        return image
      }
    )
    const image = this.images[0]
    this.tray = new Tray(image)
    this.tray.setToolTip('DoodleNote')
    nativeTheme.on('updated', this.updateImage)
    this.update({ phase: 'idle', eligible: false, meetingId: null })
  }
  update(state: RecordingState): void {
    this.recording = state.phase === 'recording'
    this.updateImage()
    this.tray?.setToolTip(this.recording ? 'DoodleNote — Recording' : 'DoodleNote')
    this.tray?.setContextMenu(
      Menu.buildFromTemplate([
        { ...recordingMenuAction(state), click: () => this.start() },
        { type: 'separator' },
        { label: 'Open DoodleNote', click: () => this.open() }
      ])
    )
  }
  dispose(): void {
    nativeTheme.removeListener('updated', this.updateImage)
    this.tray?.destroy()
    this.tray = null
  }
}
