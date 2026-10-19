import type { CalendarEvent } from '../shared/calendar-api'
import type { SourceScope } from '@repo/meetings-store/source-contract'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  realpathSync,
  existsSync,
  statSync,
  symlinkSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { localSourceScope } from '@repo/meetings-store/sources'
import { CalendarContextStore, CONTEXT_FILE, CONTEXT_MAX_BYTES } from './calendar-context-store'
import { normalizeCalendarInvitees } from './calendar-context-normalization'
import { accountKey, scopeCalendar, scopeEvent } from './calendar-identity'
import { LibraryActivity } from './library-activity'
import { LibraryStorage } from './library-storage'

function fixture(t: { after(fn: () => void): void }): {
  root: string
  store: CalendarContextStore
  scope: SourceScope
  activity: LibraryActivity
  control: { assertCurrent(): void }
  makeEvent(subject: string, account?: string): CalendarEvent
  invalidate(): void
  account: string
} {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dev509-context-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const meetings = join(root, 'meetings')
  mkdirSync(meetings)
  // Synthetic fixture stands in for canonical source-worker initialization, never production code.
  const scope = localSourceScope(meetings, true)
  let current = true
  const control = {
    assertCurrent: () => {
      if (!current) throw new Error('stale')
    }
  }
  const activity = new LibraryActivity()
  const store = new CalendarContextStore(
    () => root,
    () => {},
    activity
  )
  const makeEvent = (subject: string, account = 'one'): CalendarEvent => {
    const identity = { provider: 'google' as const, subject: account }
    const calendar = scopeCalendar(identity, {
      id: 'calendar',
      name: 'Synthetic',
      colorHex: '#000',
      isDefault: true,
      canEdit: false
    })
    return scopeEvent(identity, calendar, {
      id: 'occurrence',
      subject,
      startIso: '2026-10-18T20:00:00.000Z',
      endIso: '2026-10-18T21:00:00.000Z',
      isAllDay: false,
      isOnlineMeeting: false,
      hasParticipants: true,
      calendarId: calendar.id,
      invitees: normalizeCalendarInvitees('google', {
        attendees: [{ email: 'a@example.test', displayName: 'Alex' }]
      })
    })
  }
  return {
    root,
    store,
    scope,
    activity,
    control,
    makeEvent,
    invalidate: () => {
      current = false
    },
    account: accountKey({ provider: 'google', subject: 'one' })
  }
}

test('snapshot reuse ignores observation time; corrections/rules retain immutable provenance across restart', async (t) => {
  const f = fixture(t)
  const empty = await f.store.read(f.control)
  const first = await f.store.capture(f.makeEvent('Synthetic'), null, empty.revision, f.control)
  const again = await f.store.capture(
    f.makeEvent('Synthetic'),
    '2026-10-18T21:00:00.000Z',
    first.revision,
    f.control
  )
  assert.equal(first.snapshot.id, again.snapshot.id)
  assert.equal(first.revision, again.revision)
  const person = await f.store.createEntity(
    'person',
    f.account,
    'Local Alex',
    again.revision,
    f.control
  )
  const linked = await f.store.change(
    {
      op: 'bind-invitee',
      snapshotId: first.snapshot.id,
      inviteeId: first.snapshot.invitees[0]!.id,
      personId: person.entity.id
    },
    person.revision,
    f.control
  )
  const rule = await f.store.change(
    {
      op: 'set-rule',
      accountId: f.account,
      identifierKey: first.snapshot.invitees[0]!.identifierKey!,
      personId: person.entity.id
    },
    linked.revision,
    f.control
  )
  const moved = await f.store.capture(
    f.makeEvent('Rescheduled title'),
    null,
    rule.revision,
    f.control
  )
  const saved = await new CalendarContextStore(
    () => f.root,
    () => {},
    f.activity
  ).read(f.control)
  assert.equal(saved.snapshots[first.snapshot.id]!.subject, 'Synthetic')
  assert.equal(saved.snapshots[moved.snapshot.id]!.subject, 'Rescheduled title')
  assert.equal(
    f.store.view(saved).bindings[moved.snapshot.id]?.[first.snapshot.invitees[0]!.id]?.personId,
    person.entity.id
  )
  assert.deepEqual(saved.scope, f.scope)
  // Windows mode bits do not express owner/group/other access; test its DACL below.
  if (process.platform !== 'win32')
    assert.equal(statSync(join(f.root, CONTEXT_FILE)).mode & 0o777, 0o600)
})

