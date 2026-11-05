/** Build-time assets for self-contained native overlay pages; no network loads. */
declare const __DOODLENOTE_FIGTREE__: string
declare const __DOODLENOTE_FRAUNCES__: string
declare const __DOODLENOTE_BARK_PINE__: string
declare const __DOODLENOTE_BARK_WHITE__: string

export const overlayFontCss =
  typeof __DOODLENOTE_FIGTREE__ === 'string'
    ? `@font-face{font-family:"Doodle Figtree";src:url(data:font/woff2;base64,${__DOODLENOTE_FIGTREE__}) format("woff2");font-weight:300 900}
     @font-face{font-family:"Doodle Fraunces";src:url(data:font/woff2;base64,${__DOODLENOTE_FRAUNCES__}) format("woff2");font-weight:100 900}`
    : ''
export const barkPine =
  typeof __DOODLENOTE_BARK_PINE__ === 'string'
    ? `data:image/png;base64,${__DOODLENOTE_BARK_PINE__}`
    : ''
export const barkWhite =
  typeof __DOODLENOTE_BARK_WHITE__ === 'string'
    ? `data:image/png;base64,${__DOODLENOTE_BARK_WHITE__}`
    : ''
