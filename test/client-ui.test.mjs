import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

import { transform } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TestRenderer from 'react-test-renderer';

import {
  apply as applyClient,
  IM_PLUGIN_VERSION,
  IMSettingsTab,
  inject as clientInject,
} from '../plugin-src/client/index.js';
import { CredentialBindingPanel } from '../plugin-src/client/credential-binding.js';
import { ChannelListHeading } from '../plugin-src/client/channel-card-meta.js';
import { installImStyles } from '../plugin-src/client/styles.js';
import {
  AccountCard as WeixinAccountCard,
  WeixinSettingsTab,
} from '../plugin-src/client/channels/weixin/index.js';
import {
  AccountCard as QqAccountCard,
  QqSettingsTab,
} from '../plugin-src/client/channels/qq/index.js';
import {
  en,
  IM_LOCALE_NAMESPACE,
  localizeText,
  setImTranslator,
  zh,
} from '../plugin-src/client/i18n.js';
import {
  GLOBAL_SETTINGS_RPC_CHANNEL,
  GlobalSettingsPanel,
} from '../plugin-src/client/global-settings.js';
import {
  HOST_LANGUAGE_ENDPOINTS,
  HOST_LANGUAGE_RPC_CHANNEL,
} from '../plugin-src/client/interface-language.js';

const STYLES_URL = new URL('../plugin-src/client/styles.js', import.meta.url);
const WEIXIN_STYLES_URL = new URL(
  '../plugin-src/client/channels/weixin/styles.js',
  import.meta.url,
);
const QQ_STYLES_URL = new URL(
  '../plugin-src/client/channels/qq/styles.js',
  import.meta.url,
);
const WEIXIN_SOURCE_URL = new URL(
  '../plugin-src/client/channels/weixin/index.js',
  import.meta.url,
);
const QQ_SOURCE_URL = new URL(
  '../plugin-src/client/channels/qq/index.js',
  import.meta.url,
);
const CLIENT_BUNDLE_URL = new URL('../lib/client.js', import.meta.url);
const CLIENT_SOURCE_DIRECTORY_URL = new URL('../plugin-src/client/', import.meta.url);

const { act, create } = TestRenderer;

async function flushMicrotasks() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

// Drains every pending microtask and timer callback, like the Feishu channel
// tests use, so multi-hop save chains settle before assertions.
const flushTasks = () => new Promise((resolve) => setImmediate(resolve));

function nodeText(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node) return '';
  const children = Array.isArray(node) ? node : node.children;
  return Array.isArray(children) ? children.map(nodeText).join('') : nodeText(children);
}

function findButton(renderer, label) {
  const button = renderer.root.findAllByType('button')
    .find((candidate) => nodeText(candidate) === label);
  assert.ok(button, `missing button: ${label}`);
  return button;
}