test(
  'Windows context creation and atomic replacement inherit the restricted library DACL',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const f = fixture(t)
    const powershell = (script: string): void => {
      // Paths are data, never interpolated into shell code. Only this test-owned root changes.
      execFileSync(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(`$ErrorActionPreference = 'Stop'\n${script}`, 'utf16le').toString('base64')
        ],
        {
          env: { ...process.env, DEV509_ACL_FIXTURE_ROOT: f.root },
          timeout: 30_000,
          stdio: 'pipe'
        }
      )
    }
    const identity = `
      $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
      $inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
      $full = [System.Security.AccessControl.FileSystemRights]::FullControl
      $allow = [System.Security.AccessControl.AccessControlType]::Allow
    `
    try {
      powershell(`${identity}
        $acl = [System.Security.AccessControl.DirectorySecurity]::new()
        $acl.SetAccessRuleProtection($true, $false)
        $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
          $sid, $full, $inherit, [System.Security.AccessControl.PropagationFlags]::None, $allow))
        Set-Acl -LiteralPath $env:DEV509_ACL_FIXTURE_ROOT -AclObject $acl
        $actual = Get-Acl -LiteralPath $env:DEV509_ACL_FIXTURE_ROOT
        $rules = @($actual.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
        if (-not $actual.AreAccessRulesProtected -or $rules.Count -ne 1) {
          throw 'Synthetic root must have exactly one protected explicit access rule'
        }
        $rule = $rules[0]
        if ($rule.IdentityReference.Value -ne $sid.Value -or $rule.IsInherited -or
            $rule.AccessControlType -ne $allow -or $rule.FileSystemRights -ne $full -or
            $rule.InheritanceFlags -ne $inherit -or $rule.PropagationFlags -ne 'None') {
          throw 'Synthetic root must grant only the current test user inheritable FullControl'
        }
      `)
      const assertInherited = (): void =>
        powershell(`${identity}
        $path = Join-Path $env:DEV509_ACL_FIXTURE_ROOT '${CONTEXT_FILE}'
        $acl = Get-Acl -LiteralPath $path
        $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
        if ($acl.AreAccessRulesProtected -or $rules.Count -ne 1) {
          throw 'Context file must inherit exactly the restricted root access rule'
        }
        $rule = $rules[0]
        if (-not $rule.IsInherited -or $rule.IdentityReference.Value -ne $sid.Value -or
            $rule.AccessControlType -ne $allow -or $rule.FileSystemRights -ne $full -or
            $rule.InheritanceFlags -ne 'None' -or $rule.PropagationFlags -ne 'None') {
          throw 'Context file DACL changed the inherited identity or access rights'
        }
      `)
      const first = await f.store.capture(f.makeEvent('Initial'), null, 0, f.control)
      assertInherited()
      const next = await f.store.capture(
        f.makeEvent('Replacement'),
        null,
        first.revision,
        f.control
      )
      assert.equal(next.revision, first.revision + 1)
      assertInherited()
      const saved = await f.store.read(f.control)
      assert.equal(saved.snapshots[first.snapshot.id]!.subject, 'Initial')
      assert.equal(saved.snapshots[next.snapshot.id]!.subject, 'Replacement')
    } finally {
      await f.store.dispose()
    }
  }
)

