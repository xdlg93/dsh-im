// Verify the publishable package: the built bundles, the bundle patch, the
// manifest, and the runtime contract the Host exposes to the client.
//
// This fork ships WeChat and QQ only, so the script also guards that no removed
// channel creeps back into the built artifacts.
import { access, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const PACKAGE_NAME = '@xdlg93/dsh-im';
const ENTRY_ID = 'xdlg93-dsh-im';

const required = [
  'lib/index.js',
  'lib/client.js',
  'bin/dsh-im.mjs',
  'cordis.patch.yml',
  'README.md',
  'README.en.md',
  'PROACTIVE_DELIVERY.md',
  'PROACTIVE_DELIVERY.en.md',
  'THIRD_PARTY_NOTICES.md',
  'locale/zh.json',
  'locale/en.json',
  // Host entry and the two shipped channels.
  'plugin-src/host/index.mjs',
  'plugin-src/host/channels/weixin/index.mjs',
  'plugin-src/host/channels/qq/index.mjs',
  // Client entry and the two shipped channel panels.
  'plugin-src/client/index.js',
  'plugin-src/client/channels/weixin/index.js',
  'plugin-src/client/channels/qq/index.js',
  'plugin-src/client/i18n.js',
  'plugin-src/client/update-panel.js',
  'plugin-src/client/context-enhancement.js',
  // Shared runtime the two channels depend on.
  'src/channels/weixin/weixin-runtime.mjs',
  'src/channels/qq/qq-runtime.mjs',
  'src/channels/shared/context-enhancement.mjs',
  'src/channels/shared/channel-capabilities.mjs',
];
await Promise.all(required.map((path) => access(resolve(root, path))));

const [client, host, patch, manifestText, hostSource, clientEntrySource, clientI18n, executable] = await Promise.all([
  readFile(resolve(root, 'lib/client.js'), 'utf8'),
  readFile(resolve(root, 'lib/index.js'), 'utf8'),
  readFile(resolve(root, 'cordis.patch.yml'), 'utf8'),
  readFile(resolve(root, 'package.json'), 'utf8'),
  readFile(resolve(root, 'plugin-src/host/index.mjs'), 'utf8'),
  readFile(resolve(root, 'plugin-src/client/index.js'), 'utf8'),
  readFile(resolve(root, 'plugin-src/client/i18n.js'), 'utf8'),
  stat(resolve(root, 'bin/dsh-im.mjs')),
]);
const manifest = JSON.parse(manifestText);

// DSH runtime packages use module-local Symbol keys, so a second physical copy
// breaks Host lookup. They must come from the running Host only.
for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
  for (const name of Object.keys(manifest[section] ?? {})) {
    if (/^@deepseek-ai\/dsh-/u.test(name)) {
      throw new Error(`${name} must not be declared in ${section}; DSH runtime packages come from the host`);
    }
  }
}

// Identity and compatibility.
if (manifest.name !== PACKAGE_NAME) {
  throw new Error(`package.json must be named ${PACKAGE_NAME}, found ${manifest.name}`);
}
if (manifest.repository?.url !== `git+https://github.com/xdlg93/dsh-im.git`) {
  throw new Error('package.json must point repository at github.com/xdlg93/dsh-im');
}
if (typeof manifest.engines?.dsh !== 'string' || manifest.engines.dsh.trim() === '') {
  throw new Error('package.json must declare engines.dsh; DSH uses it to gate installation');
}
const compatibility = manifest.dsh?.compatibility ?? {};
if (typeof compatibility.dsh !== 'string'
  || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(compatibility.dsh)
  || compatibility.dshReleases?.[compatibility.dsh] !== 'compatible') {
  throw new Error('dsh.compatibility.dsh must name a release that dshReleases marks compatible');
}
const { satisfies } = await import('semver');
for (const accepted of ['0.2.2-rc.5', '0.2.2', '0.2.9']) {
  if (!satisfies(accepted, manifest.engines.dsh, { includePrerelease: true })) {
    throw new Error(`engines.dsh must accept DSH ${accepted}`);
  }
}
for (const rejected of ['0.2.2-rc.4', '0.2.1', '0.3.0']) {
  if (satisfies(rejected, manifest.engines.dsh, { includePrerelease: true })) {
    throw new Error(`engines.dsh must not accept DSH ${rejected}`);
  }
}

// Client inject list: DSH client rows the settings panel renders into.
const clientInject = manifest.dsh?.client?.inject ?? [];
if (clientInject.length === 0 || new Set(clientInject).size !== clientInject.length) {
  throw new Error('dsh.client.inject must list unique DSH client packages');
}
for (const name of clientInject) {
  if (!/^@deepseek-ai\/dsh-client-[a-z0-9-]+$/u.test(name)) {
    throw new Error(`dsh.client.inject must name DSH client packages: ${name}`);
  }
}
for (const retired of ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-slots']) {
  if (clientInject.includes(retired)) {
    throw new Error(`${retired} is not a loadable DSH client row`);
  }
}