test('removing the first account preserves collapse styles and toggling for remaining accounts', () => {
  const previousDocument = globalThis.document;
  const styles = new Set();
  globalThis.document = {
    querySelector: (selector) => [...styles].find((style) =>
      selector === `style[data-plugin-css="${style.dataset.pluginCss}"]`) ?? null,
    createElement: () => {
      const style = { dataset: {}, textContent: '', remove: () => styles.delete(style) };
      return style;
    },
    head: { appendChild: (style) => styles.add(style) },
  };
  const cards = (ids) => React.createElement(React.Fragment, null, ids.map((botId) =>
    React.createElement(QqAccountCard, {
      key: botId,
      account: {
        botId, connected: true, state: 'connected',
        bot: { name: botId, appIdMasked: '123••456' },
        health: { summary: 'Connected', lastCheckedAt: null },
      },
    })));
  const collapseStyles = () => [...styles].find((style) =>
    style.textContent.includes('.dim-collapsibleAccount:not(.is-open)'));
  let renderer;
  let disposeStyles;
  try {
    disposeStyles = installImStyles();
    act(() => { renderer = create(cards(['first', 'second'])); });
    const stylesheet = collapseStyles();
    assert.ok(stylesheet);

    act(() => renderer.update(cards(['second'])));
    assert.equal(collapseStyles(), stylesheet, 'remaining cards still need the shared collapse CSS');
    const header = () => renderer.root.findByProps({ className: 'dim-collapsibleHead' });
    const toggle = () => renderer.root.findByProps({ className: 'dim-accountSettingsToggle' });
    assert.equal(toggle().props['aria-expanded'], 'false');
    act(() => header().props.onClick());
    assert.equal(toggle().props['aria-expanded'], 'true');
    act(() => toggle().props.onClick({ stopPropagation() {} }));
    assert.equal(toggle().props['aria-expanded'], 'false');

    act(() => renderer.unmount());
    disposeStyles();
    assert.equal(styles.size, 0, 'disposing the settings styles still cleans up the document');
  } finally {
    act(() => renderer?.unmount());
    disposeStyles?.();
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('the general settings gear sits to the right of GitHub and outside the channel rail', () => {
  const markup = renderToStaticMarkup(React.createElement(IMSettingsTab, {
    globalSettingsRpcCall: async () => ({ ok: true, value: { ttlHours: 0 } }),
    weixinRpcCall: async () => ({ ok: true, value: {} }),
  }));

  assert.match(markup, /id="dim-general-settings-trigger"/);
  assert.match(markup, /aria-controls="dim-panel-global-settings"/);
  assert.match(markup, /class="dim-generalSettingsAction"/);
  assert.match(markup, /data-im-icon="global-settings"/);
  assert.ok(markup.indexOf('dim-githubAction') < markup.indexOf('dim-generalSettingsAction'));
  assert.ok(markup.indexOf('dim-generalSettingsAction') < markup.indexOf('dim-layout'));
  assert.doesNotMatch(markup, /id="dim-tab-global-settings"/);
  assert.doesNotMatch(markup, /dim-channelGlobal|dim-logoGlobal/);
  assert.match(markup, /aria-label="IM 设置导航"/);
  // The general panel only mounts once its header action is selected; the
  // action must not steal the initial selection from the first channel.
  assert.doesNotMatch(markup, /id="dim-panel-global-settings"/);
});

test('general settings defaults to group history and keeps Attachments and Delivery tabs', () => {
  const markup = renderToStaticMarkup(React.createElement(GlobalSettingsPanel, { rpcCall: async () => ({}) }));
  assert.match(markup, /<h2>通用设置<\/h2>/);
  assert.match(markup, /id="dim-general-settings-tab-general"[^>]*aria-selected="true"/);
  assert.match(markup, /id="dim-general-settings-tab-attachments"[^>]*aria-selected="false"/);
  assert.match(markup, /id="dim-general-settings-tab-delivery"[^>]*aria-selected="false"/);
  assert.equal((markup.match(/role="tab"/g) ?? []).length, 3);
  assert.match(markup, /群聊天记录保留天数/);
  assert.match(markup, /value="14"/);
  assert.match(markup, /正在读取群记录设置/);
});

test('the sweep action opens a separate confirmation popover and supports cancel', async () => {
  const calls = [];
  const rpcCall = async (endpoint, payload) => {
    calls.push({ endpoint, payload });
    if (endpoint === 'settings.inbound-ttl.get') return { ok: true, value: { ttlHours: 24 } };
    if (endpoint === 'settings.inbound-ttl.sweep') {
      return { ok: true, value: { deletedDirectories: 2, sweptWorkspaces: 5 } };
    }
    throw new Error(`unexpected endpoint: ${endpoint}`);
  };

  let renderer;
  await act(async () => {
    renderer = create(React.createElement(GlobalSettingsPanel, { rpcCall }));
    await flushMicrotasks();
  });
  await act(async () => {
    findButton(renderer, '附件').props.onClick();
    await flushMicrotasks();
  });

  await act(async () => {
    findButton(renderer, '清理过期附件').props.onClick();
  });
  const trigger = findButton(renderer, '清理过期附件');
  const confirmButton = findButton(renderer, '确认清理');
  const confirmDialog = renderer.root.findByProps({ role: 'alertdialog' });
  assert.equal(nodeText(trigger), '清理过期附件');
  assert.equal(trigger.props['aria-expanded'], true);
  assert.equal(confirmButton.props['data-kind'], 'danger');
  assert.equal(confirmDialog.props['aria-label'], '确认清理过期附件');
  assert.match(nodeText(confirmDialog), /确认清理当前已过期的附件？取消确认清理/);

  // Cancel closes the popover without running the sweep.
  await act(async () => {
    findButton(renderer, '取消').props.onClick();
  });
  assert.equal(renderer.root.findAllByProps({ role: 'alertdialog' }).length, 0);
  assert.equal(findButton(renderer, '清理过期附件').props['aria-expanded'], false);
  assert.equal(calls.filter((call) => call.endpoint === 'settings.inbound-ttl.sweep').length, 0);

  await act(async () => {
    findButton(renderer, '清理过期附件').props.onClick();
  });

  // Confirming still runs the sweep RPC, silently and without result text.
  await act(async () => {
    findButton(renderer, '确认清理').props.onClick();
    await flushMicrotasks();
  });
  assert.equal(calls.filter((call) => call.endpoint === 'settings.inbound-ttl.sweep').length, 1);
  assert.deepEqual(
    renderer.root.findAllByProps({ className: 'dim-globalFeedback' }),
    [],
  );
  assert.ok(findButton(renderer, '清理过期附件'));
  act(() => renderer.unmount());
});

test('the TTL input saves explicitly, preserves invalid text for correction, and disables save when unchanged', async () => {
  const calls = [];
  const rpcCall = async (endpoint, payload) => {
    calls.push({ endpoint, payload });
    if (endpoint === 'settings.inbound-ttl.get') return { ok: true, value: { ttlHours: 24 } };
    if (endpoint === 'settings.inbound-ttl.set') {
      return { ok: true, value: { ttlHours: payload.ttlHours } };
    }
    throw new Error(`unexpected endpoint: ${endpoint}`);
  };

  let renderer;
  await act(async () => {
    renderer = create(React.createElement(GlobalSettingsPanel, { rpcCall }));
    await flushMicrotasks();
  });
  await act(async () => {
    findButton(renderer, '附件').props.onClick();
    await flushMicrotasks();
  });
  const input = () => renderer.root.findByProps({ id: 'dim-globalTtlInput' });
  const form = () => renderer.root.findAllByType('form').find((form) => form.props.className === 'dim-globalTtlRow');
  const saveButton = () => findButton(renderer, '保存');
  const inlineNote = () => renderer.root.findAllByProps({ className: 'dim-globalInline' })
    .at(-1);
  assert.equal(input().props.value, '24');
  assert.equal(input().props.disabled, false);
  assert.equal(saveButton().props.disabled, true);

  // A valid changed value is not persisted until the user explicitly saves.
  await act(async () => {
    input().props.onChange({ target: { value: '48' } });
  });
  await act(async () => {
    input().props.onBlur();
  });
  assert.equal(calls.filter((call) => call.endpoint === 'settings.inbound-ttl.set').length, 0);
  assert.equal(saveButton().props.disabled, false);
  await act(async () => {
    form().props.onSubmit({ preventDefault() {} });
    await flushMicrotasks();
  });
  assert.deepEqual(calls.at(-1), { endpoint: 'settings.inbound-ttl.set', payload: { ttlHours: 48 } });
  assert.equal(input().props.value, '48');
  assert.equal(nodeText(inlineNote()), '已保存');
  assert.equal(saveButton().props.disabled, true);

  // Invalid input stays available for correction and cannot be submitted.
  await act(async () => {
    input().props.onChange({ target: { value: 'abc' } });
  });
  await act(async () => {
    input().props.onBlur();
    await flushMicrotasks();
  });
  assert.equal(calls.filter((call) => call.endpoint === 'settings.inbound-ttl.set').length, 1);
  assert.equal(input().props.value, 'abc');
  assert.equal(input().props['aria-invalid'], 'true');
  assert.equal(saveButton().props.disabled, true);
  assert.equal(nodeText(inlineNote()), '请输入 -1、0 或 1~8760 之间的整数。');

  // Restoring the saved value clears the error and keeps Save disabled.
  await act(async () => {
    input().props.onChange({ target: { value: '48' } });
  });
  await act(async () => {
    input().props.onBlur();
    await flushMicrotasks();
  });
  assert.equal(calls.filter((call) => call.endpoint === 'settings.inbound-ttl.set').length, 1);
  assert.equal(input().props['aria-invalid'], undefined);
  assert.equal(saveButton().props.disabled, true);
  act(() => renderer.unmount());
});

test('a failed explicit save keeps the input enabled with the error inline', async () => {
  const rpcCall = async (endpoint) => {
    if (endpoint === 'settings.inbound-ttl.get') return { ok: true, value: { ttlHours: 24 } };
    if (endpoint === 'settings.inbound-ttl.set') {
      return { ok: false, error: { code: 'store-unavailable', message: '无法写入设置存储。' } };
    }
    throw new Error(`unexpected endpoint: ${endpoint}`);
  };

  let renderer;
  await act(async () => {
    renderer = create(React.createElement(GlobalSettingsPanel, { rpcCall }));
    await flushMicrotasks();
  });
  await act(async () => {
    findButton(renderer, '附件').props.onClick();
    await flushMicrotasks();
  });
  const input = () => renderer.root.findByProps({ id: 'dim-globalTtlInput' });
  const form = () => renderer.root.findAllByType('form').find((form) => form.props.className === 'dim-globalTtlRow');

  await act(async () => {
    input().props.onChange({ target: { value: '72' } });
  });
  await act(async () => {
    form().props.onSubmit({ preventDefault() {} });
    await flushMicrotasks();
  });
  assert.equal(input().props.disabled, false);
  assert.equal(input().props.value, '72');
  const note = renderer.root.findAllByProps({ className: 'dim-globalInline' }).at(-1);
  assert.equal(nodeText(note), '无法写入设置存储。');
  assert.equal(note.props.role, 'alert');
  act(() => renderer.unmount());
});

test('all channel styles use the current Harness theme tokens', async () => {
  const styles = (await Promise.all([
    readFile(STYLES_URL, 'utf8'),
    readFile(WEIXIN_STYLES_URL, 'utf8'),
    readFile(QQ_STYLES_URL, 'utf8'),
  ])).join('\n');

  assert.doesNotMatch(
    styles,
    /--dsw-alias-(?:bg-body|line-border|line-divider|fill-secondary|fill-tertiary|state-warning-primary)/,
  );
  assert.match(styles, /--dsw-alias-bg-layer-1/);
  assert.match(styles, /--dsw-alias-bg-module-platform/);
  assert.match(styles, /--dsw-alias-interactive-bg-hover/);
  assert.match(styles, /--dsw-alias-border-l1/);
  assert.match(styles, /--dsw-alias-border-l2/);
  assert.match(styles, /--dim-blue: var\(--dsw-alias-state-business-primary, #3370ff\)/);
  assert.match(
    styles,
    /\.dim-channel\[aria-selected="true"\][^}]*var\(--dsw-alias-bg-layer-3/,
  );
  assert.match(
    styles,
    /\.dim-panel \.dim-qrExpired[^}]*--dsw-static-neutral-bluish-1000/,
  );
});

test('shared QR cards stay square and stack within the narrow combined-channel panel', async () => {
  const styles = await readFile(STYLES_URL, 'utf8');
  assert.match(styles, /\.dim-panel \{ min-width: 0; container-type: inline-size; \}/);
  assert.match(styles, /\.dim-panel \.dim-qrFrame \{[^}]*width: min\(270px, 100%\);[^}]*height: auto;[^}]*aspect-ratio: 1;/);
  assert.match(
    styles,
    /@container \(max-width: 680px\)[\s\S]*\.dim-panel \.ddt-qrLayout \{ grid-template-columns: minmax\(0, 1fr\); justify-items: center;/,
  );
  assert.match(styles, /\.dim-panel \.ddt-qrFrame, \.dim-panel \.ddt-countdown \{ width: min\(270px, 100%\); \}/);
  assert.match(styles, /\.dim-panel \.ddt-qrColumn \{ width: 100%; min-width: 0; \}/);
  assert.match(styles, /\.dim-panel \.ddt-qrCopy \{ width: 100%; min-width: 0; overflow-wrap: anywhere; \}/);
});

test('credential form stays compact while using a protected password input', () => {
  const markup = renderToStaticMarkup(React.createElement(CredentialBindingPanel, {
    channel: '企业微信',
    identityLabel: 'Bot ID',
    identityPlaceholder: '填写 Bot ID',
    secretLabel: 'Secret',
    secretPlaceholder: '填写 Secret',
    onSubmit() {},
    onCancel() {},
  }));
  assert.match(markup, />Bot ID</);
  assert.match(markup, /type="password"/);
  assert.match(markup, /autoComplete="new-password"/i);
  assert.match(markup, />手动接入企业微信机器人</);
  assert.doesNotMatch(markup, /已有机器人应用|Harness 会校验凭据|可见范围|受保护的凭据存储/);
  assert.doesNotMatch(markup, /value="[^"]+"/);
});

test('scan actions align left while online totals align right in every channel', async () => {
  const [imStyles, weixinStyles, qqStyles, weixinSource, qqSource] = await Promise.all([
    readFile(STYLES_URL, 'utf8'),
    readFile(WEIXIN_STYLES_URL, 'utf8'),
    readFile(QQ_STYLES_URL, 'utf8'),
    readFile(WEIXIN_SOURCE_URL, 'utf8'),
    readFile(QQ_SOURCE_URL, 'utf8'),
  ]);

  assert.match(imStyles, /\.dim-panel \.dxw-tools, \.dim-panel \.ddt-tools \{[^}]*display: grid;[^}]*grid-template-columns: minmax\(0, 1fr\) max-content;[^}]*justify-content: stretch;/);
  assert.match(imStyles, /\.dim-panel \.dim-bindActions > button \{[^}]*min-width: 0;/);
  assert.match(imStyles, /\.dim-panel \.dxw-tools \.dim-scanButton, \.dim-panel \.ddt-tools \.dim-scanButton \{[^}]*justify-self: start;/);
  assert.match(imStyles, /\.dim-panel \.dxw-tools \.dim-onlineBadge, \.dim-panel \.ddt-tools \.dim-onlineBadge \{[^}]*justify-self: end;/);
  assert.match(weixinStyles, /\.dxw-tools \{[^}]*justify-content: space-between;/);
  assert.match(qqStyles, /\.dqq-page/);

  const headingSource = (source) => source.slice(
    source.indexOf('function Heading'),
    source.indexOf('function LoadingView'),
  );
  const weixinHeading = headingSource(weixinSource);
  const qqHeading = headingSource(qqSource);
  assert.ok(weixinHeading.indexOf('扫码接入机器人') < weixinHeading.indexOf('dxw-badge'));
  assert.ok(qqHeading.indexOf('扫码接入机器人') < qqHeading.indexOf('ddt-badge'));

  for (const heading of [weixinHeading, qqHeading]) {
    assert.match(heading, /dim-scanButton/);
    assert.match(heading, /dim-onlineBadge/);
  }
  assert.doesNotMatch(weixinHeading, /dxw-dot/);
  assert.match(imStyles, /\.dim-panel \.dxw-tools \.dim-scanButton, \.dim-panel \.ddt-tools \.dim-scanButton \{[^}]*border: 1px solid #1677ff;[^}]*border-radius: 8px;[^}]*background: #1677ff;[^}]*box-shadow: none;/);
  assert.match(imStyles, /\.dim-panel \.dxw-tools \.dim-onlineBadge, \.dim-panel \.ddt-tools \.dim-onlineBadge \{[^}]*border-radius: 999px;[^}]*background: var\(--dsw-alias-bg-module-platform, #f2f3f5\);[^}]*font-size: 12px;/);
});

test('channel connection details live in an accessible heading tooltip', async () => {
  const styles = await readFile(STYLES_URL, 'utf8');
  const markup = renderToStaticMarkup(React.createElement(ChannelListHeading, {
    className: 'dxw-listHeading',
    title: '已接入的微信账号',
    connectionLabel: 'iLink 长轮询',
  }));

  assert.match(markup, /<h3>已接入的微信账号<\/h3>/);
  assert.match(markup, /aria-label="查看消息通道说明"/);
  assert.match(markup, /role="tooltip"><span>消息通道<\/span><strong>iLink 长轮询<\/strong>/);
  assert.match(styles, /\.dim-panel \.dim-channelHelp:hover \.dim-channelTooltip, \.dim-panel \.dim-channelHelp:focus-within \.dim-channelTooltip \{[^}]*opacity: 1;[^}]*visibility: visible;/);
});

test('all channel settings states use the shared page treatment', async () => {
  const [styles, weixinSource, qqSource] = await Promise.all([
    readFile(STYLES_URL, 'utf8'),
    readFile(WEIXIN_SOURCE_URL, 'utf8'),
    readFile(QQ_SOURCE_URL, 'utf8'),
  ]);

  for (const Component of [WeixinSettingsTab, QqSettingsTab]) {
    const markup = renderToStaticMarkup(React.createElement(Component, {
      rpcCall: async () => ({ ok: true, value: {} }),
    }));
    assert.match(markup, /dim-channelPage/);
    assert.match(markup, /dim-surfaceCard dim-loadingView/);
    assert.match(markup, /dim-spinner/);
  }

  for (const source of [weixinSource, qqSource]) {
    for (const className of [
      'dim-channelPage',
      'dim-surfaceCard',
      'dim-loadingView',
      'dim-emptyView',
      'dim-qrLayout',
      'dim-inlineError',
      'dim-confirm',
    ]) {
      assert.match(source, new RegExp(className));
    }
  }

  assert.match(styles, /\.dim-panel \.dim-channelPage \{[^}]*flex-direction: column;[^}]*gap: 12px;/);
  assert.match(styles, /\.dim-panel \.dim-listHeading \{[^}]*margin: 0 0 6px;/);
  assert.match(styles, /\.dim-panel \.dim-botList \{[^}]*gap: 8px;/);
  assert.match(styles, /\.dim-panel \.dim-surfaceCard \{[^}]*border-radius: 14px;[^}]*box-shadow: 0 1px 2px/);
  assert.match(styles, /\.dim-panel \.dim-loadingView \{[^}]*padding: 38px;[^}]*text-align: center;/);
  assert.match(styles, /\.dim-panel \.dim-emptyView \{[^}]*grid-template-columns: minmax\(0, 1fr\) 180px;[^}]*gap: 30px;/);
  assert.match(styles, /\.dim-panel \.dim-qrLayout \{[^}]*grid-template-columns: 300px minmax\(0, 1fr\);[^}]*gap: 34px;[^}]*align-items: start;/);
  assert.match(styles, /\.dim-panel \.dim-viewActions \.dxw-button, \.dim-panel \.dim-viewActions \.ddt-button \{[^}]*min-height: 34px;[^}]*border-radius: 8px;[^}]*font-size: 13px;/);
  assert.match(styles, /\.dim-panel \.dim-inlineError \{[^}]*padding: 22px;[^}]*background:/);
  assert.match(styles, /\.dim-panel \.dim-confirm \{[^}]*padding: 18px 24px;[^}]*border-top: 1px solid/);
});

