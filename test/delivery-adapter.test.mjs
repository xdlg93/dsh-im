import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { QqStateStore } from '../src/channels/qq/state-store.mjs';
import { WeixinStateStore } from '../src/channels/weixin/state-store.mjs';
import {
  createDeliveryAdapter,
  normalizeDeliveryTarget,
} from '../plugin-src/host/delivery-adapter.mjs';
import {
  deliverySuggestionsFromSessions,
  privateDeliverySuggestionFromConversationKey,
} from '../plugin-src/host/delivery-suggestions.mjs';

const TARGETS = {
  weixin: { targetId: 'daily', kind: 'user', route: { toUserId: 'wx-user' } },
  qq: { targetId: 'daily', kind: 'group', route: { groupOpenId: 'qq-group' } },
};

const STATE_STORES = {
  weixin: WeixinStateStore,
  qq: QqStateStore,
};

const SESSION_SUGGESTIONS = {
  weixin: {
    sessions: { 'p2p:wx-user': 'session-weixin', 'group:ignored': 'session-ignored' },
    suggestions: [{ kind: 'user', route: { toUserId: 'wx-user' } }],
  },
  qq: {
    sessions: { 'c2c:user-openid': 'session-user', 'group:group-openid': 'session-group' },
    suggestions: [
      { kind: 'user', route: { userOpenId: 'user-openid' } },
      { kind: 'group', route: { groupOpenId: 'group-openid' } },
    ],
  },
};

const PRIVATE_TARGETS = {
  weixin: { targetId: 'private', kind: 'user', route: { toUserId: 'wx-user' } },
  qq: { targetId: 'private', kind: 'user', route: { userOpenId: 'user-openid' } },
};

test('every delivery adapter validates and forwards one stable target', async () => {
  for (const [channel, target] of Object.entries(TARGETS)) {
    const calls = [];
    const workspaces = {
      has: (botId) => botId === `bot-${channel}`,
      listDeliveryTargets: () => [target],
      createDeliveryTarget: async (...args) => calls.push(['create', ...args]),
      updateDeliveryTarget: async (...args) => calls.push(['update', ...args]),
      deleteDeliveryTarget: async (...args) => calls.push(['delete', ...args]),
    };
    const coreController = {
      async sendProactiveText(...args) { calls.push(['send', ...args]); },
    };
    const { sessions, suggestions } = SESSION_SUGGESTIONS[channel];
    const adapter = createDeliveryAdapter({
      channel,
      workspaces,
      coreController,
      stateFor: async () => ({ snapshot: () => ({ sessions }) }),
    });

    assert.equal(adapter.channel, channel);
    assert.equal(adapter.ownsBot(`bot-${channel}`), true);
    assert.equal(adapter.ownsBot('bot-other'), false);
    const listed = await adapter.listTargets(`bot-${channel}`);
    assert.deepEqual(listed.map(({ sessionSync: _sessionSync, ...entry }) => entry), [target]);
    assert.equal(listed[0].sessionSync.enabled, false);
    assert.deepEqual(await adapter.listSuggestions(`bot-${channel}`), suggestions);
    assert.deepEqual(
      await adapter.sendText(`bot-${channel}`, target, 'hello', { signal: undefined }),
      { sent: true },
    );
    assert.deepEqual(calls[0], [
      'send', `bot-${channel}`, target, 'hello', { signal: undefined },
    ]);
  }
});

