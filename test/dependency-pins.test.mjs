/**
 * Third-party pins that must not drift.
 *
 * `@tencent-connect/qqbot-connector` ships as minified `dist` under `UNLICENSED`
 * with no repository field, so an upgrade is a code change nobody can review in
 * a diff. These assertions keep it on one exact version and keep the lockfile's
 * integrity hash in place; bumping it deliberately means updating this test.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('..', import.meta.url).pathname;

test('the QQ connector stays on one exact, integrity-pinned version', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.dependencies['@tencent-connect/qqbot-connector'], '1.2.0');
  assert.equal(manifest.dependencies['@tencent-connect/qqbot-nodejs'], '1.0.4');
  const lock = await readFile(join(root, 'pnpm-lock.yaml'), 'utf8');
  const block = lock.split("'@tencent-connect/qqbot-connector@1.2.0':")[1] ?? '';
  assert.match(block, /resolution: \{integrity: sha512-[A-Za-z0-9+/=]+\}/u);
});