test('bot card status stays in the top-right corner at every responsive breakpoint', async () => {
  const styles = await readFile(STYLES_URL, 'utf8');

  assert.match(styles, /\.dim-panel \.dim-botCardTop \{[^}]*display: flex;[^}]*align-items: flex-start;[^}]*justify-content: space-between;/);
  assert.match(styles, /\.dim-panel \.dim-botIdentity \{[^}]*min-width: 0;[^}]*flex: 1 1 0;/);
  assert.match(styles, /\.dim-panel \.dim-botHealthGroup \{[^}]*flex: none;[^}]*justify-items: end;/);
  assert.doesNotMatch(styles, /\.dim-panel \.dim-botCardTop \{ flex-direction: column;/);
  assert.doesNotMatch(styles, /\.dim-panel \.dim-botHealthGroup \{ justify-items: start;/);
});

test('bot cards wrap full workspace paths without horizontal scrolling', async () => {
  const styles = await readFile(STYLES_URL, 'utf8');

  assert.match(styles, /\.dim-panel \.dim-workspace \{[^}]*grid-template-columns: minmax\(0, 1fr\) max-content;[^}]*row-gap: 4px;[^}]*margin-top: 6px;[^}]*padding: 6px 10px;/);
  assert.match(styles, /\.dim-panel \.dim-workspaceHeader \{[^}]*display: contents;/);
  assert.match(styles, /\.dim-panel \.dim-workspacePath \{[^}]*grid-column: 1 \/ -1;[^}]*grid-row: 2;[^}]*overflow: hidden;[^}]*overflow-wrap: anywhere;[^}]*white-space: normal;/);
  assert.doesNotMatch(styles, /\.dim-panel \.dim-workspacePath \{[^}]*overflow-x: auto;/);
  assert.match(styles, /\.dim-panel \.dim-workspaceEdit \{[^}]*grid-column: 2;[^}]*grid-row: 1;[^}]*white-space: nowrap;/);
});

