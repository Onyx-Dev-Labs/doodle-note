import type { CalendarStartMeetingEvent } from '../shared/calendar-api'

export const PANEL_WIDTH = 340
export const PANEL_HEIGHT = 108

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function legacyPanelDataUrl(prompt: CalendarStartMeetingEvent, dark: boolean): string {
  const heading = prompt.adHoc
    ? 'Looks like you’re on a call'
    : `${escapeHtml(prompt.subject)} is starting`
  const sub = prompt.adHoc
    ? 'Want DoodleNote to record and take notes?'
    : 'Want DoodleNote to take notes?'
  // Follows nativeTheme, which the renderer keeps in sync with the in-app pref.
  const c = dark
    ? {
        card: '#262922',
        border: '#3a3e33',
        ink: '#f0eee2',
        muted: '#93967f',
        go: '#8fb07a',
        goHover: '#aac996',
        goText: '#1d1f19'
      }
    : {
        card: '#fdfcf8',
        border: '#e7e3d8',
        ink: '#26281f',
        muted: '#8a8d7f',
        go: '#7c9769',
        goHover: '#5f7a4e',
        goText: '#fff'
      }
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; -webkit-user-select: none; cursor: default; }
  body { font: 13px/1.4 -apple-system, BlinkMacSystemFont, sans-serif; background: transparent; padding: 2px; }
  .card { background: ${c.card}; border: 1px solid ${c.border}; border-radius: 14px;
    box-shadow: 0 10px 30px rgba(0,0,0,${dark ? '.5' : '.22'}); padding: 12px 14px; height: ${PANEL_HEIGHT - 4}px;
    display: flex; flex-direction: column; gap: 9px; -webkit-app-region: drag; }
  .head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  h1 { font-size: 13.5px; font-weight: 600; color: ${c.ink}; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }
  p { color: ${c.muted}; font-size: 12px; }
  .row { display: flex; gap: 8px; -webkit-app-region: no-drag; }
  a { text-decoration: none; border-radius: 8px; padding: 6px 12px; font-size: 12.5px; font-weight: 600; }
  .go { background: ${c.go}; color: ${c.goText}; flex: 1; text-align: center; }
  .go:hover { background: ${c.goHover}; }
  .no { color: ${c.muted}; padding: 6px 8px; }
  .no:hover { color: ${c.ink}; }
  </style></head><body><div class="card">
  <div class="head"><h1>${heading}</h1></div>
  <p>${sub}</p>
  <div class="row">
    <a class="go" href="doodle-panel://start">✎ Take notes</a>
    <a class="no" href="doodle-panel://dismiss">Dismiss</a>
  </div>
  </div></body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

interface WorkArea {
  x: number
  y: number
  width: number
  height: number
}

/** Electron work areas use logical pixels and already exclude the Dock/taskbar. */
export function panelBounds(area: WorkArea, platform: NodeJS.Platform): WorkArea {
  const inset = 16
  const width = Math.min(PANEL_WIDTH, area.width)
  const height = Math.min(PANEL_HEIGHT, area.height)
  return {
    width,
    height,
    x:
      platform === 'darwin'
        ? area.x + Math.floor((area.width - width) / 2)
        : area.x + Math.max(0, area.width - width - inset),
    y:
      platform === 'darwin'
        ? area.y + Math.max(0, area.height - height - inset)
        : area.y + Math.min(inset, area.height - height)
  }
}

/** Same paw geometry and right-bound trot as DoodlingIndicator/.paw-walk.
 * Decorative only: this prompt never implies that note generation has begun. */
const paw = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
  <ellipse cx="12" cy="16.5" rx="5.2" ry="4.6" />
  <ellipse cx="4.6" cy="10.5" rx="2.4" ry="3.1" transform="rotate(-20 4.6 10.5)" />
  <ellipse cx="9.4" cy="6.6" rx="2.5" ry="3.3" transform="rotate(-8 9.4 6.6)" />
  <ellipse cx="14.6" cy="6.6" rx="2.5" ry="3.3" transform="rotate(8 14.6 6.6)" />
  <ellipse cx="19.4" cy="10.5" rx="2.4" ry="3.1" transform="rotate(20 19.4 10.5)" />
