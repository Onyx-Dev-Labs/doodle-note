import { app, Menu, Tray, nativeImage } from 'electron'
import { join } from 'node:path'
import type { CalendarState } from '../shared/calendar-api'
import type { RecordingState } from '../shared/recording-api'
import { trayTitle, upcomingTrayEvents } from './calendar-events'
import { recordingMenuAction } from './recording-start-coordinator'

/** Persistent launcher; the red face indicates confirmed capture, never preparation. */
export class RecordingTray {
  private tray: Tray | null = null
  private state: RecordingState = { phase: 'idle', eligible: false, meetingId: null }
  private calendar: CalendarState | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private recording = false
  private images: ReturnType<typeof nativeImage.createFromPath>[] = []
  private updateImage = (): void => {
    // App theme can differ from the menu bar; keep the recording body white.
    const index = this.recording ? 1 : 0
    if (this.tray) this.tray.setImage(this.images[index])
  }

  constructor(
    resourceDir: string,
    private readonly start: () => void,
    private readonly open: () => void,
    private readonly setFullIsland: (enabled: boolean) => void
  ) {
    if (process.platform !== 'darwin') return
    this.images = ['dogTemplate.png', 'dogRecording.png'].map((name, index) => {
      const image = nativeImage.createFromPath(join(resourceDir, name))
      // Template rendering would turn the recording facial features monochrome.
      image.setTemplateImage(index === 0)
      return image
    })
    const image = this.images[0]
    this.tray = new Tray(image)
    this.tray.setToolTip('DoodleNote')
    this.render()
    // Also update across midnight, sleep/wake and timezone changes without
    // relying on a calendar refresh or a recording state change.
    this.timer = setInterval(() => this.render(), 30_000)
    this.timer.unref()
  }
  update(state: RecordingState): void {
    this.state = state
    this.recording = state.phase === 'recording'
    this.updateImage()
    this.render()
  }
  updateCalendar(calendar: CalendarState): void {
    this.calendar = calendar
    this.render()
  }
  private render(): void {
    if (!this.tray) return
    const now = Date.now()
    const meetings = upcomingTrayEvents(this.calendar?.signedIn ? this.calendar.events : [], now, 3)
    const fullIsland = this.calendar?.prefs.showMenuBar ?? true
    const title = fullIsland && meetings[0] ? trayTitle(meetings[0], now) : ''
    this.tray.setTitle(title, { fontType: 'monospacedDigit' })
    this.tray.setToolTip(
      [this.recording ? 'DoodleNote — Recording' : 'DoodleNote', title].filter(Boolean).join(' — ')
    )
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { ...recordingMenuAction(this.state), click: () => this.start() },
        { type: 'separator' },
        { label: 'Open DoodleNote', click: () => this.open() },
        { type: 'separator' },
        { label: 'Today', enabled: false },
        ...meetings.map((event) => ({
          label: `${new Date(event.startIso).toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit'
          })} — ${event.subject.trim() || 'Untitled meeting'}`,
          enabled: false
        })),
        ...(meetings.length
          ? []
          : [
              {
                label: this.calendar?.signedIn ? 'No more meetings today' : 'No calendar connected',
                enabled: false
              }
            ]),
        { type: 'separator' },
        {
          label: 'Compact',
          type: 'radio',
          checked: !fullIsland,
          click: () => this.setFullIsland(false)
        },
        {
          label: 'Full Island',
          type: 'radio',
          checked: fullIsland,
          click: () => this.setFullIsland(true)
        },
        { type: 'separator' },
        { label: 'Quit DoodleNote', click: () => app.quit() }
      ])
    )
  }
  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.tray?.destroy()
    this.tray = null
  }
}