test('bot cards keep Agent Preset guidance in a keyboard-accessible help tooltip', async () => {
  const styles = await readFile(STYLES_URL, 'utf8');

  assert.match(styles, /\.dim-panel \.dim-preset \{[^}]*grid-template-columns: minmax\(0, 1fr\) max-content;[^}]*margin-top: 6px;[^}]*padding: 6px 10px;/);
  assert.match(styles, /\.dim-panel \.dim-presetHeader \{[^}]*position: relative;[^}]*grid-column: 1 \/ -1;[^}]*display: flex;[^}]*justify-content: space-between;/);
  assert.match(styles, /\.dim-panel \.dim-presetTitle \{[^}]*display: inline-flex;[^}]*gap: 5px;[^}]*white-space: nowrap;/);
  assert.match(styles, /\.dim-panel \.dim-presetHelpButton:focus-visible \{[^}]*box-shadow:/);
  assert.match(styles, /\.dim-panel \.dim-presetTooltip \{[^}]*position: absolute;[^}]*width: min\(320px, 100%\);[^}]*white-space: normal;[^}]*opacity: 0;[^}]*visibility: hidden;[^}]*pointer-events: none;/);
  assert.match(styles, /\.dim-panel \.dim-presetHelp:hover \.dim-presetTooltip, \.dim-panel \.dim-presetHelp:focus-within \.dim-presetTooltip \{[^}]*opacity: 1;[^}]*visibility: visible;/);
  assert.match(styles, /\.dim-panel \.dim-presetSelect \{[^}]*grid-column: 1 \/ -1;[^}]*grid-row: 2;/);
  assert.match(styles, /\.dim-panel \.dim-presetError \{[^}]*grid-column: 1 \/ -1;[^}]*grid-row: 3;/);
  assert.doesNotMatch(styles, /\.dim-panel \.dim-presetHelp \{[^}]*grid-row: 3;/);
});

