/* Synthetic SettingsCloudAccess regression. No network, account, audio or real
 * preference writes. Run with DOODLE_PLAYWRIGHT_MODULE=/path/to/playwright.
 * The layout-effect snapshot deliberately checks the FIRST commit after a new
 * connection revision, before passive effects can erase a stale grant.
 */
const { launchRenderer } = require('./fixtures/renderer-qa.cjs')
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
async function main() {
  const { runtime, page, output, errors } = await launchRenderer({
    name: 'settings-cloud-access',
    width: 1000,
    height: 850,
    contents: `
import React, { useState, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { SettingsCloudAccess } from "./SettingsCloudAccess";
import "./assets/main.css";
import "./assets/redesign-type.css";
import "./assets/settings-redesign.css";
const w = window as any;
let seq = 0;
const pending = new Map();
w.events = [];
w.requests = [];
w.commits = [];
w.sync = {
  getRemoteMcpEligibility() {
    const id = ++seq;
    w.requests.push(id);
    return new Promise((resolve, reject) =>
      pending.set(id, { resolve, reject }),
    );
  },
};
w.resolve = (id, value) => pending.get(id).resolve(value);
w.reject = (id) => pending.get(id).reject(new Error("offline"));
w.open = (url) => {
  w.events.push("open:" + url);
  return null;
};
function Harness() {
  const [props, set] = useState<any>({
    active: true,
    status: {
      connected: false,
      linking: false,
      baseUrl: "https://fixture.invalid",
      connectionRevision: 1,
      enabled: true,
    },
  });
  w.setProps = (next) =>
    flushSync(() =>
      set((prev: any) => ({
        ...prev,
        ...next,
        status: next.status ? { ...prev.status, ...next.status } : prev.status,
      })),
    );
  useLayoutEffect(() => {
    const el = document.querySelector(".settings-cloud-controls");
    w.commits.push({ status: props.status, locked: el?.hasAttribute("inert") });
  });
  return (
    <div className="models settings-redesign">
      <main className="settings-content" style={{ padding: 40, width: 800 }}>
        <h1>Cloud access fixture</h1>
        <SettingsCloudAccess
          {...props}
          onConnect={() => w.events.push("connect")}
          onDisconnect={() => w.events.push("disconnect")}
        >
          <section
            style={{
              minHeight: 500,
              padding: 28,
              background: "var(--card)",
              borderRadius: 18,
            }}
          >
            <h2>Cloud sync</h2>
            <button id="child" onClick={() => w.events.push("child")}>
              Private setting action
            </button>
            <input aria-label="Private setting text" />
            <a href="#private" onClick={() => w.events.push("private")}>
              Private settings link
            </a>
          </section>
        </SettingsCloudAccess>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
`
  })
  const results = []
  try {
    await page.waitForFunction(() => !!window.setProps)
    const snap = () =>
      page.evaluate(() => ({
        locked: document.querySelector('.settings-cloud-controls').inert,
        hidden: document.querySelector('.settings-cloud-controls').getAttribute('aria-hidden'),
        heading: document.querySelector('.settings-cloud-unlock h2')?.textContent,
        requests: window.requests,
        events: window.events
      }))
    const check = async (name, locked) => {
      const s = await snap()
      assert.equal(s.locked, locked, name)
      assert.equal(s.hidden, locked ? 'true' : null, name + ' aria')
      results.push({ name, ...s })
    }
    const props = async (p) => {
      await page.evaluate((p) => window.setProps(p), p)
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      )
    }
    const last = () => page.evaluate(() => window.requests.at(-1))
    const resolve = async (id, val) => {
      await page.evaluate(([id, val]) => window.resolve(id, val), [id, val])
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      )
    }
    await check('disconnected', true)
    assert.equal((await snap()).requests.length, 0)
    await page.getByRole('button', { name: 'Already subscribed? Connect your account' }).click()
    await page.getByRole('button', { name: 'Get Cloud Sync', exact: true }).click()
    assert.deepEqual((await snap()).events, ['connect', 'open:https://www.doodlenote.ai/pricing'])
    await page.mouse.move(5, 5)
    await page.waitForTimeout(200)
    await page.screenshot({ path: path.join(output, 'cloud-disconnected.png') })
    const checkCtaContrast = async (theme) => {
      await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme)
      await page.getByRole('button', { name: 'Get Cloud Sync', exact: true }).hover()
      await page.waitForTimeout(200) // Let the 120ms color transition complete.
      const styles = await page.locator('.settings-cloud-upgrade').evaluate((el) => ({
        bg: getComputedStyle(el).backgroundColor,
        color: getComputedStyle(el).color
      }))
      const luminance = (value) => {
        const rgb = value
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number)
          .map((v) => {
            const srgb = v / 255
            return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
          })
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
      }
      const a = luminance(styles.bg),
        b = luminance(styles.color)
      const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      assert.ok(contrast >= 4.5, `${theme} upgrade hover contrast ${contrast} is below 4.5`)
      results.push({ name: `${theme} CTA hover contrast`, contrast, styles })
    }
    await checkCtaContrast('light')
    await page.mouse.move(5, 5)
    await page.evaluate(() => document.body.focus())
    const focus = []
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab')
      focus.push(
        await page.evaluate(() => ({
          id: document.activeElement.id,
          text: document.activeElement.textContent,
          label: document.activeElement.getAttribute('aria-label')
        }))
      )
    }
    assert.ok(
      focus.every(
        (f) =>
          f.id !== 'child' &&
          f.label !== 'Private setting text' &&
          f.text !== 'Private settings link'
      )
    )
    results.push({ name: 'locked keyboard navigation', focus })
    await props({ status: { connected: true } })
    await check('connected checking', true)
    await resolve(await last(), false)
    await check('connected unpaid', true)
    await page.getByRole('button', { name: 'Check subscription again' }).click()
    await resolve(await last(), true)
    await check('eligible', false)
    await page.getByRole('button', { name: 'Private setting action' }).click()
    assert.ok((await snap()).events.includes('child'))
    await page.screenshot({ path: path.join(output, 'cloud-unlocked.png') })
    await props({ status: { enabled: false } })
    await check('paused sync eligible', false)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    const old = await last()
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    const newer = await last()
    await resolve(newer, false)
    await resolve(old, true)
    await check('newer denial beats older approval', true)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    const disconnectPending = await last()
    await props({ status: { connected: false, connectionRevision: 2 } })
    await resolve(disconnectPending, true)
    await check('disconnected rejects stale approval', true)
    await props({ status: { connected: true, connectionRevision: 3 } })
    const rekeyPending = await last()
    await props({ status: { connectionRevision: 4, baseUrl: 'https://second.invalid' } })
    const rekeyLatest = await last()
    await resolve(rekeyPending, true)
    await check('rekey rejects old approval', true)
    await resolve(rekeyLatest, true)
    await check('new account allowed', false)
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))
    await check('offline locks', true)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.evaluate((id) => window.reject(id), await last())
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    )
    await check('lookup error locks', true)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await resolve(await last(), true)
    await check('focus refresh restores', false)
    await props({ status: { connectionRevision: 5 } })
    await check('rekey checking locks', true)
    const commits = await page.evaluate(() => window.commits)
    results.push({ name: 'commit snapshots', commits })
    assert.equal(
      commits.find((c) => c.status.connectionRevision === 5)?.locked,
      true,
      'account revision must lock in first commit'
    )
    await props({ active: false })
    await resolve(await last(), true)
    await check('inactive rejects stale approval', true)
    await checkCtaContrast('dark')
    await page.waitForTimeout(200)
    await page.screenshot({ path: path.join(output, 'cloud-locked-dark.png') })
    fs.writeFileSync(path.join(output, 'cloud-report.json'), JSON.stringify(results, null, 2))
    assert.deepEqual(errors, [])
    console.log(
      'PASS: cloud gate, keyboard, paused sync, account revision at first commit, stale grants, disconnect, offline/error, focus refresh. Artifacts:',
      output
    )
  } finally {
    await runtime.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
