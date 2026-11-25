import assert from 'node:assert/strict';
import test from 'node:test';

import { parseConversationKey } from '../src/channels/shared/conversation/describe.mjs';
import { createDeliveryAdapter } from '../plugin-src/host/delivery-adapter.mjs';

/** Minimal workspace store: only the calls describeConversationBySession makes. */
function fakeWorkspaces(botIds) {
  return {
    listBotIds: () => [...botIds],
    has: (botId) => botIds.includes(botId),
  };
}

function fakeState(sessionsByBot) {
  return async (botId) => {
    const sessions = sessionsByBot[botId];
    if (!sessions) throw new Error(`no state for ${botId}`);
    return { snapshot: () => ({ sessions }) };
  };
}

function adapterWith({ botIds = ['botA'], sessionsByBot, accounts = {}, loaded = null, stats = { loads: 0 } }) {
  return createDeliveryAdapter({
    channel: 'qq',
    workspaces: fakeWorkspaces(botIds),
    coreController: {
      describeDeliveryAccount: async (botId) => accounts[botId] ?? { name: null },
    },
    stateFor: (botId) => {
      stats.loads += 1;
      return fakeState(sessionsByBot)(botId);
    },
    // `loaded` is the memo of states already in memory; null means nothing is.
    ...(loaded === null ? {} : { stateForSync: (botId) => loaded[botId] ?? null }),
  });
}

test('a group key yields the chat id only', () => {
  assert.deepEqual(parseConversationKey('group:qq-group'), {
    chatType: 'group', chatId: 'qq-group', threadId: null, senderId: null,
  });
});

test('p2p and c2c private keys name the sender', () => {
  for (const [key, id] of [
    ['p2p:wxid_1', 'wxid_1'],
    ['c2c:OPENID1', 'OPENID1'],
  ]) {
    assert.deepEqual(parseConversationKey(key), {
      chatType: 'dm', chatId: null, threadId: null, senderId: id,
    }, key);
  }
});

test('an unknown shape is not guessed', () => {
  for (const key of [null, undefined, '', 'group:', 'direct:', 'direct:D123',
    'channel:1', 42]) {
    assert.equal(parseConversationKey(key), null, `expected null for ${String(key)}`);
  }
});

test('the adapter finds the conversation that owns a session', async () => {
  const adapter = adapterWith({
    sessionsByBot: { botA: { 'group:qq-group': 'session-1' } },
    accounts: { botA: { name: 'DSH Assistant' } },
  });
  const described = await adapter.describeConversationBySession('session-1');
  assert.equal(described.channel, 'qq');
  assert.equal(described.botId, 'botA');
  assert.equal(described.botName, 'DSH Assistant');
  assert.equal(described.conversationKey, 'group:qq-group');
  assert.equal(described.chatType, 'group');
  assert.equal(described.chatId, 'qq-group');
  assert.equal(described.threadId, null);
  assert.equal(described.senderId, null);
});

test('an unknown session is null, not an error', async () => {
  const adapter = adapterWith({ sessionsByBot: { botA: { 'group:qq-group': 'session-1' } } });
  assert.equal(await adapter.describeConversationBySession('session-other'), null);
  assert.equal(await adapter.describeConversationBySession(''), null);
  assert.equal(await adapter.describeConversationBySession(undefined), null);
});

test('a channel whose state cannot be read does not break the lookup', async () => {
  const adapter = adapterWith({ botIds: ['broken', 'botA'], sessionsByBot: { botA: { 'c2c:1': 'session-9' } } });
  const described = await adapter.describeConversationBySession('session-9');
  assert.equal(described.botId, 'botA');
  assert.equal(described.chatType, 'dm');
  assert.equal(described.senderId, '1');
});

test('a missing account name does not throw', async () => {
  const adapter = createDeliveryAdapter({
    channel: 'qq',
    workspaces: fakeWorkspaces(['botA']),
    coreController: {},
    stateFor: fakeState({ botA: { 'group:qq-group': 'session-1' } }),
  });
  const described = await adapter.describeConversationBySession('session-1');
  assert.equal(described.botName, null);
  assert.equal(described.chatId, 'qq-group');
});

