import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { DEFAULT_CALENDAR_PREFS, type CalendarState } from '../shared/calendar-api'
import * as calendarEvents from './calendar-events'
import * as recordingStart from './recording-start-coordinator'

/** Exercise the real controller with only native OS objects and the clock faked. */
interface Fixture {
  controller: import('./recording-tray').RecordingTray
  native: {
    title: string
    destroyed: boolean
    image: { path: string; template: boolean }
    menu: Electron.MenuItemConstructorOptions[]
    tooltip: string
    titles: number
    handlers: Record<string, () => void>
    balloons: Electron.DisplayBalloonOptions[]
  }
  natives: unknown[]
  calendar: CalendarState
  modeChanges: boolean[]
  item(label: string): Electron.MenuItemConstructorOptions
  click(label: string): void
  advance(time: number): void
  counts(): { starts: number; opens: number; quits: number; timerCleared: boolean }
}
function setup(platform: NodeJS.Platform = 'darwin'): Fixture {
  let now = new Date(2026, 8, 9, 10).getTime()
  let tick = (): void => {}
  let timerCleared = false
  let starts = 0
  let opens = 0
  let quits = 0
  const modeChanges: boolean[] = []
  const natives: NativeTray[] = []
  class NativeTray {
    title = ''
    tooltip = ''
    titles = 0
    destroyed = false
    menu: Electron.MenuItemConstructorOptions[] = []
    handlers: Record<string, () => void> = {}
    balloons: Electron.DisplayBalloonOptions[] = []
    constructor(public image: { path: string; template: boolean }) {
      natives.push(this)
    }
    setTitle(title: string): void {
      this.title = title
      this.titles++
    }
    on(event: string, handler: () => void): void {
      this.handlers[event] = handler
    }
    displayBalloon(options: Electron.DisplayBalloonOptions): void {
      this.balloons.push(options)
    }
    setToolTip(tooltip: string): void {
      this.tooltip = tooltip
    }
    setImage(image: typeof this.image): void {
      this.image = image
    }
    setContextMenu(menu: typeof this.menu): void {
      this.menu = menu
    }
    destroy(): void {
      this.destroyed = true
    }
  }
  const exports: Record<string, unknown> = {}
  const dependencies: Record<string, unknown> = {
    electron: {
      app: { quit: () => quits++ },
      Tray: NativeTray,
      Menu: { buildFromTemplate: (items: unknown) => items },
      nativeImage: {
        createFromPath: (path: string) => ({
          path,
          template: false,
          setTemplateImage(value: boolean) {
            this.template = value
          }
        })
      }
    },
    'node:path': { join },
    './calendar-events': calendarEvents,
    './recording-start-coordinator': recordingStart
  }
  const source = ts.transpileModule(readFileSync('src/main/recording-tray.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  runInNewContext(source, {
    exports,
    require: (name: string) => {
      assert.ok(name in dependencies, `unexpected dependency: ${name}`)
      return dependencies[name]
    },
    process: { platform },
    Date: class extends Date {
      static now(): number {
        return now
      }
    },
    setInterval: (callback: () => void) => {
      tick = callback
      return {
        unref() {
          /* No native timer in this fixture. */
        }
      }
    },
    clearInterval: () => {
      timerCleared = true
    }
  })
  const { RecordingTray } = exports as unknown as typeof import('./recording-tray')
  let calendar: CalendarState = {
    configured: true,
    signedIn: true,
    msSignedIn: false,
    googleSignedIn: true,
    prefs: { ...DEFAULT_CALENDAR_PREFS },
    calendars: [],
    events: [
      {
        id: 'today',
        subject: 'Design review',
        startIso: new Date(now + 30 * 60_000).toISOString(),
        endIso: new Date(now + 60 * 60_000).toISOString(),
        isAllDay: false,
        isOnlineMeeting: true,
        calendarId: 'g:work',
        hasParticipants: true
      }
    ]
  }
  const controller = new RecordingTray(
    '/resources',
    () => starts++,
    () => opens++,
    (full) => {
      modeChanges.push(full)
      calendar = { ...calendar, prefs: { ...calendar.prefs, showMenuBar: full } }
      controller.updateCalendar(calendar)
    }
  )
  const native = natives[0]
  const item = (label: string): Electron.MenuItemConstructorOptions => {
    const found = native.menu.find((item) => item.label === label)
    assert.ok(found, `missing menu item: ${label}`)
    return found
  }
  const click = (label: string): void => {
    const action = item(label)
    assert.notEqual(action.enabled, false)
    ;(action.click as () => void)()
  }
  return {
    controller,
    native,
    natives,
    calendar,
    modeChanges,
    item,
    click,
    advance: (time: number): void => {
      now = time
      tick()
    },
    counts: (): { starts: number; opens: number; quits: number; timerCleared: boolean } => ({
      starts,
      opens,
      quits,
      timerCleared
    })
  }
}

