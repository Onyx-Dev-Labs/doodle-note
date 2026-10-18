// Run in the isolated harness page with: (await import('/regressions.js')).run()
const frame = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
const button = (text) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent === text)
const visible = () => document.body.textContent.includes('Orchid ships Friday.')
const assert = (ok, message) => {
  if (!ok) throw Error(message)
}
async function until(predicate) {
  if (predicate()) return
  await new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (predicate()) {
        clearTimeout(timer)
        observer.disconnect()
        resolve()
      }
    })
    const timer = setTimeout(() => {
      observer.disconnect()
      reject(Error('Expected UI state did not arrive'))
    }, 3000)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    })
  })
}
async function start() {
  await window.qa.call('reset')
  window.qa.changed()
  await frame()
  const input = document.querySelector('textarea')
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Orchid')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await until(() => !button('Ask on this device').disabled)
  document.querySelector('form').requestSubmit()
  await window.qa.call('started')
}
async function idle() {
  await until(() => !button('Cancel'))
  await frame()
}
export async function run() {
  const results = []
  await start()
  await window.qa.call('holdHistory')
  window.dispatchEvent(new Event('focus'))
  await window.qa.call('historyStarted')
  await window.qa.call('releaseHistory')
  await frame()
  await window.qa.call('release')
  await idle()
  assert(visible(), 'focus refresh hid a persisted answer')
  assert(
    (await window.qa.call('saved')).some((e) => e.claim === 'Orchid ships Friday.'),
    'answer not actually saved'
  )
  results.push('focus while generating displays persisted answer')

  await start()
  await window.qa.call('holdHistory')
  window.dispatchEvent(new Event('focus'))
  await window.qa.call('historyStarted')
  await window.qa.call('release')
  await idle()
  assert(visible(), 'completion reconciliation failed')
  await window.qa.call('releaseHistory')
  await frame()
  assert(visible(), 'old hydration overwrote completion')
  results.push('late pre-save history cannot overwrite completion')

  await start()
  window.dispatchEvent(new Event('focus'))
  await frame()
  await window.qa.call('fail')
  await window.qa.call('release')
  await idle()
  assert(
    document.body.textContent.includes('Synthetic model failure'),
    'focus hid generation error'
  )
  assert(!visible(), 'failed generation displayed answer')
  results.push('focus preserves generation error')

  await start()
  window.dispatchEvent(new Event('focus'))
  await frame()
  button('Cancel').click()
  await window.qa.call('release')
  await idle()
  assert(document.body.textContent.includes('Answer cancelled.'), 'focus hid cancellation')
  assert(!(await window.qa.call('saved')).some((e) => e.claim), 'cancelled answer persisted')
  results.push('focus preserves cancellation and no persistence')

  await start()
  window.dispatchEvent(new Event('focus'))
  await frame()
  window.qa.changed()
  await window.qa.call('mutate')
  await idle()
  assert(!visible(), 'revoked source answer displayed')
  assert(!(await window.qa.call('saved')).some((e) => e.claim), 'revoked source persisted')
  results.push('genuine source invalidation still retires active answer')

  await start()
  await window.qa.call('revoke')
  await idle()
  assert(!visible(), 'revoked owner answer displayed')
  assert(!(await window.qa.call('saved')).some((e) => e.claim), 'revoked owner persisted')
  results.push('owner revocation withholds completion')

  await start()
  await window.qa.call('release')
  await idle()
  await window.qa.call('holdHistory')
  window.dispatchEvent(new Event('focus'))
  await window.qa.call('historyStarted')
  await window.qa.call('mutate')
  window.qa.changed()
  await until(() => document.body.textContent.includes('Generate a new answer'))
  await window.qa.call('releaseHistory')
  await frame()
  assert(!visible(), 'older history overwrote newer source-invalidated refresh')
  results.push('older history cannot replace newer refresh')

  await start()
  await window.qa.call('release')
  await idle()
  await window.qa.call('holdResolve')
  document.querySelector('.cited-citations button').click()
  await window.qa.call('resolveStarted')
  window.qa.changed()
  await frame()
  await window.qa.call('releaseResolve')
  await frame()
  assert(!document.querySelector('dialog'), 'late citation response reopened source after refresh')
  results.push('late source response remains fenced after refresh')

  await start()
  window.qa.unmount()
  await window.qa.call('release')
  await frame()
  assert(!document.getElementById('root').textContent, 'unmounted owner received a completion')
  assert(!(await window.qa.call('saved')).some((e) => e.claim), 'unmounted request persisted')
  results.push('unmount cancels active ownership')
  return results
}