test('the client dictionaries have no duplicate object keys', async () => {
  // A duplicate Chinese key silently drops one of the two translations, which no
  // parity check can catch: the object only ever holds the later value.
  for (const name of ['i18n.js', 'i18n-ru.js']) {
    const source = await readFile(new URL(`../plugin-src/client/${name}`, import.meta.url), 'utf8');
    const { warnings } = await transform(source, { loader: 'js', logLevel: 'silent' });
    assert.deepEqual(
      warnings.filter((warning) => warning.id === 'duplicate-object-key'),
      [],
      name,
    );
  }
});

test('every shipped Chinese client string has an English projection', async () => {
  // Dictionary modules are the projection rather than a source of UI strings:
  // their Chinese keys are the very literals the other modules render, so
  // scanning them would ask the dictionaries to translate themselves.
  const dictionaries = new Set(['i18n.js', 'i18n-ru.js']);
  const paths = (await readdir(CLIENT_SOURCE_DIRECTORY_URL, { recursive: true }))
    .filter((path) => path.endsWith('.js') && !dictionaries.has(path));
  const sources = await Promise.all(paths.map((path) =>
    readFile(new URL(path, CLIENT_SOURCE_DIRECTORY_URL), 'utf8')));
  const strings = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(/(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g)) {
      if (/[\p{Script=Han}]/u.test(match[2])) strings.add(match[2]);
    }
  }

  setImTranslator((key) => en[key] ?? key);
  try {
    const untranslated = [...strings].filter((value) =>
      /[\p{Script=Han}]/u.test(localizeText(value)));
    assert.deepEqual(untranslated, []);
    assert.ok(strings.size > 350);
  } finally {
    setImTranslator(null);
  }
});