test('all adapters enable, resolve, and revalidate one private Session target', async () => {
  for (const [channel, target] of Object.entries(PRIVATE_TARGETS)) {
    const botId = `bot-${channel}`;
    const sessions = { ...SESSION_SUGGESTIONS[channel].sessions };
    const conversationKey = Object.keys(sessions).find((key) => (
      sessions[key] === SESSION_SUGGESTIONS[channel].sessions[Object.keys(sessions)[0]]
    ));
    const sessionId = sessions[conversationKey];
    let syncKey = null;
    const sends = [];
    const approvals = [];
    let sendResult;
    const workspaces = {
      has: (candidate) => candidate === botId,
      listBotIds: () => [botId],
      listDeliveryTargets: () => [structuredClone(target)],
      deliveryTargetFor: (_botId, targetId) => (
        targetId === target.targetId ? structuredClone(target) : null
      ),
      listSessionSyncTargets: () => syncKey
        ? [{ botId, targetId: target.targetId, conversationKey: syncKey }]
        : [],
      async setDeliveryTargetSessionSync(_botId, _targetId, value) { syncKey = value; },
      createDeliveryTarget() {},
      updateDeliveryTarget() {},
      deleteDeliveryTarget() {},
    };
    const adapter = createDeliveryAdapter({
      channel,
      workspaces,
      coreController: {
        async sendProactiveText(...args) { sends.push(args); return sendResult; },
        async presentSessionSyncApproval(...args) { approvals.push(args); return true; },
      },
      stateFor: async () => ({ snapshot: () => ({ sessions }) }),
    });

    assert.deepEqual((await adapter.listTargets(botId))[0].sessionSync, {
      enabled: false, state: 'off',
    }, channel);
    assert.deepEqual(await adapter.setSessionSync(botId, target.targetId, true), {
      enabled: true, state: 'active',
    }, channel);
    assert.equal(syncKey, conversationKey, channel);
    assert.deepEqual(await adapter.listSessionSyncTargets(sessionId), [{
      botId, targetId: target.targetId,
    }], channel);
    assert.deepEqual(
      await adapter.sendSessionSyncText(botId, target.targetId, sessionId, 'synced'),
      { sent: true },
      channel,
    );
    assert.deepEqual(sends.at(-1), [botId, target, 'synced', {}], channel);
    await adapter.sendSessionSyncText(botId, target.targetId, sessionId, '**answer**', { format: 'markdown' });
    assert.deepEqual(sends.at(-1), [botId, target, '**answer**', { format: 'markdown' }], channel);
    for (const result of [false, { sent: false }, { deliveryOutcome: 'failed' }, { deliveryOutcome: 'unknown' }]) {
      sendResult = result;
      const count = sends.length;
      await assert.rejects(adapter.sendSessionSyncText(botId, target.targetId, sessionId, '**answer**', { format: 'markdown' }), {
        code: result?.deliveryOutcome === 'unknown' ? 'send-result-unknown' : 'delivery-failed',
      }, channel);
      assert.equal(sends.length, count + 1, 'never retry failed or uncertain delivery in the adapter');
    }
    sendResult = undefined;

    let decisions = 0;
    let withdrawn = 0;
    const interaction = { respond: async () => { decisions++; }, withdraw: async () => { withdrawn++; } };
    assert.equal(await adapter.presentSessionSyncApproval(botId, target.targetId, sessionId, interaction), true);
    assert.equal(approvals[0][3].key, conversationKey);
    await approvals[0][2].respond({});
    assert.equal(decisions, 1);
    sessions[conversationKey] = `${sessionId}-new`;
    await assert.rejects(approvals[0][2].respond({}), { code: 'interaction-not-pending' });
    assert.equal(decisions, 1);
    assert.equal(withdrawn, 1);
    assert.deepEqual(await adapter.listSessionSyncTargets(sessionId), [], channel);
    await assert.rejects(
      adapter.sendSessionSyncText(botId, target.targetId, sessionId, 'stale'),
      { code: 'session-sync-unavailable' },
      channel,
    );
    delete sessions[conversationKey];
    assert.deepEqual((await adapter.listTargets(botId))[0].sessionSync, {
      enabled: true, state: 'waiting',
    }, channel);
    await adapter.setSessionSync(botId, target.targetId, false);
    assert.equal(syncKey, null, channel);
  }
});