test('one dog handles Google-only calendar, mode switches and unchanged recording actions', () => {
  const s = setup()
  assert.equal(s.native.title, '')
  s.controller.updateCalendar(s.calendar)
  assert.equal(s.native.title, 'Design review in 30m')
  assert.equal(s.item('Full Island').checked, true)
  s.controller.update({ phase: 'idle', eligible: true, meetingId: null })
  s.click('Record now')
  s.click('Open DoodleNote')
  s.controller.update({ phase: 'starting', eligible: true, meetingId: 'meeting' })
  assert.equal(s.item('Starting…').enabled, false)
  assert.equal(s.native.image.template, true)
  s.controller.update({ phase: 'recording', eligible: true, meetingId: 'meeting' })
  assert.equal(s.item('Recording…').enabled, false)
  assert.equal(s.native.image.path, join('/resources', 'dogRecording.png'))
  assert.equal(s.native.image.template, false)
  s.click('Compact')
  assert.equal(s.native.title, '')
  assert.equal(s.item('Compact').checked, true)
  assert.equal(s.native.image.path, join('/resources', 'dogRecording.png'))
  s.click('Full Island')
  assert.equal(s.native.title, 'Design review in 30m')
  assert.deepEqual(s.modeChanges, [false, true])
  s.controller.update({ phase: 'finishing', eligible: true, meetingId: 'meeting' })
  assert.equal(s.item('Finishing…').enabled, false)
  assert.equal(s.native.image.template, true)
  assert.equal(s.natives.length, 1)
  s.click('Quit DoodleNote')
  s.controller.dispose()
  assert.equal(s.native.destroyed, true)
  assert.deepEqual(s.counts(), { starts: 1, opens: 1, quits: 1, timerCleared: true })
})

test('today ends without hiding the dog or changing the saved Full Island choice', () => {
  const s = setup()
  const tomorrow = {
    ...s.calendar.events[0],
    id: 'tomorrow',
    subject: 'Tomorrow review',
    startIso: new Date(2026, 8, 10, 10).toISOString(),
    endIso: new Date(2026, 8, 10, 11).toISOString()
  }
  s.controller.updateCalendar({ ...s.calendar, events: [...s.calendar.events, tomorrow] })
  assert.equal(
    s.native.menu.some((item) => item.label?.includes('Tomorrow review')),
    false
  )
  s.advance(new Date(2026, 8, 9, 11).getTime())
  assert.equal(s.native.title, '')
  assert.equal(s.item('No more meetings today').enabled, false)
  assert.equal(s.item('Full Island').checked, true)
  assert.equal(s.native.destroyed, false)
  s.advance(new Date(2026, 8, 10, 9, 30).getTime())
  assert.equal(s.native.title, 'Tomorrow review in 30m')
  s.controller.updateCalendar({ ...s.calendar, signedIn: false, events: [] })
  assert.equal(s.native.title, '')
  assert.equal(s.item('No calendar connected').enabled, false)
  assert.equal(s.natives.length, 1)
  s.controller.dispose()
})

test('macOS keeps the template menu-bar dog, title and Full Island items, with no Windows-only hooks', () => {
  const s = setup('darwin')
  assert.equal(s.native.image.path, join('/resources', 'dogTemplate.png'))
  assert.equal(s.native.image.template, true)
  assert.ok(s.native.titles > 0, 'macOS sets the menu-bar title')
  assert.deepEqual(Object.keys(s.native.handlers), [], 'the menu opens natively on click')
  assert.ok(s.item('Compact'))
  assert.ok(s.item('Full Island'))
  s.controller.update({ phase: 'recording', eligible: true, meetingId: 'meeting' })
  assert.equal(s.native.tooltip, 'DoodleNote — Recording')
  s.controller.showBackgroundHint()
  assert.deepEqual(s.native.balloons, [])
  assert.deepEqual(
    // Array.from: the menu array comes from the module's vm realm.
    Array.from(s.native.menu, (item) => item.label ?? item.type),
    [
      'Recording…',
      'separator',
      'Open DoodleNote',
      'separator',
      'Today',
      'No calendar connected',
      'separator',
      'Compact',
      'Full Island',
      'separator',
      'Quit DoodleNote'
    ]
  )
  s.controller.dispose()
})

