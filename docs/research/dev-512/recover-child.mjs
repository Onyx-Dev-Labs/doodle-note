// Fresh-process probe. stdin contains only synthetic fixture keys and ciphertext.
import { restore } from './probe.mjs';

let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 8 * 1024 * 1024) throw new Error('Probe input limit');
}
const { bundle, recoveryKey } = JSON.parse(input);
const restored = restore(bundle, Buffer.from(recoveryKey, 'base64'));
process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(restored).map(([role, bytes]) => [role, bytes.toString('base64')]))));
