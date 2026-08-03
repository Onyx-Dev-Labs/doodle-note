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