test('client source contains no legacy Plugins-tab settings registrations', async () => {
  const paths = (await readdir(CLIENT_SOURCE_DIRECTORY_URL, { recursive: true }))
    .filter((path) => path.endsWith('.js'));
  const sources = await Promise.all(paths.map(async (path) => ({
    path,
    source: await readFile(new URL(path, CLIENT_SOURCE_DIRECTORY_URL), 'utf8'),
  })));
  const legacy = sources
    .filter(({ source }) => source.includes('settings.plugins.tab'))
    .map(({ path }) => path);

  assert.deepEqual(legacy, []);
});

test('client registers one top-level bilingual IM settings section with a directory picker', async () => {
  const effects = [];
  const registrations = [];
  const dictionaries = [];
  const directoryCalls = [];
  const rpcCalls = [];
  const rpcCall = async (...args) => {
    rpcCalls.push(args);
    return { ok: true, value: {} };
  };
  const localeListeners = new Set();
  const ctx = {
    effect(install, label) {
      effects.push({ install, label });
      if (label === 'im-settings: client panel service') return install();
    },
    on(event, listener) {
      assert.equal(event, 'locale/change');
      localeListeners.add(listener);
      return () => localeListeners.delete(listener);
    },
    locale: {
      bind(namespace) {
        assert.equal(namespace, IM_LOCALE_NAMESPACE);
        return (key) => en[key] ?? key;
      },
      register(namespace, value) {
        dictionaries.push({ namespace, value });
        return () => {};
      },
      getLocale() {
        return { active: 'en', locales: [], revision: 1 };
      },
    },
    connection: { rpc: { call: rpcCall } },
    workspaces: {
      async listDirectory(path, signal) {
        directoryCalls.push({ operation: 'list', path, signal });
        return { path, entries: [] };
      },
      async pickDirectory() {
        directoryCalls.push({ operation: 'pick' });
        return '/workspace/chosen';
      },
    },
    slots: {
      inject(name, install) {
        assert.equal(name, 'settings.section');
        return install();
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => {};
      },
    },
  };

  try {
    applyClient(ctx);
    const dictionaryEffect = effects.find((entry) => entry.label === 'im-settings: bilingual dictionaries');
    assert.ok(dictionaryEffect);
    dictionaryEffect.install();

    assert.deepEqual(clientInject, ['slots', 'connection', 'locale', 'workspaces']);
    assert.equal(dictionaries[0].namespace, IM_LOCALE_NAMESPACE);
    assert.deepEqual(Object.keys(dictionaries[0].value.en).sort(), Object.keys(dictionaries[0].value.zh).sort());
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].options.name, 'settings.section');
    assert.equal(registrations[0].options.id, 'xdlg93-dsh-im');
    assert.equal(registrations[0].options.order, 21);
    assert.equal(registrations[0].options.locale, IM_LOCALE_NAMESPACE);
    assert.equal(registrations[0].options.label(), 'IM bots');
    assert.equal(typeof registrations[0].component, 'function');

    const injected = registrations[0].options.inject();
    const signal = new AbortController().signal;
    await injected.updateRpcCall('update.status', {}, signal);
    await injected.globalSettingsRpcCall('settings.inbound-ttl.get', {}, signal);
    await injected.qqRpcCall('connection.status', {}, signal);
    assert.deepEqual(rpcCalls, [
      ['/api', 'dsh-im/dsh-im', { method: 'update.status', payload: {} }, signal],
      ['/api', `dsh-im${GLOBAL_SETTINGS_RPC_CHANNEL}`, { method: 'settings.inbound-ttl.get', payload: {} }, signal],
      ['/api', 'dsh-im/qq', { method: 'connection.status', payload: {} }, signal],
    ]);
    assert.deepEqual(
      await injected.workspaceDirectoryPicker.listDirectory('/workspace/current', signal),
      { path: '/workspace/current', entries: [] },
    );
    assert.equal(await injected.workspaceDirectoryPicker.pickDirectory(), '/workspace/chosen');
    assert.deepEqual(directoryCalls, [
      { operation: 'list', path: '/workspace/current', signal },
      { operation: 'pick' },
    ]);

    const markup = renderToStaticMarkup(React.createElement(
      registrations[0].component,
      injected,
    ));
    // A browser-derived interface locale reaches the Host only through this
    // mirror, so the settings section must report it while it is mounted.
    const mirrorEffect = effects.find((entry) =>
      entry.label === 'im-settings: mirror the DSH interface language');
    assert.ok(mirrorEffect, 'the interface language mirror is installed');
    const before = rpcCalls.length;
    const disposeMirror = mirrorEffect.install();
    assert.deepEqual(rpcCalls.slice(before), [
      ['/api', `dsh-im${HOST_LANGUAGE_RPC_CHANNEL}`, {
        method: HOST_LANGUAGE_ENDPOINTS.mirror, payload: { locale: 'en' },
      }, undefined],
    ]);
    assert.equal(localeListeners.size, 1);
    disposeMirror();
    assert.equal(localeListeners.size, 0);

    assert.match(markup, /Connecting DeepSeek Harness/);
    assert.match(markup, new RegExp(
      `class="dim-brandVersion">v${IM_PLUGIN_VERSION.replaceAll('.', '\\.')}<\\/span>`,
    ));
    assert.match(markup, /Help &amp; feedback · Open GitHub/);
    assert.match(markup, /General settings/);
    assert.match(markup, />WeChat</);
    assert.match(markup, />QQ</);
    assert.doesNotMatch(markup, /[\p{Script=Han}]/u);
  } finally {
    setImTranslator(null);
  }
});