test('same-address accounts stay separate; negative occurrence corrections beat future rules', async (t) => {
  const f = fixture(t)
  const one = await f.store.capture(f.makeEvent('One'), null, 0, f.control)
  const person = await f.store.createEntity('person', f.account, 'Alex', one.revision, f.control)
  const rule = await f.store.change(
    {
      op: 'set-rule',
      accountId: f.account,
      identifierKey: one.snapshot.invitees[0]!.identifierKey!,
      personId: person.entity.id
    },
    person.revision,
    f.control
  )
  const two = await f.store.capture(f.makeEvent('Two', 'two'), null, rule.revision, f.control)
  await assert.rejects(
    f.store.change(
      {
        op: 'bind-invitee',
        snapshotId: two.snapshot.id,
        inviteeId: two.snapshot.invitees[0]!.id,
        personId: person.entity.id
      },
      two.revision,
      f.control
    ),
    /account/
  )
  const excluded = await f.store.change(
    {
      op: 'exclude-person',
      eventId: one.snapshot.eventId,
      identifierKey: one.snapshot.invitees[0]!.identifierKey!,
      personId: person.entity.id
    },
    two.revision,
    f.control
  )
  const next = await f.store.capture(f.makeEvent('One changed'), null, excluded.revision, f.control)
  const view = f.store.view(await f.store.read(f.control))
  assert.equal(
    view.bindings[next.snapshot.id]?.[next.snapshot.invitees[0]!.id]?.personId ?? null,
    null
  )
  assert.equal(
    view.bindings[two.snapshot.id]?.[two.snapshot.invitees[0]!.id]?.personId ?? null,
    null
  )
})

test('known validation, optimistic revision, external edit and unknown nested field preservation', async (t) => {
  const f = fixture(t)
  const captured = await f.store.capture(f.makeEvent('Synthetic'), null, 0, f.control)
  const path = join(f.root, CONTEXT_FILE)
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  raw.future = { keep: ['exact', 7] }
  raw.snapshots[captured.snapshot.id].future = { keep: true }
  writeFileSync(path, JSON.stringify(raw))
  await assert.rejects(
    f.store.createEntity('person', f.account, 'Alex', captured.revision, f.control),
    /external|changed/
  )
  const refreshed = await f.store.read(f.control)
  const created = await f.store.createEntity(
    'person',
    f.account,
    'Alex',
    refreshed.revision,
    f.control
  )
  const updated = JSON.parse(readFileSync(path, 'utf8'))
  assert.deepEqual(updated.future, raw.future)
  assert.deepEqual(updated.snapshots[captured.snapshot.id].future, { keep: true })
  await assert.rejects(
    f.store.createEntity('person', f.account, 'Other', created.revision - 1, f.control),
    /revision|changed/
  )
  const before = readFileSync(path)
  await assert.rejects(
    f.store.change(
      {
        op: 'bind-invitee',
        snapshotId: 'missing',
        inviteeId: 'invitee:0',
        personId: created.entity.id
      },
      created.revision,
      f.control
    ),
    /snapshot|reference/
  )
  assert.deepEqual(readFileSync(path), before)
})

test('corrupt/future/wrong-scope/symlink data remains untouched and missing canonical marker is never created', async (t) => {
  const f = fixture(t)
  const path = join(f.root, CONTEXT_FILE)
  for (const raw of [
    '{broken',
    JSON.stringify({ version: 2 }),
    JSON.stringify({ version: 1, scope: { ...f.scope, accountId: 'wrong' } })
  ]) {
    writeFileSync(path, raw)
    await assert.rejects(f.store.read(f.control))
    assert.equal(readFileSync(path, 'utf8'), raw)
  }
  rmSync(path)
  const outside = join(f.root, 'keep')
  writeFileSync(outside, 'outside')
  symlinkSync(outside, path)
  await assert.rejects(f.store.read(f.control))
  assert.equal(readFileSync(outside, 'utf8'), 'outside')
  rmSync(path)
  rmSync(join(f.root, 'meetings', '.doodlenote-source-library.json'))
  await assert.rejects(f.store.read(f.control), /canonical/)
  assert.equal(existsSync(join(f.root, 'meetings', '.doodlenote-source-library.json')), false)
})

