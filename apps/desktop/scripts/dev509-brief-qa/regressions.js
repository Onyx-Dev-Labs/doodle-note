const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, label) => {
  for (let i = 0; i < 400; i++) {
    if (await fn()) return
    await delay(25)
  }
  throw Error('Timed out: ' + label)
}
const panel = () => document.querySelector('.brief-panel[open]')
const button = (name, root = panel() || document) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === name)
const click = async (name) => {
  const b = button(name)
  if (!b || b.disabled) throw Error('Button unavailable: ' + name)
  b.focus()
  b.click()
  await delay(30)
}
const input = (label, value, root = panel()) => {
  const el = [...root.querySelectorAll('label')]
    .find((l) => l.childNodes[0]?.textContent.trim() === label)
    ?.querySelector('input,select')
  if (!el) throw Error('Input missing: ' + label)
  const proto =
    el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(
    new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
  )
}
const details = async (text) => {
  const s = [...panel().querySelectorAll('summary')].find((s) => s.textContent === text)
  if (!s) throw Error('Missing disclosure: ' + text)
  if (!s.parentElement.open) s.click()
  await delay(20)
}
const idle = () =>
  until(() => button('Generate brief') && !button('Generate brief').disabled, 'brief idle')
const check = (value, message) => {
  if (!value) throw Error(message)
}
export async function run() {
  const checks = []
  if (panel()) await click('Close')
  await click('Open brief')
  await idle()
  check((await window.qa.call('stats')).generated === 0, 'Open invoked inference')
  check(
    panel().textContent.includes('Partial invitee list') &&
      panel().textContent.includes('Self identity unknown'),
    'Unknown/partial provenance hidden'
  )
  checks.push('Open is metadata-only; partial roster, cached calendar and unknown self visible')
  await click('Generate brief')
  await idle()
  await until(() => panel().textContent.includes('Checked on this device'), 'empty snapshot')
  check((await window.qa.call('stats')).generated === 0, 'Empty history invoked model')
  checks.push('Explicit no-history result skips model')
  input('Name', 'Alex Local')
  await delay(20)
  await click('Create')
  await idle()
  await details('Review or correct')
  const person = panel().querySelector('.brief-person')
  const choice = [...person.querySelectorAll('option')].find((o) => o.textContent === 'Alex Local')
  check(choice, 'Created person unavailable')
  input('Choose person', choice.value, person)
  await delay(20)
  await click('Save match')
  await idle()
  check(panel().textContent.includes('Local person: Alex Local'), 'Saved identity missing')
  checks.push('Explicit person creation and occurrence correction persist')
  await details('Link a prior meeting')
  await click('Find meetings')
  await until(() => button('Link meeting'), 'original candidates')
  await click('Link meeting')
  await idle()
  check(
    panel().textContent.includes('1 selected · 1 linked meetings'),
    'Explicit event history not linked'
  )
  await click('Generate brief')
  await idle()
  await until(() => panel().querySelector('.cited-claim-text'), 'generated quotation')
  const claim = panel().querySelector('.cited-claim-text').textContent
  check(claim.includes('revise the proposal'), 'Exact original not quoted')
  check(
    panel().querySelector('.cited-citations').textContent.includes('Created'),
    'Original date basis missing'
  )
  const citationButton = panel().querySelector('.cited-citations button')
  citationButton.focus()
  citationButton.click()
  await until(() => document.querySelector('.original-passage-panel[open]'), 'source panel')
  const source = document.querySelector('.original-passage-panel')
  check(
    source.querySelector('mark').textContent.includes('revise the proposal'),
    'Exact range missing'
  )
  check(
    source.textContent.includes('No reliable recording seek'),
    'Timingless recording not disabled'
  )
  source.querySelector('button').click()
  await delay(30)
  check(document.activeElement === citationButton, 'Citation close did not restore focus')
  checks.push(
    'Shared original panel renders exact source/date, disables timingless play and restores citation focus'
  )
  const generated = (await window.qa.call('stats')).generated
  await click('Refresh local context')
  await idle()
  check((await window.qa.call('stats')).generated === generated, 'Refresh reinferred')
  check((await window.qa.call('stats')).originalsUnchanged, 'Brief modified original bytes')
  checks.push('Refresh revalidates without inference; originals byte-preserved')
  await click('Select none')
  await idle()
  await click('Generate brief')
  await idle()
  check(!panel().querySelector('.cited-claim-text'), 'Empty selection kept previous claims')
  check((await window.qa.call('stats')).generated === generated, '[] widened or inferred')
  checks.push('Explicit [] never widens to library history')
  await click('Select shown available history')
  await idle()
  await window.qa.call('hold')
  await click('Generate brief')
  await until(async () => (await window.qa.call('stats')).generating, 'held model')
  await click('Cancel')
  check(
    !button('Generate brief') || button('Generate brief').disabled,
    'Retry enabled before cancellation drain'
  )
  await window.qa.call('release')
  await until(
    () => button('Refresh local context') && !button('Refresh local context').disabled,
    'cancel drain'
  )
  check(!panel().querySelector('.cited-claim-text'), 'Cancelled output escaped')
  await click('Refresh local context')
  await idle()
  await click('Generate brief')
  await idle()
  await until(() => panel().querySelector('.cited-claim-text'), 'retry answer')
  checks.push('Cancel waits for synthetic generator drain; retry succeeds without stale answer')
  await window.qa.call('disconnect')
  await until(
    () =>
      !panel().textContent.includes('Alex Local') && !panel().querySelector('.cited-claim-text'),
    'disconnect withholding'
  )
  check(
    !panel().textContent.includes('Orchid proposal review'),
    'Disconnected event title retained'
  )
  checks.push('Account invalidation clears event, names, citations and claims')
  await window.qa.call('reconnect')
  await click('Refresh local context')
  await idle()
  await window.qa.call('fail')
  await click('Generate brief')
  await idle()
  check(!panel().querySelector('.cited-claim-text'), 'Model failure displayed claims')
  check(button('Local model settings'), 'Model failure recovery absent')
  checks.push('Model failure stays explicit and offers settings without download')
  await details('Saved context and privacy')
  await click('Preview forgetting this account’s context')
  await until(() => button('Forget saved context'), 'forget preview')
  await click('Forget saved context')
  await until(() => !panel().textContent.includes('Alex Local'), 'forgot names')
  check((await window.qa.call('stats')).originalsUnchanged, 'Forget deleted original')
  await click('Close')
  await delay(30)
  check(document.activeElement?.textContent === 'Open brief', 'Close did not restore Home focus')
  checks.push('Explicit forget preserves originals; Close restores Open brief focus')
  return {
    checks,
    count: checks.length,
    stats: await window.qa.call('stats'),
    native: false,
    generator: 'deterministic synthetic',
    transport: 'loopback HTTP + actual IPC handler'
  }
}
