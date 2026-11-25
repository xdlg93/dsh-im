import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TestRenderer from 'react-test-renderer';

import {
  ACCESS_CHANNEL_DEFINITIONS,
  ACCESS_POLICY_ENDPOINT,
} from '../plugin-src/client/access-policy-settings.js';
import {
  BOT_SETTINGS_TABS,
  DELIVERY_CHANNEL_DEFINITIONS,
  DELIVERY_ENDPOINTS,
  DELIVERY_RPC_CHANNEL,
  DeliveryTargetSettingsPage,
} from '../plugin-src/client/delivery-settings.js';
import { en, setImTranslator } from '../plugin-src/client/i18n.js';
import { AccountCard as WeixinAccountCard } from '../plugin-src/client/channels/weixin/index.js';
import { AccountCard as QqAccountCard } from '../plugin-src/client/channels/qq/index.js';
import { IMSettingsTab } from '../plugin-src/client/index.js';
import { BotSettingsContext } from '../plugin-src/client/channel-card-meta.js';

const { act, create } = TestRenderer;

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function textOf(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node?.props?.children ?? '');
}

function button(root, label) {
  return root.findAllByType('button').find((entry) => textOf(entry) === label);
}

function accessHelpButtons(root) {
  return root.findAll((entry) => entry.type === 'button'
    && String(entry.props['aria-label'] ?? '').endsWith('查看访问权限说明'));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function mount(t, props) {
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(DeliveryTargetSettingsPage, {
      accessRpcCall: async () => ({ ok: true, value: { bots: [props.account] } }),
      ...props,
    }));
    await flush();
  });
  // These cases exercise delivery and its sibling tabs; General is the entry tab.
  await act(async () => {
    renderer.root.findByProps({ id: 'dim-bot-settings-delivery-tab' }).props.onClick();
    await flush();
  });
  t.after(async () => {
    await act(async () => {
      renderer.unmount();
      await flush();
    });
  });
  return renderer;
}

const connectedAccount = Object.freeze({
  botId: 'bot_qq_01',
  botName: '通知机器人',
  connected: true,
  accessPolicy: Object.freeze({
    direct: Object.freeze({
      mode: 'open',
      open: Object.freeze({
        defaultCanExecuteCommands: true,
        commandPermissionOverrides: Object.freeze([]),
      }),
      allowlist: Object.freeze({ users: Object.freeze([]) }),
    }),
    group: Object.freeze({
      mode: 'open',
      open: Object.freeze({
        defaultCanExecuteCommands: false,
        commandPermissionOverrides: Object.freeze([]),
      }),
      allowlist: Object.freeze({ users: Object.freeze([]) }),
    }),
  }),
});

test('delivery settings define the supported channel routes', () => {
  assert.deepEqual(BOT_SETTINGS_TABS, [
    { id: 'general', label: '通用' },
    { id: 'delivery', label: '投递设置' },
    { id: 'ds-bot', label: '绑定 DS Bot' },
    { id: 'access', label: '访问设置' },
  ]);
  assert.equal(DELIVERY_RPC_CHANNEL, '/dsh-im-delivery');
  assert.deepEqual(Object.keys(DELIVERY_CHANNEL_DEFINITIONS), ['weixin', 'qq']);
  assert.deepEqual(
    DELIVERY_CHANNEL_DEFINITIONS.weixin.fields.user.map((field) => field.key),
    ['toUserId'],
  );
  assert.deepEqual(
    DELIVERY_CHANNEL_DEFINITIONS.qq.fields.group.map((field) => field.key),
    ['groupOpenId'],
  );
  assert.equal('office' in DELIVERY_CHANNEL_DEFINITIONS, false);
  assert.deepEqual(Object.keys(ACCESS_CHANNEL_DEFINITIONS), ['weixin', 'qq']);
  assert.equal(ACCESS_CHANNEL_DEFINITIONS.weixin.groupSupported, false);
  assert.equal('groupSupported' in ACCESS_CHANNEL_DEFINITIONS.qq, false, 'QQ supports group chats');
});

