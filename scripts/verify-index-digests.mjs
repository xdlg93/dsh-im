// Keep docs/index.json honest about what docs/pkg/ actually serves.
//
// For every listed version: a tarball that exists gets its sha256 recorded; a
// version whose tarball is gone loses the tgz fields, so the index never
// advertises a download that returns 404. The updater only reads the newest
// version's tarball, and older links are for manual installs.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const indexPath = join(root, 'docs', 'index.json');
const index = JSON.parse(await readFile(indexPath, 'utf8'));
const plugin = index.plugins?.find((entry) => entry.name === '@xdlg93/dsh-im');
if (!plugin) throw new Error('docs/index.json has no @xdlg93/dsh-im entry');

let fixed = 0;
let dropped = 0;
for (const version of plugin.versions) {
  const name = typeof version.tgz === 'string' ? version.tgz.split('/').pop() : null;
  const path = name ? join(root, 'docs', 'pkg', name) : null;
  if (!path || !existsSync(path)) {
    if (version.tgz !== undefined || version.tgzSha256 !== undefined) {
      delete version.tgz;
      delete version.tgzSha256;
      dropped += 1;
    }
    continue;
  }
  const digest = createHash('sha256').update(await readFile(path)).digest('hex');
  if (version.tgzSha256 !== digest) {
    version.tgzSha256 = digest;
    fixed += 1;
  }
}
await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
console.log(`digests fixed: ${fixed}; tgz links dropped: ${dropped}`);