test('failure before atomic rename and invalidated queued writes preserve committed bytes', async (t) => {
  const f = fixture(t)
  const captured = await f.store.capture(f.makeEvent('Synthetic'), null, 0, f.control)
  const before = readFileSync(join(f.root, CONTEXT_FILE))
  const failing = new CalendarContextStore(
    () => f.root,
    () => {},
    f.activity,
    {
      beforeRename: () => {
        throw new Error('synthetic disk failure')
      }
    }
  )
  await failing.read(f.control)
  await assert.rejects(
    failing.createEntity('person', f.account, 'Alex', captured.revision, f.control),
    /disk failure/
  )
  assert.deepEqual(readFileSync(join(f.root, CONTEXT_FILE)), before)
  let unblock!: () => void
  const move = f.activity.exclusive(
    () =>
      new Promise<void>((resolve) => {
        unblock = resolve
      })
  )
  const queued = f.store.createEntity('person', f.account, 'Alex', captured.revision, f.control)
  f.invalidate()
  unblock()
  await move
  await assert.rejects(queued, /stale/)
  assert.deepEqual(readFileSync(join(f.root, CONTEXT_FILE)), before)
})

test('capacity never silently prunes; explicit revision-bound forget preserves originals and other accounts', async (t) => {
  const f = fixture(t)
  const one = await f.store.capture(f.makeEvent('One'), null, 0, f.control)
  const two = await f.store.capture(f.makeEvent('Two', 'two'), null, one.revision, f.control)
  const original = join(f.root, 'meetings', 'original.json')
  writeFileSync(original, 'synthetic raw bytes')
  const preview = await f.store.previewForget(f.account, f.control)
  assert.equal(preview.snapshots, 1)
  const person = await f.store.createEntity('person', f.account, 'Alex', two.revision, f.control)
  await assert.rejects(
    f.store.forget(f.account, preview.revision, f.control, preview.previewId),
    /revision|changed/
  )
  const path = join(f.root, CONTEXT_FILE)
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  raw.padding = 'x'.repeat(CONTEXT_MAX_BYTES - Buffer.byteLength(JSON.stringify(raw)) - 20)
  writeFileSync(path, JSON.stringify(raw))
  await f.store.read(f.control)
  const before = readFileSync(path)
  await assert.rejects(
    f.store.createEntity('person', f.account, 'A'.repeat(256), person.revision, f.control),
    /capacity/
  )
  assert.deepEqual(readFileSync(path), before)
  const forgotten = await f.store.forget(
    f.account,
    person.revision,
    f.control,
    (await f.store.previewForget(f.account, f.control)).previewId
  )
  assert.equal(Object.keys(forgotten.snapshots).length, 1)
  assert.ok(forgotten.snapshots[two.snapshot.id])
  assert.equal(readFileSync(original, 'utf8'), 'synthetic raw bytes')
})

test('relocation allowlist carries exact context bytes and canonical source identity', async (t) => {
  const f = fixture(t)
  await f.store.capture(f.makeEvent('Synthetic'), null, 0, f.control)
  const bytes = readFileSync(join(f.root, CONTEXT_FILE))
  const destination = realpathSync(mkdtempSync(join(tmpdir(), 'dev509-move-')))
  t.after(() => rmSync(destination, { recursive: true, force: true }))
  const storage = new LibraryStorage(f.root)
  storage.schedule(destination)
  await storage.finishPending()
  assert.deepEqual(readFileSync(join(storage.root, CONTEXT_FILE)), bytes)
  const moved = new CalendarContextStore(() => storage.root, storage.assertAvailable, f.activity)
  assert.deepEqual((await moved.read(f.control)).scope, f.scope)
})

