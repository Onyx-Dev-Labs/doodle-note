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
