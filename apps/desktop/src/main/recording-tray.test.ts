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
  }
  natives: unknown[]
  calendar: CalendarState
  modeChanges: boolean[]
  item(label: string): Electron.MenuItemConstructorOptions
  click(label: string): void
  advance(time: number): void
  counts(): { starts: number; opens: number; quits: number; timerCleared: boolean }
}
function setup(): Fixture {
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
    destroyed = false
    menu: Electron.MenuItemConstructorOptions[] = []
    constructor(public image: { path: string; template: boolean }) {
      natives.push(this)
    }
    setTitle(title: string): void {
      this.title = title
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
    process: { platform: 'darwin' },
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