// Bundle patch: exactly one entry, our own package.
if (!patch.includes(`- id: ${ENTRY_ID}`) || !patch.includes(`name: '${PACKAGE_NAME}'`)) {
  throw new Error(`cordis.patch.yml must insert ${ENTRY_ID} / ${PACKAGE_NAME}`);
}

// Client bundle: the module loader id and the single localized settings section.
if (!new RegExp(`\\bid\\s*:\\s*["']${PACKAGE_NAME.replace('/', '\\/')}["']`, 'u').test(client)) {
  throw new Error('client bundle does not register the dsh-im loader id');
}
if (!/IM_LOCALE_NAMESPACE\s*=\s*["']dsh-im["']/u.test(clientI18n)) {
  throw new Error('client entry must keep the shared dsh-im locale namespace');
}
const sectionMarkers = [
  /ctx\.slots\.inject\(\s*["']settings\.section["']/u,
  new RegExp(`id\\s*:\\s*["']${ENTRY_ID}["']`, 'u'),
  /order\s*:\s*21\b/u,
  /label\s*:\s*\(\)\s*=>\s*t\(\s*["']IM机器人["']\s*\)/u,
];
if (sectionMarkers.some((pattern) => !pattern.test(clientEntrySource))) {
  throw new Error('client entry must register the localized top-level IM settings section');
}
if ((client.match(/\.slots\.inject\(\s*["']settings\.section["']/gu) ?? []).length !== 1) {
  throw new Error('client bundle must register exactly one top-level settings section');
}

// Only the two shipped channels may appear in the settings rail.
const clientChannels = clientEntrySource.match(/const CHANNELS = Object\.freeze\(\[([\s\S]*?)\]\);/u)?.[1] ?? '';
if (!clientChannels) throw new Error('client entry no longer declares its channel list');
for (const id of ['weixin', 'qq']) {
  if (!new RegExp(`id:\\s*['"]${id}['"]`, 'u').test(clientChannels)) {
    throw new Error(`client channel list is missing ${id}`);
  }
}

// Host: only the two channels mount, and both RPC providers exist.
for (const channel of ['weixin', 'qq']) {
  if (!new RegExp(`\\['${channel}', start`, 'u').test(hostSource)) {
    throw new Error(`host entry does not mount the ${channel} channel`);
  }
  if (!host.includes(`/${channel}`)) {
    throw new Error(`host bundle does not contain the internal /${channel} RPC provider`);
  }
}
if ((hostSource.match(/\['[a-zA-Z-]+', start[A-Z][A-Za-z]*\]/gu) ?? []).length !== 2) {
  throw new Error('host entry must mount exactly two channels');
}

// Removed channels must not survive anywhere in the shipped artifacts.
// The client is the visible surface: no removed channel may remain there at
// all. The Host keeps a few shared tables that still name retired channels in
// defensive branches, so it is checked at the route level instead — a removed
// channel must not register an RPC route.
const removedChannel = /['"](?:feishu|wecom|wecom-app|dingtalk|telegram|whatsapp|slack|discord|matrix|imessage|email|office)['"]/iu;
const foundInClient = removedChannel.exec(client);
if (foundInClient) {
  throw new Error(`client bundle still addresses the removed ${foundInClient[0]} channel`);
}
for (const route of ['/feishu', '/wecom', '/dingtalk', '/telegram', '/whatsapp', '/slack', '/discord', '/matrix', '/imessage', '/email', '/office']) {
  if (host.includes(route)) {
    throw new Error(`host bundle still registers the removed ${route} RPC route`);
  }
}
for (const marker of ['update.status', 'update.check', 'update.install', 'https://registry.npmjs.org/']) {
  if (!host.includes(marker)) {
    throw new Error(`host bundle is missing the updater marker: ${marker}`);
  }
}
for (const marker of ['bot.context-enhancement.set', '<dsh_im_source>']) {
  if (!host.includes(marker) || !client.includes(marker)) {
    throw new Error(`context-enhancement marker missing from Host or Client bundle: ${marker}`);
  }
}

// Manifest surface.
if (manifest.bin?.['dsh-im'] !== 'bin/dsh-im.mjs') {
  throw new Error('package manifest must publish the dsh-im executable');
}
if (!/(?:from\s*|import\s*\()\s*["']undici["']/.test(host)) {
  throw new Error('host bundle must retain undici as an external runtime dependency');
}
if (process.platform !== 'win32' && (executable.mode & 0o111) === 0) {
  throw new Error('dsh-im CLI is not executable');
}
if (/private-bot-token|must-be-rolled-back|DEEPSEEK_API_KEY=/.test(client + host)) {
  throw new Error('built artifacts contain a test or environment secret marker');
}

// Runtime contract: the Host publishes dshIm with the delivery surface the
// client and the desktop panel rely on. Channels are never started here.
const { createImHostPlugin } = await import(pathToFileURL(resolve(root, 'lib/index.js')).href);
let deliveryApi;
await createImHostPlugin().apply({
  provide(name, service) {
    if (name === 'dshIm') deliveryApi = service;
  },
  inject() {},
});
if (typeof deliveryApi?.createTarget !== 'function') {
  throw new Error('host bundle must expose dshIm.createTarget; rebuild before publishing');
}

console.log('Verified dsh-im package artifacts.');