test('negative correction immediately removes a rule match and corrections carry provenance to a new snapshot', async (t) => {
  const f = fixture(t)
  const first = await f.store.capture(f.makeEvent('One'), null, 0, f.control)
  const p = await f.store.createEntity('person', f.account, 'Alex', first.revision, f.control)
  const bound = await f.store.change(
    {
      op: 'bind-invitee',
      snapshotId: first.snapshot.id,
      inviteeId: 'invitee:0',
      personId: p.entity.id
    },
    p.revision,
    f.control
  )
  const changed = await f.store.capture(f.makeEvent('Changed'), null, bound.revision, f.control)
  const inherited = (await f.store.read(f.control)).changes.at(-1)!
  assert.equal(inherited.provenance, 'user')
  assert.equal(inherited.supersedes, bound.changes.at(-1)!.id)
  const excluded = await f.store.change(
    {
      op: 'exclude-person',
      eventId: first.snapshot.eventId,
      identifierKey: first.snapshot.invitees[0]!.identifierKey!,
      personId: p.entity.id
    },
    changed.revision,
    f.control
  )
  assert.equal(f.store.view(excluded).bindings[changed.snapshot.id]?.['invitee:0']?.personId, null)
})
test('prototype references and invalid payloads fail closed', async (t) => {
  const f = fixture(t)
  const first = await f.store.capture(f.makeEvent('One'), null, 0, f.control)
  const before = readFileSync(join(f.root, CONTEXT_FILE))
  await assert.rejects(
    f.store.change(
      { op: 'rename', entity: 'person', id: '__proto__', displayName: 'Oops' },
      first.revision,
      f.control
    ),
    /reference/
  )
  assert.deepEqual(readFileSync(join(f.root, CONTEXT_FILE)), before)
})
test('company membership is fixed at link time; unlink keeps provenance and does not change original bytes', async (t) => {
  const f = fixture(t)
  const first = await f.store.capture(f.makeEvent('One'), null, 0, f.control)
  const p = await f.store.createEntity('person', f.account, 'Alex', first.revision, f.control)
  const c1 = await f.store.createEntity(
    'company',
    f.account,
    'First company',
    p.revision,
    f.control
  )
  const c2 = await f.store.createEntity(
    'company',
    f.account,
    'Next company',
    c1.revision,
    f.control
  )
  const linked = await f.store.change(
    {
      op: 'link-meeting',
      meetingId: 'original',
      target: { kind: 'person', personId: p.entity.id },
      snapshotId: first.snapshot.id,
      sourceRevisionAtLink: 'a'.repeat(64),
      originalHashAtLink: 'b'.repeat(64),
      companyIdAtLink: c1.entity.id
    },
    c2.revision,
    f.control
  )
  const updated = await f.store.change(
    { op: 'set-company', personId: p.entity.id, companyId: c2.entity.id },
    linked.revision,
    f.control
  )
  assert.equal(f.store.view(updated).links[0]!.payload.companyIdAtLink, c1.entity.id)
  const unlinked = await f.store.change(
    { op: 'unlink-meeting', linkChangeId: linked.changes.at(-1)!.id },
    updated.revision,
    f.control
  )
  assert.equal(f.store.view(unlinked).links.length, 0)
  assert.ok(unlinked.changes.some((c) => c.id === linked.changes.at(-1)!.id))
})