// --- persisted authors -------------------------------------------------------

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConversationStateStore } from '../src/channels/shared/conversation-state-store.mjs';

async function withStore(run) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-im-authors-'));
  try {
    return await run(join(dir, 'state.json'), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('a conversation without an inbound message has no author', async () => {
  await withStore(async (file) => {
    const store = new ConversationStateStore(file);
    await store.load();
    await store.setSession('group:qq-group', 'session-1');
    assert.equal(store.authorFor('group:qq-group'), null);
  });
});

test('an inbound message records the author and it survives a reload', async () => {
  await withStore(async (file) => {
    const store = new ConversationStateStore(file);
    await store.load();
    await store.setSession('group:qq-group', 'session-1');
    await store.rememberAuthor('group:qq-group', {
      senderId: '781', senderName: 'Marish', isBot: false,
    });

    const persisted = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(persisted.authors['group:qq-group'].senderId, '781');
    assert.equal(persisted.authors['group:qq-group'].senderName, 'Marish');

    const reopened = new ConversationStateStore(file);
    await reopened.load();
    assert.deepEqual(reopened.authorFor('group:qq-group'), {
      senderId: '781', senderName: 'Marish', isBot: false,
      at: persisted.authors['group:qq-group'].at,
    });
  });
});

test('a new message overwrites the previous author without keeping text', async () => {
  await withStore(async (file) => {
    const store = new ConversationStateStore(file);
    await store.load();
    await store.rememberAuthor('group:qq-group', { senderId: '1', senderName: 'One' });
    await store.rememberAuthor('group:qq-group', { senderId: '2', isBot: true, text: 'must not persist' });
    const author = store.authorFor('group:qq-group');
    assert.equal(author.senderId, '2');
    assert.equal(author.isBot, true);
    assert.equal(author.senderName, undefined);
    assert.equal(author.text, undefined);
    const persisted = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(JSON.stringify(persisted.authors).includes('must not persist'), false);
  });
});

test('the adapter reports the group sender once the bridge recorded it', async () => {
  const adapter = createDeliveryAdapter({
    channel: 'qq',
    workspaces: fakeWorkspaces(['botA']),
    coreController: {},
    stateFor: async () => ({
      snapshot: () => ({
        sessions: { 'group:qq-group': 'session-1' },
        authors: {
          'group:qq-group': { senderId: '781', senderName: 'Marish', isBot: false },
        },
      }),
    }),
  });
  const described = await adapter.describeConversationBySession('session-1');
  assert.equal(described.chatId, 'qq-group');
  assert.equal(described.threadId, null);
  assert.equal(described.senderId, '781');
  assert.equal(described.senderName, 'Marish');
  assert.equal(described.senderIsBot, false);
});

test('a recorded bot sender is flagged, and a direct chat keeps its key sender', async () => {
  const adapter = createDeliveryAdapter({
    channel: 'qq',
    workspaces: fakeWorkspaces(['botA']),
    coreController: {},
    stateFor: async () => ({
      snapshot: () => ({
        sessions: { 'group:qq-group': 'session-a', 'c2c:161161619': 'session-b' },
        authors: { 'group:qq-group': { senderId: '42', isBot: true } },
      }),
    }),
  });
  const group = await adapter.describeConversationBySession('session-a');
  assert.equal(group.senderIsBot, true);
  assert.equal(group.senderName, null);
  const direct = await adapter.describeConversationBySession('session-b');
  assert.equal(direct.senderId, '161161619');
  assert.equal(direct.senderIsBot, null);
});

test('the synchronous lookup answers from states already in memory', () => {
  const loaded = { botA: { snapshot: () => ({ sessions: { 'group:qq-group': 'session-1' }, authors: {} }) } };
  const stats = { loads: 0 };
  const adapter = adapterWith({
    sessionsByBot: { botA: { 'group:qq-group': 'session-1' } },
    loaded,
    stats,
  });
  const described = adapter.describeConversationBySessionSync('session-1');
  assert.equal(described.channel, 'qq');
  assert.equal(described.botId, 'botA');
  assert.equal(described.conversationKey, 'group:qq-group');
  assert.equal(described.threadId, null);
  assert.equal(described.botName, null, 'a name needs the network, and this lookup never waits');
  assert.equal(stats.loads, 0, 'the sync path must not start a load');
});

test('the synchronous lookup is null when the state was never loaded', () => {
  const stats = { loads: 0 };
  const adapter = adapterWith({ sessionsByBot: { botA: { 'group:qq-group': 'session-1' } }, stats });
  assert.equal(adapter.describeConversationBySessionSync('session-1'), null);
  assert.equal(stats.loads, 0);
});

test('the synchronous lookup skips a bot whose state throws', () => {
  const loaded = {
    broken: { snapshot: () => { throw new Error('boom'); } },
    botA: { snapshot: () => ({ sessions: { 'c2c:1': 'session-9' }, authors: { 'c2c:1': { senderId: '1' } } }) },
  };
  const adapter = adapterWith({ botIds: ['broken', 'botA'], sessionsByBot: {}, loaded });
  const described = adapter.describeConversationBySessionSync('session-9');
  assert.equal(described.botId, 'botA');
  assert.equal(described.senderId, '1');
});

// --- end to end: normalized inbound -> bridge -> state -> lookup ------------

import { QqHarnessBridge } from '../src/channels/qq/qq-bridge.mjs';
import { QqStateStore } from '../src/channels/qq/state-store.mjs';
import { CONTEXT_ENHANCEMENT_FIELDS } from '../src/channels/shared/context-enhancement.mjs';

const ENHANCEMENT_ON = {
  botId: 'qq_internal',
  getSettings: () => ({
    group: { enabled: true, fields: [...CONTEXT_ENHANCEMENT_FIELDS], guidance: '' },
    direct: { enabled: true, fields: [...CONTEXT_ENHANCEMENT_FIELDS], guidance: '' },
  }),
};

for (const enhanced of [false, true]) test(`a normalized QQ group message is recorded by the bridge and named by the lookup (enhancement ${enhanced ? 'on' : 'off'})`, async () => {
  await withStore(async (file) => {
    const store = await new QqStateStore(file).load();
    const warnings = [];
    const bridge = new QqHarnessBridge({
      ownerUserOpenid: '*',
      state: store,
      bot: { sendText: async () => undefined },
      harness: {
        sessionExists: async () => false,
        createSession: async () => 'session-e2e',
        ask: async () => 'ok',
      },
      ...(enhanced ? { contextEnhancement: ENHANCEMENT_ON } : {}),
      logger: { warn: (...args) => warnings.push(args.join(' ')), error() {} },
    });
    await bridge.accept({
      kind: 'group', groupOpenid: 'qq-group', rawEventType: 'GROUP_AT_MESSAGE_CREATE',
      senderId: '781', senderName: enhanced ? 'Marish' : undefined, senderIsBot: false,
      messageId: 'message-e2e', content: 'hello',
      replyTarget: { scope: 'group', targetId: 'qq-group', msgId: 'message-e2e' },
    });
    await bridge.waitForIdle?.();
    for (let i = 0; i < 200 && !store.authorFor('group:qq-group'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.deepEqual(warnings.filter((line) => line.includes('author')), []);
    const author = store.authorFor('group:qq-group');
    assert.equal(author?.senderId, '781');
    // Names are personal data: kept only when context enhancement read them.
    assert.equal(author?.senderName, enhanced ? 'Marish' : undefined);
    assert.equal(author?.isBot, false);

    const adapter = createDeliveryAdapter({
      channel: 'qq',
      workspaces: fakeWorkspaces(['botA']),
      coreController: {},
      stateFor: async () => store,
    });
    const described = await adapter.describeConversationBySession('session-e2e');
    assert.equal(described.conversationKey, 'group:qq-group');
    assert.equal(described.senderId, '781');
    assert.equal(described.senderName, enhanced ? 'Marish' : null);
    assert.equal(described.senderIsBot, false);
  });
});
