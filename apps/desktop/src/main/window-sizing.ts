/**
 * Main-window bounds in CSS pixels. The default keeps the roomy desktop
 * layout, while the minimum supports compact laptop and side-by-side setups.
 */
export const MAIN_WINDOW_SIZE = {
  defaultWidth: 1180,
  defaultHeight: 760,
  minWidth: 800,
  minHeight: 560
} as const

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The main window's opening bounds and size limits on a display, in DIPs. At
 * 150-200% scaling a laptop's work area can be smaller than the default size or
 * even the minimum: 1920x1080 at 200% leaves about 960x516, 1366x768 at 150%
 * about 910x480. Never ask for more than the work area, so the whole window,
 * caption buttons included, opens on screen and can still be resized.
 */
export function mainWindowBoundsFor(area: Rect): Rect & { minWidth: number; minHeight: number } {
  const width = Math.min(MAIN_WINDOW_SIZE.defaultWidth, area.width)
  const height = Math.min(MAIN_WINDOW_SIZE.defaultHeight, area.height)
  return {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
    minWidth: Math.min(MAIN_WINDOW_SIZE.minWidth, area.width),
    minHeight: Math.min(MAIN_WINDOW_SIZE.minHeight, area.height)
  }
}

/**
 * After the window moved to another display or the scale changed: bounds that fit
 * a window larger than the work area back inside it, or null when it already
 * fits (a window the person left partly off screen is not moved).
 */
export function fitIntoWorkArea(bounds: Rect, area: Rect): Rect | null {
  if (bounds.width <= area.width && bounds.height <= area.height) return null
  const width = Math.min(bounds.width, area.width)
  const height = Math.min(bounds.height, area.height)
  const clamp = (value: number, min: number, max: number): number =>
    Math.min(Math.max(value, min), max)
  return {
    x: clamp(bounds.x, area.x, area.x + area.width - width),
    y: clamp(bounds.y, area.y, area.y + area.height - height),
    width,
    height
  }
}

/** The main window is kept on screen by the app only on Windows; macOS manages its own windows. */
export function keepsMainWindowOnScreen(platform: NodeJS.Platform): boolean {
  return platform === 'win32'
}

export interface DisplayArea {
  id: number
  workArea: Rect
}

function intersection(a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return width > 0 && height > 0 ? width * height : 0
}

/** How much of `bounds` lies inside some work area, 0..1 (work areas do not overlap). */
export function visibleFraction(bounds: Rect, areas: Rect[]): number {
  const total = bounds.width * bounds.height
  if (total <= 0) return 1
  const visible = areas.reduce((sum, area) => sum + intersection(bounds, area), 0)
  return Math.min(1, visible / total)
}

/**
 * What to do with the main window after it moved, the scale changed or a display
 * went away: new bounds, or null to leave it alone. Never touches a window that
 * is fully visible, even one deliberately spanning displays and larger than any
 * one of them. Otherwise it refits only when
 *
 * - less than half of the window is on any work area (bring it back inside the
 *   display under its center), or
 * - the display under its center changed to a smaller one (another display, or
 *   the same one at a higher scale) and the window is now larger than the
 *   combined work areas it overlaps (shrink it into that display).
 *
 * `previous` is the display under the center at the last check (null: none yet).
 */
export function refitMainWindow(input: {
  bounds: Rect
  displays: DisplayArea[]
  center: DisplayArea
  previous: DisplayArea | null
}): Rect | null {
  const { bounds, displays, center, previous } = input
  const areas = displays.map((display) => display.workArea)
  const visible = visibleFraction(bounds, areas)
  if (visible >= 0.999) return null
  const area = center.workArea
  if (visible < 0.5) {
    const width = Math.min(bounds.width, area.width)
    const height = Math.min(bounds.height, area.height)
    const clamp = (value: number, min: number, max: number): number =>
      Math.min(Math.max(value, min), max)
    return {
      x: clamp(bounds.x, area.x, area.x + area.width - width),
      y: clamp(bounds.y, area.y, area.y + area.height - height),
      width,
      height
    }
  }
  const changed =
    previous !== null &&
    (previous.id !== center.id ||
      previous.workArea.width !== area.width ||
      previous.workArea.height !== area.height)
  const smaller =
    previous !== null &&
    (area.width < previous.workArea.width || area.height < previous.workArea.height)
  if (!changed || !smaller) return null
  const overlapped = areas.filter((candidate) => intersection(bounds, candidate) > 0)
  const left = Math.min(...overlapped.map((a) => a.x))
  const top = Math.min(...overlapped.map((a) => a.y))
  const right = Math.max(...overlapped.map((a) => a.x + a.width))
  const bottom = Math.max(...overlapped.map((a) => a.y + a.height))
  if (bounds.width <= right - left && bounds.height <= bottom - top) return null
  return fitIntoWorkArea(bounds, area)
}