test('client directory picker uses the current DSH uiWorkspace service', async () => {
  const registrations = [];
  const directoryCalls = [];
  let uiWorkspace;
  const ctx = {
    effect(install, label) {
      if (label === 'im-settings: client panel service') return install();
    },
    get(name) {
      assert.equal(name, 'uiWorkspace');
      return uiWorkspace;
    },
    locale: {
      bind: () => (key) => key,
      register: () => () => {},
    },
    connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
    workspaces: {
      list: {
        getSnapshot: () => ({ items: [] }),
        subscribe: () => () => {},
      },
    },
    slots: {
      inject(name, install) {
        assert.equal(name, 'settings.section');
        return install();
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => {};
      },
    },
  };

  try {
    applyClient(ctx);
    uiWorkspace = {
      async listDirectory(path, signal) {
        directoryCalls.push({ operation: 'list', path, signal });
        return { path, entries: [] };
      },
      async pickDirectory() {
        directoryCalls.push({ operation: 'pick' });
        return '/workspace/current-host';
      },
    };

    const injected = registrations[0].options.inject();
    const signal = new AbortController().signal;
    assert.deepEqual(
      await injected.workspaceDirectoryPicker.listDirectory('/workspace/current', signal),
      { path: '/workspace/current', entries: [] },
    );
    assert.equal(
      await injected.workspaceDirectoryPicker.pickDirectory(),
      '/workspace/current-host',
    );
    assert.deepEqual(directoryCalls, [
      { operation: 'list', path: '/workspace/current', signal },
      { operation: 'pick' },
    ]);
  } finally {
    setImTranslator(null);
  }
});

