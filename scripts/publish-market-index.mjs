// Write docs/index.json, the format-1 plugin-market index this repository
// publishes through GitHub Pages (branch publishing serves docs/ as the site root).
//
// The release flow is: commit and push the release, then run this script with
// that commit so the index pins the exact source it advertises, then commit the
// index itself.
//
//   node scripts/publish-market-index.mjs [--commit <sha>] [--dry-run]
//
// Without --commit the script uses HEAD.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const commitFlag = args.indexOf('--commit');
const requestedCommit = commitFlag === -1 ? undefined : args[commitFlag + 1];

const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const commit = requestedCommit
  ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (!/^[0-9a-f]{40}$/u.test(commit)) {
  throw new Error(`--commit must be a full 40-character commit SHA, got ${commit}`);
}
const publishTimestamp = Math.floor(Date.now() / 1000);
const indexPath = resolve(root, 'docs/index.json');

let existing;
try {
  existing = JSON.parse(await readFile(indexPath, 'utf8'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const versions = [...(existing?.plugins?.[0]?.versions ?? [])]
  .filter((entry) => entry.version !== manifest.version);
versions.push({
  version: manifest.version,
  publishTimestamp,
  source: {
    type: 'git',
    url: 'https://github.com/xdlg93/dsh-im',
    commit,
  },
  engines: { dsh: manifest.engines.dsh },
  // Not part of format 1: the market drops it, and this plugin's own updater
  // reads it as the fallback channel when git cannot reach github.com.
  tgz: `https://xdlg93.github.io/dsh-im/pkg/dsh-im-${manifest.version}.tgz`,
});
// The market requires versions in descending SemVer precedence; a plain reverse
// string sort is enough here because every entry shares the same shape.
versions.sort((left, right) => (left.version === right.version
  ? 0
  : (left.version > right.version ? -1 : 1)));

const index = {
  format: 1,
  title: {
    en: 'DSH IM bots',
    zh: 'DSH IM 机器人',
  },
  description: {
    en: 'Connect WeChat and QQ to DeepSeek Harness through QR-code login.',
    zh: '通过扫码把微信、QQ 接入 DeepSeek Harness。',
  },
  metadata: {
    keywords: ['dsh', 'dsh-plugin', 'im', 'wechat', 'weixin', 'qq'],
  },
  plugins: [
    {
      name: manifest.name,
      title: {
        en: 'DSH IM bots (WeChat + QQ)',
        zh: 'DSH IM 机器人（微信 + QQ）',
      },
      description: {
        en: 'Connect WeChat and QQ to DeepSeek Harness with QR-code login: bind from the settings page, then chat, apply group/direct policies, enrich context, push proactive messages, and bind Sessions to workspaces.',
        zh: '把微信、QQ 扫码接入 DeepSeek Harness：设置页扫码绑定，机器人收发消息、群聊与私聊策略、上下文增强、主动推送、会话同步与工作区绑定。',
      },
      icon: 'icons/dsh-im.png',
      author: 'xdlg93',
      homepage: 'https://github.com/xdlg93/dsh-im#readme',
      repository: { url: 'https://github.com/xdlg93/dsh-im' },
      metadata: { keywords: manifest.keywords },
      versions,
    },
  ],
};

const text = `${JSON.stringify(index, null, 2)}\n`;
if (dryRun) {
  process.stdout.write(text);
} else {
  await writeFile(indexPath, text, 'utf8');
  console.log(`Wrote docs/index.json with ${manifest.name}@${manifest.version} at ${commit}.`);
}