test('delivery adapter delegates target CRUD to the existing workspace store', async () => {
  const calls = [];
  const workspaces = {
    has: () => true,
    listDeliveryTargets: () => [],
    createDeliveryTarget: async (...args) => calls.push(['create', ...args]),
    updateDeliveryTarget: async (...args) => calls.push(['update', ...args]),
    deleteDeliveryTarget: async (...args) => calls.push(['delete', ...args]),
  };
  const adapter = createDeliveryAdapter({
    channel: 'qq',
    workspaces,
    coreController: { sendProactiveText() {} },
    stateFor: async () => ({ snapshot: () => ({ sessions: {} }) }),
  });
  const target = {
    targetId: 'ops', name: '  Ops  ', kind: 'user', route: { userOpenId: 'qq_ops' },
  };

  await adapter.createTarget('bot-one', target);
  await adapter.updateTarget('bot-one', 'ops', {
    name: 'On call', kind: 'group', route: { groupOpenId: 'qq_oncall' },
  });
  await adapter.deleteTarget('bot-one', 'ops');

  assert.deepEqual(calls, [
    ['create', 'bot-one', {
      targetId: 'ops', name: 'Ops', kind: 'user', route: { userOpenId: 'qq_ops' },
    }],
    ['update', 'bot-one', 'ops', {
      name: 'On call', kind: 'group', route: { groupOpenId: 'qq_oncall' },
    }],
    ['delete', 'bot-one', 'ops'],
  ]);
});

test('suggestion parser strictly filters malformed keys, de-duplicates routes, and never leaks state values', () => {
  const sessions = {
    'c2c:user-openid': 'secret-session-one',
    'group:group-openid': { sessionId: 'secret-session-two' },
    'c2c:user-openid:7': 'transient-reply-key',
    'c2c:': 'empty-identity',
    'group:has space': 'invalid-identity',
    'other:88': 'wrong-prefix',
  };
  const suggestions = deliverySuggestionsFromSessions('qq', sessions);
  assert.deepEqual(suggestions, [
    { kind: 'user', route: { userOpenId: 'user-openid' } },
    { kind: 'group', route: { groupOpenId: 'group-openid' } },
  ]);
  assert.deepEqual(
    suggestions.map((suggestion) => Object.keys(suggestion)),
    [['kind', 'route'], ['kind', 'route']],
  );
  assert.doesNotMatch(JSON.stringify(suggestions), /session|reply|secret/i);
  assert.deepEqual(deliverySuggestionsFromSessions('qq', null), []);
  assert.deepEqual(deliverySuggestionsFromSessions('unknown', sessions), []);
});

test('every adapter lists suggestions from reloaded bot state while no runtime is connected', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-delivery-suggestions-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [channel, StateStore] of Object.entries(STATE_STORES)) {
    const path = join(directory, `${channel}.json`);
    const [conversationKey] = Object.keys(SESSION_SUGGESTIONS[channel].sessions);
    await (await new StateStore(path).load()).setSession(conversationKey, `session-${channel}`);
    const reloaded = await new StateStore(path).load();
    const adapter = createDeliveryAdapter({
      channel,
      workspaces: {
        has: () => true,
        listDeliveryTargets: () => [],
        createDeliveryTarget() {},
        updateDeliveryTarget() {},
        deleteDeliveryTarget() {},
      },
      coreController: {},
      stateFor: async () => reloaded,
    });
    assert.deepEqual(
      await adapter.listSuggestions(`bot-${channel}`),
      SESSION_SUGGESTIONS[channel].suggestions.slice(0, 1),
      channel,
    );
  }
});

test('every channel rejects unknown or transient route fields', () => {
  for (const [channel, target] of Object.entries(TARGETS)) {
    assert.throws(
      () => normalizeDeliveryTarget(channel, {
        ...target,
        route: { ...target.route, sessionId: 'unstable' },
      }),
      (error) => error?.code === 'invalid-target',
      channel,
    );
  }
});