test('every channel settings page and connected card renders English copy', () => {
  const rpcCall = async () => ({ ok: true, value: {} });
  const noop = () => {};
  const account = {
    botId: 'bot-english',
    state: 'connected',
    connected: true,
    bot: {
      name: 'Demo Bot',
      accountIdMasked: 'account••01',
      appIdMasked: 'app••01',
      clientIdMasked: 'client••01',
      idMasked: 'bot••01',
      username: 'demo_bot',
    },
    health: { summary: 'Connection is healthy', lastCheckedAt: '2026-08-16T08:00:00.000Z' },
  };

  setImTranslator((key) => en[key] ?? key);
  try {
    const globalMarkup = renderToStaticMarkup(React.createElement(GlobalSettingsPanel, {
      rpcCall: async () => ({ ok: true, value: { ttlHours: 24 } }),
    }));
    assert.match(globalMarkup, /General settings/);
    assert.match(globalMarkup, />Attachments<\/button>/);
    assert.match(globalMarkup, /Group chat retention \(days\)/);
    assert.match(globalMarkup, /Loading group history settings…/);
    assert.doesNotMatch(globalMarkup, /[\p{Script=Han}]/u);

    const pages = [WeixinSettingsTab, QqSettingsTab];
    const pageMarkup = pages.map((Component) =>
      renderToStaticMarkup(React.createElement(Component, { rpcCall }))).join('\n');
    assert.match(pageMarkup, /Scan QR code/);
    assert.match(pageMarkup, /Manual setup/);
    assert.match(pageMarkup, /Loading WeChat connection status/);
    assert.match(pageMarkup, /Loading QQ bot status/);
    assert.doesNotMatch(pageMarkup, /[\p{Script=Han}]/u);

    const sharedCardProps = {
      removing: true,
      onReconnect: noop,
      onRequestRemove: noop,
      onConfirmRemove: noop,
      onCancelRemove: noop,
    };
    const cards = [
      React.createElement(WeixinAccountCard, { ...sharedCardProps, account }),
      React.createElement(QqAccountCard, { ...sharedCardProps, account }),
    ];
    const cardMarkup = cards.map(renderToStaticMarkup).join('\n');
    assert.match(cardMarkup, /Connected/);
    assert.doesNotMatch(cardMarkup, /Message channel/);
    assert.match(cardMarkup, /Last checked/);
    assert.match(cardMarkup, /Check connection/);
    assert.match(cardMarkup, /Remove connection/);
    assert.doesNotMatch(cardMarkup, /[\p{Script=Han}]/u);

    const qqRetryMarkup = renderToStaticMarkup(React.createElement(QqAccountCard, {
      ...sharedCardProps,
      removing: false,
      account: {
        ...account,
        state: 'error',
        connected: false,
        error: {
          code: 'connection-failed',
          message: 'QQ 连接未就绪，插件会自动重试。',
        },
      },
    }));
    assert.match(qqRetryMarkup, /The QQ connection is not ready; the plugin will retry automatically\./);
    assert.doesNotMatch(qqRetryMarkup, /[\p{Script=Han}]/u);
  } finally {
    setImTranslator(null);
  }
});

test('every channel tab receives its RPC call from the settings render site', async () => {
  // Regression guard: the render site lists one prop per channel by hand. When
  // a new channel was added to the tab list but not to that list, its settings
  // page mounted without an RPC call and rendered "missing RPC connection".
  const source = await readFile(new URL('index.js', CLIENT_SOURCE_DIRECTORY_URL), 'utf8');
  const tabIds = [...source.matchAll(/\{\s*id:\s*'([a-zA-Z]+)',\s*label:/g)].map(m => m[1]);
  assert.ok(tabIds.length >= 2, `expected the channel tab list, found ${tabIds.length}`);

  // Parse the dependency block that feeds IMSettingsTab. Upstream (#231)
  // refactored the render site into a reusable panel, so the props now come
  // from `panelDependencies` rather than an inline `inject` block; this guard
  // is about the props reaching the tab, not how they are assembled.
  const renderSite = source.indexOf('h(IMSettingsTab, {');
  assert.ok(renderSite > 0, 'the IMSettingsTab render site must exist');
  const blockStart = source.lastIndexOf('const panelDependencies = {', renderSite);
  const injectStart = blockStart >= 0
    ? blockStart
    : source.lastIndexOf('inject: () => ({', renderSite);
  assert.ok(injectStart > 0, 'the settings tab dependency block must exist');
  const injectBlock = source.slice(injectStart, source.indexOf('};', injectStart));
  const providedProps = new Set(
    [...injectBlock.matchAll(/([a-zA-Z]+RpcCall)\s*,/g)].map(m => m[1]),
  );
  const missing = tabIds
    .map((id) => `${id}RpcCall`)
    .filter((name) => !providedProps.has(name));
  assert.deepEqual(missing, [], 'every channel tab must receive its RPC call prop');
});

