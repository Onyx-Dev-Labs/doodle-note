// Run with the minimum supported Node after building dist/cli.js.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
const root = mkdtempSync(join(tmpdir(), 'doodle-mcp-smoke-'));
const dir = join(root, 'meetings'); mkdirSync(dir);
const config = join(root, 'mcp.json');
writeFileSync(config, JSON.stringify({ enabled: true, meetingsDir: dir }));
writeFileSync(join(dir, 'synthetic.json'), JSON.stringify({ id: 'synthetic', segments: [{ id: 'original', text: 'offline needle', speaker: 'Synthetic' }] }));
const child = spawn(process.execPath, [new URL('../dist/cli.js', import.meta.url).pathname], { env: { ...process.env, DOODLE_NOTE_MCP_CONFIG: config }, stdio: ['pipe', 'pipe', 'pipe'] });
const waiters = new Map(); let next = 0; let stderr = '';
child.stderr.on('data', data => stderr += data);
createInterface({ input: child.stdout }).on('line', line => { const reply = JSON.parse(line); const waiter = waiters.get(reply.id); if (waiter) { clearTimeout(waiter.timeout); waiters.delete(reply.id); waiter.resolve(reply); } });
function call(method, params) { const id = ++next; return new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error(`MCP timed out: ${stderr}`)), 10000); waiters.set(id, { resolve, timeout }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); }); }
try {
  const init = await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'synthetic-smoke', version: '1' } }); assert.ok(init.result);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const list = await call('tools/list', {}); assert.ok(list.result.tools.some(t => t.name === 'search_meeting_sources'));
  const search = await call('tools/call', { name: 'search_meeting_sources', arguments: { query: 'needle' } });
  const result = JSON.parse(search.result.content[0].text); assert.equal(result.hits.length, 1);
  const anchor = result.hits[0].anchor;
  const resolved = await call('tools/call', { name: 'resolve_meeting_source', arguments: { anchor } }); assert.equal(JSON.parse(resolved.result.content[0].text).status, 'resolved');
  assert.deepEqual(readdirSync(dir), ['synthetic.json']);
  writeFileSync(join(dir, 'synthetic.json'), JSON.stringify({ id: 'synthetic', rawNotesMarkdown: 'edited' }));
  const stale = await call('tools/call', { name: 'resolve_meeting_source', arguments: { anchor } }); assert.equal(JSON.parse(stale.result.content[0].text).status, 'stale');
  writeFileSync(config, JSON.stringify({ enabled: false, meetingsDir: dir }));
  const revoked = await call('tools/call', { name: 'search_meeting_sources', arguments: { query: 'needle' } }); assert.equal(revoked.result.isError, true);
  console.log(JSON.stringify({ passed: true, node: process.versions.node, checks: ['stdio initialize', 'local source tools', 'resolve', 'stale edit', 'revocation', 'no identity/cache writes'] }));
} finally { child.kill(); for (const w of waiters.values()) clearTimeout(w.timeout); rmSync(root, { recursive: true, force: true }); }