test('expanded card more settings opens a bot-scoped page and returns in place', async (t) => {
  const previousWindow = globalThis.window;
  globalThis.window = {
    setInterval() { return 1; },
    clearInterval() {},
    setTimeout() { return 1; },
    clearTimeout() {},
    requestAnimationFrame(callback) { callback(); return 1; },
    cancelAnimationFrame() {},
  };
  const bot = {
    botId: 'wx_stable_bot',
    connected: true,
    configured: true,
    state: 'connected',
    bot: { name: '微信通知助手', accountIdMasked: 'wx••01' },
    health: { status: 'healthy', summary: '微信连接正常', lastCheckedAt: Date.now() },
    accessPolicy: connectedAccount.accessPolicy,
  };
  const deliveryCalls = [];
  const renderer = await (async () => {
    let mounted;
    await act(async () => {
      mounted = create(React.createElement(IMSettingsTab, {
        browserLocation: { href: 'http://localhost:9527/settings' },
        weixinRpcCall: async (endpoint) => {
          assert.equal(endpoint, 'connection.status');
          return { ok: true, value: { revision: 1, bots: [bot] } };
        },
        deliveryRpcCall: async (endpoint, payload) => {
          deliveryCalls.push({ endpoint, payload });
          return { ok: true, value: { targets: [] } };
        },
        updateRpcCall: async () => ({
          ok: true,
          value: { runningVersion: '4.0.1', canInstall: false },
        }),
      }));
      await flush();
    });
    return mounted;
  })();
  t.after(async () => {
    await act(async () => { renderer.unmount(); await flush(); });
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });

  const card = renderer.root.findByProps({ 'data-bot-id': 'wx_stable_bot' });
  act(() => card.findByProps({ 'aria-label': '展开该账号的设置' }).props.onClick({ stopPropagation() {} }));
  await act(async () => {
    card.findByProps({ 'aria-label': '更多机器人设置' }).props.onClick();
    await flush();
  });
  const page = renderer.root.findByProps({ className: 'dim-deliveryPage' });
  assert.match(page.props['aria-label'], /微信通知助手/);
  assert.doesNotMatch(textOf(page), /调用标识/);
  assert.equal(
    page.findByProps({ className: 'dim-deliveryHeader' }).findAllByType('h2').length,
    0,
  );
  const settingsTabs = page.findAllByProps({ role: 'tab' });
  assert.deepEqual(settingsTabs.map(textOf), ['通用', '投递设置', '绑定 DS Bot', '访问设置']);
  const settingsTab = settingsTabs[0];
  const settingsPanel = page.findByProps({ role: 'tabpanel' });
  assert.equal(textOf(settingsTab), '通用');
  assert.equal(settingsTab.props['aria-selected'], true);
  assert.equal(settingsTab.props.tabIndex, 0);
  assert.equal(settingsTab.props['aria-controls'], settingsPanel.props.id);
  assert.equal(settingsPanel.props['aria-labelledby'], settingsTab.props.id);
  assert.ok(settingsPanel.findByProps({ className: 'dim-botGeneralSettings' }));
  assert.equal(settingsPanel.findByType('select').props.value, 'queue');
  assert.equal(settingsPanel.findByType('select').props.disabled, false);
  await act(async () => {
    button(page, '投递设置').props.onClick();
    await flush();
  });
  const deliveryPanel = page.findByProps({ role: 'tabpanel' });
  const identity = deliveryPanel.findByProps({ className: 'dim-deliveryIdentity' });
  assert.ok(identity);
  assert.ok(deliveryPanel.findByProps({ className: 'dim-deliveryTargets' }));
  assert.equal(page.findByProps({ className: 'dim-botSettingsTabsBar' }).findAllByType('a').length, 0);
  assert.equal(
    textOf(identity.findByType('h2')),
    '微信通知助手',
  );
  const docsLink = identity.findByProps({ className: 'dim-deliveryDocsLink' });
  assert.equal(textOf(docsLink), '使用文档↗');
  assert.equal(
    docsLink.props.href,
    'https://github.com/xdlg93/dsh-im/blob/main/PROACTIVE_DELIVERY.md',
  );
  assert.equal(docsLink.props.target, '_blank');
  assert.equal(docsLink.props.rel, 'noopener noreferrer');
  assert.equal(page.findByType('code').props.children, 'wx_stable_bot');
  assert.deepEqual(deliveryCalls, [{
    endpoint: DELIVERY_ENDPOINTS.list,
    payload: { botId: 'wx_stable_bot' },
  }]);

  await act(async () => {
    button(page, '← 返回机器人列表').props.onClick();
    await flush();
  });
  assert.ok(renderer.root.findByProps({ 'data-bot-id': 'wx_stable_bot' }));
  assert.equal(renderer.root.findByProps({ id: 'dim-tab-weixin' }).props['aria-selected'], true);
});

