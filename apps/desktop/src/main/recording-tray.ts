import { app, Menu, Tray, nativeImage } from 'electron'
import { join } from 'node:path'
import type { CalendarState } from '../shared/calendar-api'
import type { RecordingState } from '../shared/recording-api'
import { trayTitle, upcomingTrayEvents } from './calendar-events'
import { recordingMenuAction } from './recording-start-coordinator'

/** Windows notification-area tooltips are cut off past 127 characters. */
const WINDOWS_TOOLTIP_MAX = 127

const WINDOWS_PHASE_TOOLTIP: Record<RecordingState['phase'], string> = {
  idle: 'DoodleNote',
  requested: 'DoodleNote — Starting…',
  starting: 'DoodleNote — Starting…',
  recording: 'DoodleNote — Recording',
  finishing: 'DoodleNote — Finishing…'
}

/**
 * Persistent launcher; the red face indicates confirmed capture, never preparation.
 * macOS: a menu-bar dog (template image) with an optional "Full Island" title.
 * Windows: a notification-area dog with the same menu; the next meeting and the
 * recording phase live in the tooltip because Windows tray icons have no title.
 */
export class RecordingTray {
  private tray: Tray | null = null
  private state: RecordingState = { phase: 'idle', eligible: false, meetingId: null }
  private calendar: CalendarState | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private recording = false
  private readonly windows = process.platform === 'win32'
  /** One "still recording" hint per recording, not per close. */
  private hintShown = false
  /** Windows: Quit is waiting for the recording to be saved. */
  private savingBeforeQuit = false
  /** Windows: the window was closed; DoodleNote quits once notes finish. */
  private finishingNotes = false
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
    if (this.windows) {
      // Multi-size icons: Windows picks 16–48 px for the display scale.
      this.images = ['dogWin.ico', 'dogWinRecording.ico'].map((name) =>
        nativeImage.createFromPath(join(resourceDir, name))
      )
      this.tray = new Tray(this.images[0])
      this.tray.setToolTip('DoodleNote')
      // Windows convention: a left click opens the app; right click shows the menu.
      this.tray.on('click', () => this.open())
      this.render()
      this.timer = setInterval(() => this.render(), 30_000)
      this.timer.unref()
      return
    }
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
    if (state.phase === 'idle') this.hintShown = false
    this.updateImage()
    this.render()
  }
  updateCalendar(calendar: CalendarState): void {
    this.calendar = calendar
    this.render()
  }
  /**
   * Windows: the window was closed while recording and is now hidden. Say once
   * per recording that capture continues and where to find it.
   */
  showBackgroundHint(): void {
    if (!this.windows || !this.tray || this.hintShown) return
    this.hintShown = true
    const phase = this.state.phase
    this.tray.displayBalloon({
      iconType: 'info',
      title:
        phase === 'finishing'
          ? 'DoodleNote is saving the recording'
          : phase === 'recording'
            ? 'DoodleNote is still recording'
            : 'DoodleNote is starting the recording',
      content:
        phase === 'finishing'
          ? 'DoodleNote closes when the recording is saved. Click the DoodleNote icon in the notification area to open it instead.'
          : 'Recording continues in the background, and DoodleNote closes when it ends. Click the DoodleNote icon in the notification area to return and stop it.',
      noSound: true
    })
  }
  /**
   * Windows: the recording ended with its window closed; automatic notes are
   * finishing before DoodleNote quits. Open and Quit stay available.
   */
  showFinishingNotes(active: boolean): void {
    if (!this.windows || !this.tray || this.finishingNotes === active) return
    this.finishingNotes = active
    this.render()
  }
  /**
   * Windows: Quit waits (bounded) for the recording to be saved. Keep the icon
   * and say so, instead of vanishing while the app is still finishing.
   */
  showSavingBeforeQuit(): void {
    if (!this.windows || !this.tray) return
    this.savingBeforeQuit = true
    this.render()
  }
  private render(): void {
    if (!this.tray) return
    if (this.windows) {
      this.renderWindows()
      return
    }
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
        ...this.meetingItems(meetings),
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
  private renderWindows(): void {
    if (!this.tray) return
    if (this.savingBeforeQuit) {
      this.tray.setToolTip('DoodleNote — Saving recording…')
      this.tray.setContextMenu(
        Menu.buildFromTemplate([{ label: 'Saving recording before quitting…', enabled: false }])
      )
      return
    }
    if (this.finishingNotes) {
      this.tray.setToolTip('DoodleNote — Finishing notes…')
      this.tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: 'Finishing notes, then closing…', enabled: false },
          { type: 'separator' },
          { label: 'Open DoodleNote', click: () => this.open() },
          { type: 'separator' },
          { label: 'Quit DoodleNote', click: () => app.quit() }
        ])
      )
      return
    }
    const now = Date.now()
    const meetings = upcomingTrayEvents(this.calendar?.signedIn ? this.calendar.events : [], now, 3)
    const next = meetings[0] ? trayTitle(meetings[0], now) : ''
    this.tray.setToolTip(
      [WINDOWS_PHASE_TOOLTIP[this.state.phase], next]
        .filter(Boolean)
        .join('\n')
        .slice(0, WINDOWS_TOOLTIP_MAX)
    )
    // Same items as the macOS menu, without Compact / Full Island: those only
    // choose the menu-bar title, which Windows tray icons cannot show.
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { ...recordingMenuAction(this.state), click: () => this.start() },
        { type: 'separator' },
        { label: 'Open DoodleNote', click: () => this.open() },
        { type: 'separator' },
        { label: 'Today', enabled: false },
        ...this.meetingItems(meetings),
        { type: 'separator' },
        { label: 'Quit DoodleNote', click: () => app.quit() }
      ])
    )
  }
  private meetingItems(
    meetings: ReturnType<typeof upcomingTrayEvents>
  ): Electron.MenuItemConstructorOptions[] {
    if (!meetings.length)
      return [
        {
          label: this.calendar?.signedIn ? 'No more meetings today' : 'No calendar connected',
          enabled: false
        }
      ]
    return meetings.map((event) => ({
      label: `${new Date(event.startIso).toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit'
      })} — ${event.subject.trim() || 'Untitled meeting'}${event.sourceLabel ? ` (${event.sourceLabel})` : ''}${event.stale ? ' · May be out of date' : ''}`,
      enabled: false
    }))
  }
  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.tray?.destroy()
    this.tray = null
  }
}
