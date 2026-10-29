import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('actual SDK upgrade HTTP regressions (isolated synthetic process)', () => {
  const result = spawnSync(process.execPath, ['--conditions=react-server', '--import', 'tsx', '--test', 'scripts/auth-upgrade/upgrade.test.mts', 'scripts/auth-upgrade/production-config.test.mts'], {
    cwd: new URL('..', import.meta.url),
    env: { PATH: process.env.PATH, NODE_ENV: 'test', CI: '1', BETTER_AUTH_TELEMETRY: '0' },
    encoding: 'utf8', timeout: 120_000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