test('access settings keep a failed atomic save visible as an error', async (t) => {
  const renderer = await mount(t, {
    channel: 'qq',
    account: connectedAccount,
    rpcCall: async () => ({ ok: true, value: { targets: [] } }),
    accessRpcCall: async () => ({
      ok: false,
      error: { code: 'access-policy-invalid', message: '这里需要填写用户的 Open ID，不能填写机器人自己的 Open ID。' },
    }),
    onBack() {},
  });

  await act(async () => {
    button(renderer.root, '访问设置').props.onClick();
    await flush();
  });
  await act(async () => {
    renderer.root.findByProps({ className: 'dim-accessPage' }).props.onSubmit({
      preventDefault() {},
    });
    await flush();
  });

  const feedback = renderer.root.findByProps({ className: 'dim-accessFeedback' });
  assert.equal(textOf(feedback), '这里需要填写用户的 Open ID，不能填写机器人自己的 Open ID。');
  assert.equal(feedback.props['data-tone'], 'error');
  assert.equal(feedback.props.role, 'alert');
});

test('WeChat keeps the shared access page but disables its unsupported group section', async (t) => {
  const renderer = await mount(t, {
    channel: 'weixin',
    account: { ...connectedAccount, botId: 'wx_access_01' },
    rpcCall: async () => ({ ok: true, value: { targets: [] } }),
    accessRpcCall: async () => {
      throw new Error('save should not run in this rendering test');
    },
    onBack() {},
  });
  await act(async () => {
    button(renderer.root, '访问设置').props.onClick();
    await flush();
  });

  const group = renderer.root.findByProps({ 'data-scene': 'group' });
  assert.equal(group.props.disabled, true);
  assert.match(textOf(group), /当前渠道不支持群聊/);
  assert.equal(group.findAllByType('select').length, 0);
  assert.ok(renderer.root.findByProps({ 'data-scene': 'direct' }));
});

test('new target waits for saved targets before generating aliases or checking duplicates', async (t) => {
  const pending = deferred();
  const renderer = await mount(t, {
    channel: 'qq',
    account: connectedAccount,
    rpcCall: async (endpoint) => {
      assert.equal(endpoint, DELIVERY_ENDPOINTS.list);
      return pending.promise;
    },
    onBack() {},
  });

  assert.equal(button(renderer.root, '新建目标').props.disabled, true);

  await act(async () => {
    pending.resolve({ ok: true, value: { targets: [] } });
    await flush();
  });

  assert.equal(button(renderer.root, '新建目标').props.disabled, false);
});

