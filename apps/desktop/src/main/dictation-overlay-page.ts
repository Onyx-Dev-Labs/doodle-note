/**
 * The overlay's page, as one self-contained string. It has no preload and no
 * network: the main process calls `window.render(view, dark)` and
 * `window.playTones(tones)`, and the page answers by navigating to a private
 * `doodle-dictation://` URL that the window intercepts. Nothing here is copied
 * from another product; the look is DoodleNote's own: a paper pill with an
 * offset ink outline, a hand-drawn squiggle that follows the voice level, and
 * hand-drawn cancel and finish marks.
 */
import { overlayFontCss, barkPine, barkWhite } from './brand-assets'
import { FEATURE_NAME } from '../shared/dictation-brand'

export function overlayHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
${overlayFontCss}
  :root{--paper:#fbf6e9;--ink:#2b2a26;--mute:#6f6c60;--wash:#ece5d0;--accent:#c4562f;--ok:#4f7a4a;--warn:#a8741a;--err:#b3412f}
  .dark{--paper:#2a2b25;--ink:#efeadb;--mute:#a9a698;--wash:#3a3b33;--accent:#f08a63;--ok:#8fbf86;--warn:#e0b45a;--err:#e8806d}
  html,body{margin:0;height:100%;background:transparent;color:var(--ink);overflow:hidden;-webkit-user-select:none;user-select:none;cursor:default;font:13px "Doodle Figtree",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .root{box-sizing:border-box;height:100vh;padding:6px 8px 8px 6px;display:flex;flex-direction:column;justify-content:center;align-items:stretch;gap:6px}
  .root.bottom{flex-direction:column-reverse}
  .root.left{align-items:flex-start}.root.right{align-items:flex-end}
  .pill,.card,.caption{background:var(--paper);border:1.6px solid var(--ink);box-shadow:2px 2px 0 var(--ink)}
  .pill{box-sizing:border-box;display:flex;align-items:center;border-radius:22px 20px 23px 19px/19px 23px 20px 22px}
  svg{display:block;overflow:visible}
  path{fill:none;stroke:var(--ink);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  /* resting pill */
  .rest{width:78px;height:28px;justify-content:center;align-self:center;transition:transform .12s ease,border-color .12s ease}
  .rest:hover{transform:scale(1.07)}
  .rest:hover path{stroke:var(--accent)}
  .root.left .rest,.root.right .rest{width:28px;height:78px;align-self:auto}
  .root.left .rest svg,.root.right .rest svg{flex:none;transform:rotate(90deg)}
  .bark-logo{display:block;width:28px;height:28px;object-fit:contain;flex:none}
  .bark-logo-dark{display:none}.dark .bark-logo-light{display:none}.dark .bark-logo-dark{display:block}
  .rest .bark-logo{width:24px;height:24px}
  .rest>svg{display:none}
  /* live pill */
  .session{max-width:100%;height:38px;padding:0 10px;gap:8px;align-self:center}
  .act{flex:none;display:flex;align-items:center;gap:4px;color:var(--ink);text-decoration:none;font-size:14px;padding:2px 4px;border-radius:10px}
  .act:hover{background:var(--wash)}
  .act.fin path{stroke:var(--ok)}
  .act.can path{stroke:var(--err)}
  .mid{flex:1;min-width:0;display:flex;align-items:center;gap:6px}
  .mid svg{flex:none}
  .active path.wave{stroke:var(--accent)}
  .busy path.wave{stroke:var(--mute)}
  /* the app the text will land in: a drawn arrow, then its own icon */
  .into{flex:none;display:flex;align-items:center;gap:5px}
  .into svg path{stroke:var(--mute);stroke-width:1.8}
  .app{width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:6px;background:var(--wash);overflow:hidden}
  .app img{width:24px;height:24px;display:block;-webkit-user-drag:none}
  .app .dot{font:700 12px "Doodle Figtree",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--mute)}
  .state{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px;color:var(--mute)}
  .caption{box-sizing:border-box;border-radius:14px 12px 15px 11px/11px 15px 12px 14px;padding:5px 10px;font:12px "Doodle Figtree",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;align-self:stretch}
  .caption .warn{color:var(--warn);font-weight:600;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .caption .detail{color:var(--mute);line-height:1.35;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;-webkit-user-select:text;user-select:text;white-space:pre-wrap;word-break:break-word}
  /* Side docks use a vertical control rail; readable captions open inward. */
  .root.side{flex-direction:row;align-items:center;justify-content:flex-start}
  .root.side.right{flex-direction:row-reverse}
  .side .session{flex:none;flex-direction:column;width:44px;height:100%;padding:10px 0;gap:8px;border-radius:23px 21px 22px 20px}
  .side .act{flex:none;box-sizing:border-box;width:28px;height:28px;padding:0;justify-content:center;border-radius:50%}
  .side .act span{display:none}
  .side .mid{flex-direction:column;gap:8px;flex:1;min-height:0;width:28px;justify-content:center}
  .side .into{justify-content:center;width:28px;padding-top:8px;border-top:1px solid var(--wash)}
  .side .into>svg{display:none}
  .side .caption{flex:1;min-width:0;align-self:center;padding:10px 12px;display:flex;flex-direction:column;gap:6px}
  .side .caption .warn{white-space:normal}
  .caption-state{color:var(--mute);line-height:1.35;overflow-wrap:anywhere}
  /* message card */
  .card{box-sizing:border-box;flex:1;border-radius:16px 14px 17px 13px/13px 17px 14px 16px;padding:10px 14px;display:flex;flex-direction:column;gap:6px;min-height:0}
  .card .title{font-weight:700;font-size:14px;line-height:1.3}
  .card.warn{border-color:var(--warn)}.card.error{border-color:var(--err)}
  .card .cardwarn{color:var(--warn);font-weight:600;font-size:12px;line-height:1.35}
  .card .detail{flex:1;min-height:0;color:var(--mute);font:12px/1.35 "Doodle Figtree",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;-webkit-user-select:text;user-select:text;white-space:pre-wrap;word-break:break-word}
  .diff{flex:1;min-height:0;overflow:hidden;font:12px/1.45 "Doodle Figtree",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:pre-wrap;word-break:break-word;-webkit-user-select:text;user-select:text;background:var(--wash);border-radius:8px;padding:6px 8px}
  .diff ins{text-decoration:none;color:var(--ok);background:rgba(79,122,74,.16);border-radius:3px}
  .diff del{color:var(--err);background:rgba(179,65,47,.14);border-radius:3px;text-decoration:line-through}
  .btns{display:flex;gap:6px;justify-content:flex-end}
  .btn{color:var(--ink);background:var(--wash);border:1.4px solid var(--ink);padding:1px 10px;border-radius:9px;text-decoration:none;font-size:13px}
  .btn.primary{background:var(--accent);color:#fff;border-color:var(--ink)}
  .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  [hidden]{display:none!important}
  @media (prefers-reduced-motion:reduce){.rest{transition:none}.rest:hover{transform:none}}
</style></head><body>
<div class="root bottom" id="root">
  <div class="pill rest" id="rest" role="button" aria-label="Start ${FEATURE_NAME}" hidden>
    <img class="bark-logo bark-logo-light" src="${barkPine}" alt="" aria-hidden="true"><img class="bark-logo bark-logo-dark" src="${barkWhite}" alt="" aria-hidden="true">
    <svg width="56" height="18" viewBox="0 0 56 18" aria-hidden="true"><path class="wave" id="restWave" d=""/></svg>
  </div>
  <div class="pill session" id="session" hidden>
    <a class="act can" id="cancel" href="doodle-dictation://cancel" role="button" aria-label="Cancel ${FEATURE_NAME}" title="Cancel ${FEATURE_NAME}" hidden>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.4 C6 6.2 9.6 9.8 13 13.2 M12.8 2.8 C10 5.8 6.4 9.6 2.9 13"/></svg><span>Cancel</span>
    </a>
    <div class="mid" id="mid">
      <img class="bark-logo bark-logo-light" src="${barkPine}" alt="" aria-hidden="true"><img class="bark-logo bark-logo-dark" src="${barkWhite}" alt="" aria-hidden="true">
      <svg id="midSvg" width="96" height="24" viewBox="0 0 96 24" aria-hidden="true"><path class="wave" id="wave" d=""/></svg>
      <span class="state" id="state"></span>
    </div>
    <div class="into" id="into" role="img" hidden>
      <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true"><path d="M1.4 6.2 C4.4 5.8 8 6.1 11.8 6 M8.2 2.2 C9.6 3.6 10.8 4.8 12.2 6 C10.8 7.4 9.6 8.6 8.4 10"/></svg>
      <span class="app" id="app"><img id="appImg" alt="" hidden><span class="dot" id="appDot"></span></span>
    </div>
    <a class="act fin" id="stop" href="doodle-dictation://stop" role="button" aria-label="Finish and insert the text" title="Finish and insert the text" hidden>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.4 8.6 C4.2 10.4 5.6 12 6.6 13.4 C8.6 9.6 11.4 5.6 14 2.8"/></svg><span>Finish</span>
    </a>
  </div>
  <div class="caption" id="caption" hidden><div class="caption-state" id="captionState" hidden></div><div class="warn" id="warn" hidden></div><div class="detail" id="detail"></div></div>
  <div class="card" id="card" hidden>
    <div class="title" id="title"></div>
    <div class="cardwarn" id="cardWarn" hidden></div>
    <div class="detail" id="cardDetail"></div>
    <div class="diff" id="diff" hidden aria-label="Changes: removed words are struck through, added words are highlighted"></div>
    <div class="btns">
      <a class="btn" id="view" href="doodle-dictation://view" role="button" hidden>View</a>
      <a class="btn primary" id="undo" href="doodle-dictation://undo" role="button" hidden>Undo</a>
      <a class="btn primary" id="copy" href="doodle-dictation://copy" role="button" hidden>Copy text</a>
      <a class="btn primary" id="restore" href="doodle-dictation://restore" role="button" hidden>Restore</a>
      <a class="btn" id="dismiss" href="doodle-dictation://dismiss" role="button" hidden>Dismiss</a>
    </div>
  </div>
  <div class="sr" id="live" role="status" aria-live="polite"></div>
</div>
<script>
  const $ = (id) => document.getElementById(id)
  const go = (name) => { location.href = 'doodle-dictation://' + name }
  const calm = matchMedia('(prefers-reduced-motion: reduce)')
  let view = null
  let target = 0, shown = 0, phase = 0, frame = 0

  // A hand-drawn wave: fixed irregularities per point, so the line looks inked,
  // not computed. Amplitude follows the voice; the ends taper to the baseline.
  function wave(width, height, amp, ph, cycles, vertical = false) {
    const n = Math.round(width / 3)
    let d = ''
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const taper = Math.pow(Math.sin(Math.PI * t), 0.8)
      const wobble = 1 + 0.16 * Math.sin(i * 1.7 + 3)
      const y = height / 2 + Math.sin(ph + t * cycles * 2 * Math.PI) * amp * taper * wobble + Math.sin(t * 9 + 1) * 0.35
      const x = t * width
      d += (i ? 'L' : 'M') + (vertical ? y : x).toFixed(1) + ' ' + (vertical ? x : y).toFixed(1)
    }
    return d
  }

  function draw() {
    if (!view) return
    if (view.mode === 'rest') {
      $('restWave').setAttribute('d', wave(56, 18, 3 + shown * 3, phase, 2.5))
    } else if (view.mode === 'session') {
      const talking = view.tone === 'active'
      const amp = talking ? 2 + shown * 9 : 1.6
      const vertical = view.edge !== 'bottom'
      $('wave').setAttribute('d', wave(vertical ? 88 : Number($('midSvg').getAttribute('width')), 24, amp, phase, talking ? 4 : 2, vertical))
    }
  }

  function tick() {
    frame = 0
    shown += (target - shown) * 0.25
    phase += view && view.tone === 'active' ? 0.32 : 0.1
    draw()
    if (!calm.matches && view && view.visible && view.mode !== 'message') frame = requestAnimationFrame(tick)
  }

  // The app icon arrives on its own, only when it changes, so the frames stay small.
  let appIcon = null
  window.setTargetIcon = (icon) => { appIcon = icon }

  window.render = (next, dark) => {
    const was = view
    view = next
    document.documentElement.className = dark ? 'dark' : ''
    const side = next.mode === 'session' && next.edge !== 'bottom'
    $('root').className = 'root ' + next.edge + (side ? ' side' : '')
    $('rest').hidden = next.mode !== 'rest'
    $('session').hidden = next.mode !== 'session'
    $('card').hidden = next.mode !== 'message'
    $('session').className = 'pill session ' + next.tone
    target = next.level === null ? 0 : next.level
    if (calm.matches) shown = target
    if (next.mode === 'session') {
      $('cancel').hidden = !next.controls.cancel
      $('stop').hidden = !next.controls.stop
      // The caption is hidden for a plain "Listening" and in quiet mode; the
      // live region below still announces every title.
      const plain = (next.tone === 'active' && next.title === 'Listening') || !next.showStatus
      $('state').textContent = plain ? '' : next.title
      $('state').hidden = plain || side
      $('captionState').textContent = side && !plain ? next.title : ''
      $('captionState').hidden = !side || plain
      const waveWidth = side ? 24 : plain ? 96 : 40
      const waveHeight = side ? 88 : 24
      $('midSvg').setAttribute('width', String(waveWidth))
      $('midSvg').setAttribute('height', String(waveHeight))
      $('midSvg').setAttribute('viewBox', '0 0 ' + waveWidth + ' ' + waveHeight)
      $('warn').textContent = next.warning || ''
      $('warn').hidden = !next.warning
      $('detail').textContent = next.detail
      $('detail').hidden = !next.detail
      $('caption').hidden = !next.warning && !next.detail && !(side && !plain)
      const into = next.target
      $('into').hidden = !into
      if (into) {
        $('into').setAttribute('aria-label', 'Typing into ' + into.name)
        $('into').title = 'Typing into ' + into.name
        $('appImg').hidden = !appIcon
        if (appIcon && $('appImg').getAttribute('src') !== appIcon) $('appImg').setAttribute('src', appIcon)
        $('appDot').textContent = appIcon ? '' : [...into.name][0] || ''
      }
      $('mid').style.cursor = next.controls.stop ? 'pointer' : 'default'
    } else {
      $('caption').hidden = true
    }
    if (next.mode === 'message') {
      $('card').className = 'card ' + (next.tone === 'ok' ? '' : next.tone)
      $('title').textContent = next.title
      // Windows only sets this on a card (the clipboard could not be fully put back).
      $('cardWarn').textContent = next.warning || ''
      $('cardWarn').hidden = !next.warning
      $('cardDetail').textContent = next.detail
      $('cardDetail').hidden = !next.detail
      $('copy').hidden = !next.controls.copy
      $('view').hidden = !next.controls.view
      $('undo').hidden = !next.controls.undo
      $('dismiss').hidden = !next.controls.dismiss
      $('restore').hidden = !next.controls.restore
      const diff = $('diff')
      diff.hidden = !next.diff
      diff.textContent = ''
      if (next.diff) {
        for (const part of next.diff) {
          const node = document.createElement(part.op === 'add' ? 'ins' : part.op === 'del' ? 'del' : 'span')
          node.textContent = part.text
          diff.appendChild(node)
        }
      }
    }
    // Spoken once per change, never on every level update.
    const into = next.target ? next.target.name : ''
    if (!was || was.title !== next.title || was.mode !== next.mode || was.warning !== next.warning || (was.target ? was.target.name : '') !== into) {
      $('live').textContent = next.mode === 'rest' ? '' : [next.title, next.warning, into ? 'Typing into ' + into : ''].filter(Boolean).join('. ')
    }
    draw()
    if (!frame && !calm.matches && next.visible && next.mode !== 'message') frame = requestAnimationFrame(tick)
  }

  // Short tones for start and stop, synthesized here; nothing is loaded.
  let audio = null
  window.playTones = (tones) => {
    try {
      audio = audio || new AudioContext()
      if (audio.state === 'suspended') audio.resume()
      const base = audio.currentTime + 0.01
      for (const tone of tones) {
        const osc = audio.createOscillator()
        const gain = audio.createGain()
        const from = base + tone.atMs / 1000
        const to = from + tone.durMs / 1000
        osc.type = 'sine'
        osc.frequency.value = tone.freq
        gain.gain.setValueAtTime(0, from)
        gain.gain.linearRampToValueAtTime(tone.gain, from + 0.012)
        gain.gain.exponentialRampToValueAtTime(0.0001, to)
        osc.connect(gain).connect(audio.destination)
        osc.start(from)
        osc.stop(to + 0.02)
      }
    } catch (error) { /* sound is a nicety; never break the pill over it */ }
  }

  // The resting pill: click starts, a drag moves it to another screen edge,
  // right-click opens the menu. The pointer is captured so a drag survives
  // leaving the small window.
  const rest = $('rest')
  let press = null, dragging = false
  rest.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.ctrlKey) return
    press = { x: event.screenX, y: event.screenY }
    dragging = false
    rest.setPointerCapture(event.pointerId)
  })
  rest.addEventListener('pointermove', (event) => {
    if (!press || dragging) return
    if (Math.hypot(event.screenX - press.x, event.screenY - press.y) > 5) { dragging = true; go('drag-start') }
  })
  rest.addEventListener('pointerup', () => {
    if (!press) return
    const moved = dragging
    press = null; dragging = false
    go(moved ? 'drag-end' : 'pill')
  })
  rest.addEventListener('pointercancel', () => {
    if (dragging) go('drag-end')
    press = null; dragging = false
  })
  $('mid').addEventListener('click', () => { if (view && view.controls.stop) go('stop') })
  document.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    if (view && view.mode !== 'message') go('menu')
  })
</script></body></html>`
}