</svg>`

export function panelDataUrl(
  prompt: CalendarStartMeetingEvent,
  dark: boolean,
  platform: NodeJS.Platform
): string {
  if (platform !== 'darwin') return legacyPanelDataUrl(prompt, dark)
  const heading = prompt.adHoc
    ? 'Looks like you’re on a call'
    : prompt.subject.trim() || 'Untitled meeting'
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <title>DoodleNote — meeting detected</title><style>
  * { box-sizing: border-box; }
  :root { color-scheme: ${dark ? 'dark' : 'light'}; }
  body { margin: 0; padding: 4px; background: transparent;
    font: 13px/1.4 -apple-system, BlinkMacSystemFont, sans-serif;
    color: ${dark ? '#f0eee2' : '#26281f'}; -webkit-user-select: none; }
  .card { position: relative; height: 100px; padding: 13px 16px 12px;
    background: ${dark ? '#262922' : '#fdfcf8'}; border: 1px solid ${dark ? '#4c5144' : '#dfdccf'};
    border-radius: 16px; display: flex; flex-direction: column; gap: 10px;
    animation: enter 300ms cubic-bezier(.2,.8,.2,1) both; }
  h1 { font-size: 13px; line-height: 18px; font-weight: 600; margin: 0 0 0 22px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .brand { display: flex; flex-direction: column; gap: 5px; padding-left: 12px; }
  .name { font-size: 10px; font-weight: 600; color: ${dark ? '#b4b9a7' : '#626951'}; }
  .paw-walk { display: inline-flex; align-items: center; gap: 3px; color: ${dark ? '#aac996' : '#5f7a4e'}; }
  .paw { display: inline-flex; opacity: 0; animation: paw-step 1.6s ease-in-out infinite; }
  .paw:nth-child(odd) { transform: translateY(-2.5px) rotate(82deg); }
  .paw:nth-child(even) { transform: translateY(2.5px) rotate(98deg); }
  .paw:nth-child(2) { animation-delay: .35s; }
  .paw:nth-child(3) { animation-delay: .7s; }
  .paw:nth-child(4) { animation-delay: 1.05s; }
  a { text-decoration: none; cursor: pointer; }
  .go { padding: 9px 16px; border-radius: 9px; font-size: 12px; font-weight: 650;
    color: ${dark ? '#1d1f19' : '#fff'}; background: ${dark ? '#aac996' : '#526b42'}; white-space: nowrap; }
  .go:hover { background: ${dark ? '#bfdaae' : '#405633'}; }
  .dismiss { position: absolute; top: 3px; left: 3px; width: 24px; height: 24px;
    display: grid; place-items: center; border-radius: 50%; font-size: 19px; line-height: 1;
    color: inherit; background: ${dark ? '#3a3e33' : '#eeece3'}; opacity: 0; }
  .card:hover .dismiss, .card:focus-within .dismiss { opacity: 1; }
  a:focus-visible { outline: 2px solid ${dark ? '#e0edbc' : '#344d26'}; outline-offset: 2px; }
  @keyframes enter { from { opacity: 0; transform: translateY(28px); } to { opacity: 1; transform: none; } }
  @keyframes paw-step { 0%, 80%, 100% { opacity: 0; } 15%, 55% { opacity: .95; } }
  @media (prefers-reduced-motion: reduce) { .card { animation: none; } .paw { animation: none; opacity: .95; } }
  @media (hover: none) { .dismiss { opacity: 1; } }
  </style></head><body><section class="card" aria-label="Meeting detected">
    <h1 title="${escapeHtml(heading)}">${escapeHtml(heading)}</h1>
    <div class="row"><div class="brand"><span class="name">DoodleNote</span>
      <span class="paw-walk" aria-hidden="true">${[1, 2, 3, 4].map(() => `<span class="paw">${paw}</span>`).join('')}</span>
    </div><a class="go" href="doodle-panel://start">Record now</a></div>
    <a class="dismiss" href="doodle-panel://dismiss" aria-label="Dismiss meeting prompt" title="Dismiss (Esc)">×</a>
  </section></body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}