test('accepted starts link only newly created originals; old snapshotless notes and Resume never gain today’s roster', async (t) => {
  const f = fixture(t)
  const original = {
    meetingId: 'new-note',
    calendarEventId: f.makeEvent('One').id,
    scope: f.scope,
    rawSha256: 'a'.repeat(64),
    projectedRevisionId: 'b'.repeat(64),
    trashed: false
  }
  await f.store.recordAcceptedStart(
    {
      event: f.makeEvent('One'),
      lastSyncIso: null,
      original,
      existedAtAttach: true,
      captureId: 'existing-capture'
    },
    f.control
  )
  assert.equal(f.store.view(await f.store.read(f.control)).links.length, 0)
  await f.store.recordAcceptedStart(
    {
      event: f.makeEvent('One'),
      lastSyncIso: null,
      original,
      existedAtAttach: false,
      captureId: 'new-capture'
    },
    f.control
  )
  const linked = await f.store.read(f.control)
  assert.equal(f.store.view(linked).links.length, 1)
  assert.equal(linked.changes.at(-1)!.provenance, 'accepted-start')
  const originalSnapshot = f.store.view(linked).links[0]!.payload.snapshotId
  await f.store.recordAcceptedStart(
    {
      event: f.makeEvent('Changed roster'),
      lastSyncIso: null,
      original,
      existedAtAttach: true,
      captureId: 'resume-capture'
    },
    f.control
  )
  const resumed = f.store.view(await f.store.read(f.control)).links
  assert.equal(resumed.length, 1)
  assert.equal(resumed[0]!.payload.snapshotId, originalSnapshot)
  await assert.rejects(
    f.store.recordAcceptedStart(
      {
        event: f.makeEvent('One'),
        lastSyncIso: null,
        original: { ...original, scope: { ...f.scope, accountId: 'different' } },
        existedAtAttach: false,
        captureId: 'bad'
      },
      f.control
    ),
    /scope/
  )
})

test('rules do not reinterpret old observations; an explicit historical batch commits concrete bindings', async (t) => {
  const f = fixture(t)
  const old = await f.store.capture(f.makeEvent('Old'), null, 0, f.control)
  const p = await f.store.createEntity('person', f.account, 'Alex', old.revision, f.control)
  const rule = await f.store.change(
    {
      op: 'set-rule',
      accountId: f.account,
      identifierKey: old.snapshot.invitees[0]!.identifierKey!,
      personId: p.entity.id
    },
    p.revision,
    f.control
  )
  assert.equal(f.store.view(rule).bindings[old.snapshot.id], undefined)
  const applied = await f.store.applyHistoricalBindings(
    [{ snapshotId: old.snapshot.id, inviteeId: 'invitee:0', personId: p.entity.id }],
    rule.revision,
    f.control
  )
  assert.equal(
    f.store.view(applied).bindings[old.snapshot.id]?.['invitee:0']?.personId,
    p.entity.id
  )
  const bytes = readFileSync(join(f.root, CONTEXT_FILE))
  await assert.rejects(
    f.store.applyHistoricalBindings(
      [{ snapshotId: old.snapshot.id, inviteeId: 'missing', personId: p.entity.id }],
      applied.revision,
      f.control
    ),
    /reference/
  )
  assert.deepEqual(readFileSync(join(f.root, CONTEXT_FILE)), bytes)
})
test('fsync failure preserves committed revision; abort during fsync cannot publish afterward', async (t) => {
  const f = fixture(t)
  const first = await f.store.capture(f.makeEvent('One'), null, 0, f.control)
  const before = readFileSync(join(f.root, CONTEXT_FILE))
  const failing = new CalendarContextStore(
    () => f.root,
    () => {},
    f.activity,
    {
      sync: async () => {
        throw new Error('synthetic fsync failed')
      }
    }
  )
  await assert.rejects(
    failing.createEntity('person', f.account, 'Alex', first.revision, f.control),
    /fsync/
  )
  assert.deepEqual(readFileSync(join(f.root, CONTEXT_FILE)), before)
  const aborting = new CalendarContextStore(
    () => f.root,
    () => {},
    f.activity,
    {
      sync: async (handle) => {
        await handle.sync()
        f.invalidate()
      }
    }
  )
  await assert.rejects(
    aborting.createEntity('person', f.account, 'Alex', first.revision, f.control),
    /stale/
  )
  assert.deepEqual(readFileSync(join(f.root, CONTEXT_FILE)), before)
  await failing.dispose()
  await aborting.dispose()
})

