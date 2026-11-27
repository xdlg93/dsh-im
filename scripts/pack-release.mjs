// Pack the publishable tarball into docs/pkg/, where GitHub Pages serves it.
//
// The plugin index installs from git, which needs github.com reachable. A user
// whose network blocks it can install the same release from this tarball URL
// instead, so every release leaves one behind.
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const target = join(root, 'docs', 'pkg');
await mkdir(target, { recursive: true });
// Older release tarballs stay: the index keeps every version's download link, and
// a missing file would turn those links into 404s. Each one is ~1.6 MB.

execFileSync('pnpm', ['pack', '--pack-destination', target], { cwd: root, stdio: 'inherit' });
// `pnpm pack` names its output after the package; look for exactly that file
// instead of "any tarball in the directory", which would pick an older release
// and rename it over the new one.
const produced = `xdlg93-dsh-im-${manifest.version}.tgz`;
const packed = (await readdir(target)).includes(produced)
  ? produced
  : (await readdir(target)).find((name) => name.endsWith('.tgz'));
if (!packed) throw new Error('pnpm pack produced no tarball');
const wanted = `dsh-im-${manifest.version}.tgz`;
if (packed !== wanted) await rename(join(target, packed), join(target, wanted));
console.log(`Wrote docs/pkg/${wanted}`);
console.log(`https://xdlg93.github.io/dsh-im/pkg/${wanted}`);
