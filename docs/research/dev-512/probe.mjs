// DEV-512 disposable research only. NOT an application storage format or API.
// No production modules, user paths, real keys, network or automatic migration.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const VERSION = 'DEV-512-DISPOSABLE-1';
const LIMIT = 1024 * 1024;
export const roles = ['notes', 'audio', 'attachment'];
export const newKey = () => randomBytes(32);

function context(library, role) {
  return Buffer.from(JSON.stringify([VERSION, library, role]));
}

function keyCheck(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Missing or invalid key');
}

function seal(bytes, key, aad) {
  keyCheck(key);
  if (!Buffer.isBuffer(bytes) || bytes.length > LIMIT) throw new Error('Probe size limit');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), body: body.toString('base64') };
}

function open(envelope, key, aad) {
  keyCheck(key);
  for (const field of ['iv', 'tag', 'body']) {
    if (typeof envelope?.[field] !== 'string' || envelope[field].length > 2 * LIMIT) {
      throw new Error('Malformed probe envelope');
    }
  }
  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  const body = Buffer.from(envelope.body, 'base64');
  if (iv.length !== 12 || tag.length !== 16 || body.length > LIMIT) throw new Error('Malformed probe envelope');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  // Never expose the provisional bytes returned by update before final authenticates.
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

export function pack(inputs, library, deviceKey, recoveryKey) {
  const contentKey = newKey();
  return {
    version: VERSION,
    library,
    device: seal(contentKey, deviceKey, context(library, 'wrap-device')),
    recovery: seal(contentKey, recoveryKey, context(library, 'wrap-recovery')),
    entries: Object.fromEntries(roles.map((role) => [role, seal(inputs[role], contentKey, context(library, role))])),
  };
}

export function restore(bundle, key, method = 'recovery') {
  if (bundle?.version !== VERSION || typeof bundle.library !== 'string') throw new Error('Unsupported probe format');
  if (!['device', 'recovery'].includes(method)) throw new Error('Unsupported key method');
  const contentKey = open(bundle[method], key, context(bundle.library, `wrap-${method}`));
  // Authenticate ALL entries before the caller receives any plaintext.
  return Object.fromEntries(roles.map((role) => [role, open(bundle.entries?.[role], contentKey, context(bundle.library, role))]));
}

// Test-only staging demonstration: caller supplies a disposable destination.
// Original files are never changed. No production activation/cleanup protocol is modeled.
export async function stage(originals, destination, library, deviceKey, recoveryKey, { cancel = false } = {}) {
  const inputs = Object.fromEntries(await Promise.all(roles.map(async (role) => [role, await readFile(`${originals}/${role}`)])));
  const bundle = pack(inputs, library, deviceKey, recoveryKey);
  if (cancel) throw new Error('Cancelled before staging');
  await writeFile(`${destination}/synthetic.vault`, JSON.stringify(bundle), { flag: 'wx', mode: 0o600 });
}