test('channel-specific route kinds stay strict', () => {
  assert.throws(
    () => normalizeDeliveryTarget('weixin', {
      targetId: 'group', kind: 'group', route: { toUserId: 'wx-user' },
    }),
    (error) => error?.code === 'invalid-target',
  );
  assert.throws(
    () => normalizeDeliveryTarget('qq', {
      targetId: 'group', kind: 'group', route: { groupOpenId: ' qq-group' },
    }),
    (error) => error?.code === 'invalid-target',
  );
  assert.throws(
    () => normalizeDeliveryTarget('qq', {
      targetId: 'group', kind: 'group', route: { userOpenId: 'qq-user' },
    }),
    (error) => error?.code === 'invalid-target',
  );
});

/**
 * A group chat is a shared room: mirrored text belongs there, but a question or
 * an approval would be answerable by any member, so both stay in private chat.
 */
function groupAdapter() {
  const target = {
    targetId: 'group', name: 'Daily group', kind: 'group',
    route: { groupOpenId: 'qq-group' },
  };
  const sessions = { 'group:qq-group': 'session-group' };
  const state = { syncKey: null, sends: [], interactions: [] };
  const workspaces = {
    has: () => true,
    listBotIds: () => ['bot-qq'],
    listDeliveryTargets: () => [structuredClone(target)],
    deliveryTargetFor: (_botId, targetId) => (targetId === target.targetId ? structuredClone(target) : null),
    listSessionSyncTargets: () => (state.syncKey
      ? [{ botId: 'bot-qq', targetId: target.targetId, conversationKey: state.syncKey }]
      : []),
    async setDeliveryTargetSessionSync(_botId, _targetId, value) { state.syncKey = value; },
    createDeliveryTarget() {},
    updateDeliveryTarget() {},
    deleteDeliveryTarget() {},
  };
  const adapter = createDeliveryAdapter({
    channel: 'qq',
    workspaces,
    coreController: {
      async sendProactiveText(...args) { state.sends.push(args); },
      async presentSessionSyncApproval(...args) { state.interactions.push(['approval', ...args]); return true; },
      async presentSessionSyncQuestion(...args) { state.interactions.push(['question', ...args]); return true; },
    },
    stateFor: async () => ({ snapshot: () => ({ sessions }) }),
  });
  return { adapter, target, state };
}

test('a QQ group receives mirrored text and never a question or approval', async () => {
  const { adapter, target, state } = groupAdapter();

  assert.deepEqual((await adapter.listTargets('bot-qq'))[0].sessionSync, {
    enabled: false, state: 'off',
  });
  assert.deepEqual(await adapter.setSessionSync('bot-qq', target.targetId, true), {
    enabled: true, state: 'active',
  });
  assert.equal(state.syncKey, 'group:qq-group');

  // Text follows the group route the channel persisted.
  assert.deepEqual(
    await adapter.sendSessionSyncText('bot-qq', target.targetId, 'session-group', 'answer'),
    { sent: true },
  );
  assert.deepEqual(state.sends.at(-1), ['bot-qq', { ...target, targetId: target.targetId }, 'answer', {}]);
  await assert.rejects(
    adapter.sendSessionSyncText('bot-qq', target.targetId, 'another-session', 'answer'),
    { code: 'session-sync-unavailable' },
  );

  // A group is not a candidate for a synced question or approval, and both
  // paths refuse it even when asked directly by target id.
  assert.deepEqual(await adapter.listSessionSyncTargets('session-group'), []);
  const interaction = { respond: async () => {}, withdraw: async () => {} };
  for (const [method, describe] of [
    ['presentSessionSyncApproval', 'describeSessionSyncApprovalTarget'],
    ['presentSessionSyncQuestion', 'describeSessionSyncQuestionTarget'],
  ]) {
    await assert.rejects(adapter[method]('bot-qq', target.targetId, 'session-group', interaction), {
      code: 'session-sync-unavailable',
    }, method);
    await assert.rejects(adapter[describe]('bot-qq', target.targetId, 'session-group'), {
      code: 'session-sync-unavailable',
    }, describe);
  }
  assert.deepEqual(state.interactions, []);

  assert.deepEqual((await adapter.listTargets('bot-qq'))[0].sessionSync, {
    enabled: true, state: 'active',
  });
});