test('forget preview is account/digest bound even when an external editor keeps the same revision', async (t) => {
  const f = fixture(t)
  const one = await f.store.capture(f.makeEvent('One'), null, 0, f.control)
  const preview = await f.store.previewForget(f.account, f.control)
  const path = join(f.root, CONTEXT_FILE)
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  raw.future = 'external edit'
  writeFileSync(path, JSON.stringify(raw))
  await f.store.read(f.control)
  await assert.rejects(
    f.store.forget(f.account, one.revision, f.control, preview.previewId),
    /preview|external|changed/
  )
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).future, 'external edit')
})

test('changed snapshot content cannot reuse a stale observation digest; richer nested fields remain portable', async (t) => {
  const f = fixture(t)
  const first = await f.store.capture(f.makeEvent('One'), null, 0, f.control)
  const path = join(f.root, CONTEXT_FILE)
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  raw.snapshots[first.snapshot.id].invitees[0].future = { retained: true }
  raw.snapshots[first.snapshot.id].roster.future = 'retained'
  writeFileSync(path, JSON.stringify(raw))
  await f.store.read(f.control)
  const same = await f.store.capture(f.makeEvent('One'), null, first.revision, f.control)
  assert.equal(same.snapshot.id, first.snapshot.id)
  await f.store.createEntity('person', f.account, 'Alex', same.revision, f.control)
  const richer = JSON.parse(readFileSync(path, 'utf8'))
  assert.deepEqual(richer.snapshots[first.snapshot.id].invitees[0].future, { retained: true })
  assert.equal(richer.snapshots[first.snapshot.id].roster.future, 'retained')
  richer.snapshots[first.snapshot.id].subject = 'Altered observation'
  const corrupt = JSON.stringify(richer)
  writeFileSync(path, corrupt)
  await assert.rejects(f.store.read(f.control), /digest/)
  assert.equal(readFileSync(path, 'utf8'), corrupt)
})

test('content reversion preserves old snapshot history but carries the latest unassignment and self correction', async (t) => {
  const f = fixture(t)
  const a = await f.store.capture(f.makeEvent('A'), null, 0, f.control)
  const person = await f.store.createEntity('person', f.account, 'Alex', a.revision, f.control)
  const bound = await f.store.change(
    {
      op: 'bind-invitee',
      snapshotId: a.snapshot.id,
      inviteeId: 'invitee:0',
      personId: person.entity.id
    },
    person.revision,
    f.control
  )
  const b = await f.store.capture(f.makeEvent('B'), null, bound.revision, f.control)
  const unassigned = await f.store.change(
    { op: 'bind-invitee', snapshotId: b.snapshot.id, inviteeId: 'invitee:0', personId: null },
    b.revision,
    f.control
  )
  const self = await f.store.change(
    { op: 'set-self', snapshotId: b.snapshot.id, inviteeId: 'invitee:0', isSelf: true },
    unassigned.revision,
    f.control
  )
  const reverted = await f.store.capture(f.makeEvent('A'), null, self.revision, f.control)
  const after = await f.store.read(f.control)
  const view = f.store.view(after)
  assert.notEqual(reverted.snapshot.id, a.snapshot.id)
  assert.equal(view.bindings[reverted.snapshot.id]?.['invitee:0']?.personId, null)
  assert.equal(view.self[reverted.snapshot.id]?.['invitee:0'], true)
  assert.equal(view.bindings[a.snapshot.id]?.['invitee:0']?.personId, person.entity.id)
  assert.equal(
    (await f.store.capture(f.makeEvent('A'), null, reverted.revision, f.control)).snapshot.id,
    reverted.snapshot.id
  )
})
