import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { newKey, pack, restore, roles, stage } from './probe.mjs';

function fixture() {
  const inputs = {
    notes: Buffer.from(JSON.stringify({ title: 'Synthetic 🦉', transcript: 'Recovery fixture', unknownFutureField: { keep: true } })),
    audio: Buffer.from([0, 255, 1, 128, 2, 127]), // Arbitrary binary; NOT playable audio.
    attachment: Buffer.from([137, 80, 78, 71, 0, 13]), // Arbitrary binary; NOT a valid PNG.
  };
  const deviceKey = newKey();
  const recoveryKey = newKey();
  return { inputs, deviceKey, recoveryKey, bundle: pack(inputs, randomUUID(), deviceKey, recoveryKey) };
}

test('device and independent recovery keys restore every original byte', () => {
  const f = fixture();
  assert.deepEqual(restore(f.bundle, f.deviceKey, 'device'), f.inputs);
  assert.deepEqual(restore(f.bundle, f.recoveryKey), f.inputs);
  assert.notDeepEqual(f.bundle.device, f.bundle.recovery);
});

test('fresh process restores copied ciphertext with recovery key and no device key', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dev512-portability-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const f = fixture();
  // Transfer only ciphertext and the independently held synthetic recovery key.
  const portable = structuredClone(f.bundle);
  delete portable.device;
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./recover-child.mjs', import.meta.url))], {
    cwd: root,
    env: {},
    input: JSON.stringify({ bundle: portable, recoveryKey: f.recoveryKey.toString('base64') }),
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(child.status, 0, child.stderr);
  const restored = Object.fromEntries(Object.entries(JSON.parse(child.stdout)).map(([role, bytes]) => [role, Buffer.from(bytes, 'base64')]));
  assert.deepEqual(restored, f.inputs);
});

test('wrong or missing key fails, including device/recovery role substitution', () => {
  const f = fixture();
  assert.throws(() => restore(f.bundle, undefined), /Missing or invalid key/);
  assert.throws(() => restore(f.bundle, newKey()));
  assert.throws(() => restore(f.bundle, f.deviceKey));
  assert.throws(() => restore(f.bundle, f.recoveryKey, 'device'));
});

test('changed ciphertext or authentication tag cannot return plaintext', () => {
  const f = fixture();
  for (const field of ['body', 'tag']) {
    const corrupt = structuredClone(f.bundle);
    const bytes = Buffer.from(corrupt.entries.attachment[field], 'base64');
    bytes[0] ^= 1;
    corrupt.entries.attachment[field] = bytes.toString('base64');
    assert.throws(() => restore(corrupt, f.recoveryKey));
  }
});

test('library, entry role, format and wrapping substitution fail', () => {
  const f = fixture();
  const library = structuredClone(f.bundle);
  library.library = randomUUID();
  assert.throws(() => restore(library, f.recoveryKey));
  const swapped = structuredClone(f.bundle);
  [swapped.entries.notes, swapped.entries.audio] = [swapped.entries.audio, swapped.entries.notes];
  assert.throws(() => restore(swapped, f.recoveryKey));
  assert.throws(() => restore({ ...f.bundle, version: 'future-format' }, f.recoveryKey), /Unsupported probe format/);
  assert.throws(() => restore({ ...f.bundle, recovery: f.bundle.device }, f.deviceKey));
});

test('large input is explicitly outside this bounded experiment', () => {
  const f = fixture();
  assert.throws(() => pack({ ...f.inputs, audio: Buffer.alloc(1024 * 1024 + 1) }, 'synthetic', f.deviceKey, f.recoveryKey), /Probe size limit/);
});

test('cancel, missing volume and destination collision preserve synthetic originals', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dev512-staging-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = join(root, 'original');
  const destination = join(root, 'destination');
  await mkdir(original);
  await mkdir(destination);
  const f = fixture();
  for (const role of roles) await writeFile(join(original, role), f.inputs[role]);
  await assert.rejects(stage(original, destination, 'synthetic', f.deviceKey, f.recoveryKey, { cancel: true }), /Cancelled/);
  assert.deepEqual(await readdir(destination), []);
  await assert.rejects(stage(original, join(root, 'missing-volume'), 'synthetic', f.deviceKey, f.recoveryKey), { code: 'ENOENT' });
  await stage(original, destination, 'synthetic', f.deviceKey, f.recoveryKey);
  const staged = await readFile(join(destination, 'synthetic.vault'));
  assert.deepEqual(restore(JSON.parse(staged), f.recoveryKey), f.inputs);
  await assert.rejects(stage(original, destination, 'synthetic', f.deviceKey, f.recoveryKey), { code: 'EEXIST' });
  assert.deepEqual(await readFile(join(destination, 'synthetic.vault')), staged);
  for (const role of roles) assert.deepEqual(await readFile(join(original, role)), f.inputs[role]);
});