test('each saved target tests only its own botId and targetId and keeps row-local feedback', async (t) => {
  const pending = deferred();
  const calls = [];
  const targets = [
    { targetId: 'daily-report', name: '日报群', kind: 'group', route: { groupOpenId: 'qq_daily' } },
    { targetId: 'oncall', name: '值班同学', kind: 'user', route: { userOpenId: 'qq_oncall' } },
  ];
  const rpcCall = async (endpoint, payload) => {
    calls.push({ endpoint, payload });
    if (endpoint === DELIVERY_ENDPOINTS.list) return { ok: true, value: { targets } };
    if (endpoint === DELIVERY_ENDPOINTS.test) return pending.promise;
    throw new Error(`unexpected endpoint ${endpoint}`);
  };
  const renderer = await mount(t, {
    channel: 'qq', account: connectedAccount, rpcCall, onBack() {},
  });
  const first = renderer.root.findByProps({ 'data-target-id': 'daily-report' });
  const second = renderer.root.findByProps({ 'data-target-id': 'oncall' });

  await act(async () => {
    first.findByProps({ 'aria-label': '测试投递目标' }).props.onClick();
    await flush();
  });
  assert.ok(first.findAllByType('button').some((entry) => textOf(entry) === '测试中…'));
  assert.ok(second.findAllByType('button').some((entry) => textOf(entry) === '测试'));
  assert.deepEqual(calls.at(-1), {
    endpoint: DELIVERY_ENDPOINTS.test,
    payload: { botId: 'bot_qq_01', targetId: 'daily-report' },
  });

  pending.resolve({ ok: true, value: { sent: true } });
  await act(async () => { await flush(); });
  assert.match(textOf(first), /测试消息已发送，请到目标会话确认。/);
  assert.doesNotMatch(textOf(second), /测试消息已发送/);

  await act(async () => {
    renderer.update(React.createElement(DeliveryTargetSettingsPage, {
      channel: 'qq',
      account: { ...connectedAccount, connected: false },
      rpcCall,
      onBack() {},
    }));
    await flush();
  });
  for (const row of renderer.root.findAllByProps({ className: 'dim-targetRow' })) {
    assert.equal(row.findByProps({ 'aria-label': '测试投递目标' }).props.disabled, true);
  }
});

test('saved private targets toggle Session sync while unavailable targets stay disabled', async (t) => {
  const calls = [];
  let targets = [{
    targetId: 'alice',
    name: 'Alice',
    kind: 'user',
    route: { userOpenId: 'qq_alice' },
    sessionSync: { enabled: false, state: 'off' },
  }, {
    targetId: 'group',
    name: '项目群',
    kind: 'group',
    route: { groupOpenId: 'qq_group' },
    sessionSync: { enabled: false, state: 'unavailable' },
  }];
  const rpcCall = async (endpoint, payload) => {
    calls.push({ endpoint, payload });
    if (endpoint === DELIVERY_ENDPOINTS.list) {
      return { ok: true, value: { targets: structuredClone(targets) } };
    }
    if (endpoint === DELIVERY_ENDPOINTS.sessionSync) {
      targets = targets.map((target) => target.targetId === payload.targetId
        ? { ...target, sessionSync: { enabled: payload.enabled, state: payload.enabled ? 'active' : 'off' } }
        : target);
      return { ok: true, value: targets[0].sessionSync };
    }
    throw new Error(`unexpected endpoint ${endpoint}`);
  };
  const renderer = await mount(t, {
    channel: 'qq', account: connectedAccount, rpcCall, onBack() {},
  });
  let privateRow = renderer.root.findByProps({ 'data-target-id': 'alice' });
  const groupRow = renderer.root.findByProps({ 'data-target-id': 'group' });
  const privateToggle = privateRow.findByProps({ 'aria-label': '会话双向同步' });
  assert.equal(privateToggle.props.checked, false);
  assert.equal(privateToggle.props.disabled, false);
  assert.match(textOf(privateRow), /关闭时不发送 DSH 会话消息/);
  assert.equal(groupRow.findByProps({ 'aria-label': '会话双向同步' }).props.disabled, true);

  await act(async () => {
    privateToggle.props.onChange({ target: { checked: true } });
    await flush();
    await flush();
  });
  assert.deepEqual(calls.find((call) => call.endpoint === DELIVERY_ENDPOINTS.sessionSync), {
    endpoint: DELIVERY_ENDPOINTS.sessionSync,
    payload: { botId: 'bot_qq_01', targetId: 'alice', enabled: true },
  });
  privateRow = renderer.root.findByProps({ 'data-target-id': 'alice' });
  assert.equal(privateRow.findByProps({ 'aria-label': '会话双向同步' }).props.checked, true);
  assert.match(textOf(privateRow), /自动跟随该私聊的当前会话/);

  await act(async () => { button(privateRow, '编辑').props.onClick(); });
  assert.match(textOf(renderer.root.findByType('form')), /修改接收位置会关闭会话双向同步/);
});