test('Windows shows a notification-area dog with the same recording menu', () => {
  const s = setup('win32')
  assert.equal(s.native.image.path, join('/resources', 'dogWin.ico'))
  assert.equal(s.native.titles, 0, 'Windows tray icons have no title')
  s.controller.updateCalendar(s.calendar)
  assert.equal(s.native.tooltip, 'DoodleNote\nDesign review in 30m')
  assert.equal(
    s.native.menu.some((item) => item.label === 'Compact' || item.label === 'Full Island'),
    false
  )
  assert.equal(
    s.native.menu.some((item) => item.label?.endsWith('— Design review')),
    true
  )
  s.controller.update({ phase: 'idle', eligible: true, meetingId: null })
  s.click('Record now')
  s.native.handlers.click()
  s.controller.update({ phase: 'starting', eligible: true, meetingId: 'meeting' })
  assert.equal(s.item('Starting…').enabled, false)
  assert.match(s.native.tooltip, /^DoodleNote — Starting…/)
  assert.equal(s.native.image.path, join('/resources', 'dogWin.ico'))
  s.controller.update({ phase: 'recording', eligible: true, meetingId: 'meeting' })
  assert.equal(s.item('Recording…').enabled, false)
  assert.equal(s.native.image.path, join('/resources', 'dogWinRecording.ico'))
  assert.match(s.native.tooltip, /^DoodleNote — Recording\n/)
  s.controller.update({ phase: 'finishing', eligible: true, meetingId: 'meeting' })
  assert.equal(s.item('Finishing…').enabled, false)
  assert.equal(s.native.image.path, join('/resources', 'dogWin.ico'))
  assert.match(s.native.tooltip, /^DoodleNote — Finishing…/)
  s.click('Open DoodleNote')
  s.click('Quit DoodleNote')
  s.controller.dispose()
  assert.equal(s.native.destroyed, true)
  assert.deepEqual(s.counts(), { starts: 1, opens: 2, quits: 1, timerCleared: true })
})

test('Windows hints once per recording that capture continues in the tray', () => {
  const s = setup('win32')
  s.controller.update({ phase: 'recording', eligible: true, meetingId: 'meeting' })
  s.controller.showBackgroundHint()
  s.controller.showBackgroundHint()
  assert.equal(s.native.balloons.length, 1)
  assert.equal(s.native.balloons[0].title, 'DoodleNote is still recording')
  assert.match(s.native.balloons[0].content, /notification area/)
  s.controller.update({ phase: 'finishing', eligible: true, meetingId: 'meeting' })
  s.controller.update({ phase: 'idle', eligible: true, meetingId: null })
  s.controller.update({ phase: 'recording', eligible: true, meetingId: 'next' })
  s.controller.showBackgroundHint()
  assert.equal(s.native.balloons.length, 2)
  s.controller.dispose()
})

test('Windows tooltips stay within the notification-area limit', () => {
  const s = setup('win32')
  s.controller.updateCalendar({
    ...s.calendar,
    events: [{ ...s.calendar.events[0], subject: 'x'.repeat(400) }]
  })
  assert.ok(s.native.tooltip.length <= 127)
  s.controller.dispose()
})

test('packaging ships the Windows tray icons and the Windows app icon has every size', () => {
  const config = readFileSync('electron-builder.yml', 'utf8').replace(/\r\n/g, '\n')
  const win = /^win:\n((?:[ \t].*\n|\n)*)/m.exec(config)?.[1] ?? ''
  assert.match(win, /extraResources:\s+- from: resources\/tray\s+to: tray\s+filter: \["\*\.ico"\]/)
  const sizes = (file: string): number[] => {
    const ico = readFileSync(file)
    assert.equal(ico.readUInt16LE(2), 1, `${file} is an icon`)
    return Array.from({ length: ico.readUInt16LE(4) }, (_, index) => ico[6 + index * 16] || 256)
  }
  assert.deepEqual(sizes('resources/icon.ico'), [16, 20, 24, 32, 40, 48, 64, 128, 256])
  for (const name of ['dogWin.ico', 'dogWinRecording.ico']) {
    assert.deepEqual(sizes(join('resources/tray', name)), [16, 20, 24, 32, 40, 48])
  }
})
