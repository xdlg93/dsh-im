import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BotWorkspaceStore, createBotWorkspaceScope } from '../src/channels/shared/bot-workspace-store.mjs';
import { runWorkspaceCommand } from '../src/channels/shared/workspace-command.mjs';
import { qqMenuView } from '../src/channels/qq/qq-menu.mjs';
import { QqHarnessBridge } from '../src/channels/qq/qq-bridge.mjs';
import { QqStateStore } from '../src/channels/qq/state-store.mjs';
import { directAccessPolicy } from './channels/access-policy-fixture.mjs';

async function fixture(t, { sessionCount = 1, beforeList } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-im-channel-workspace-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspaceA = join(root, 'a');
  const workspaceB = join(root, 'b');
  await Promise.all([mkdir(workspaceA), mkdir(workspaceB)]);
  const workspaces = await new BotWorkspaceStore(join(root, 'workspaces.json'), {
    defaultWorkspace: workspaceA,
  }).load();
  const botId = 'bot_channel_workspace';
  await workspaces.ensure(botId);
  const state = await new QqStateStore(join(root, 'state.json')).load();
  const listedWorkspaces = [];
  const adoptedSessions = [];
  const archivedSessionCalls = [];
  const target = {
    async ensureRunning() {},
    async listWorkspaces() { return [workspaceA, workspaceB]; },
    async listWorkspaceSessions(workspace) {
      listedWorkspaces.push(workspace);
      await beforeList?.(workspace);
      const name = workspace === workspaceB ? 'B' : 'A';
      return {
        workspace,
        sessions: Array.from({ length: sessionCount }, (_, index) => ({
          sessionId: `session-${name}${index ? `-${index + 1}` : ''}`,
          title: `Session ${name}${index ? ` ${index + 1}` : ''}`,
        })),
      };
    },
    async listModels() { return { groups: [], failures: [] }; },
    async adoptWorkspaceSession(sessionId) {
      adoptedSessions.push(sessionId);
      return { sessionId, workspace: sessionId === 'session-B' ? workspaceB : workspaceA };
    },
    async archiveWorkspaceSession(sessionId, options = {}) {
      archivedSessionCalls.push({ sessionId, stopActivity: options.stopActivity === true });
      return { archivedSessionIds: [sessionId] };
    },
  };
  const scope = createBotWorkspaceScope(target, { botId, workspaces, state });
  return {
    ...scope,
    workspaces,
    botId,
    workspaceA,
    workspaceB,
    listedWorkspaces,
    adoptedSessions,
    archivedSessionCalls,
  };
}

test('the production scope exposes sessionFor so /sessionlist marks the bound Session', async (t) => {
  const f = await fixture(t);
  const key = 'p2p:ou_owner';
  assert.equal(typeof f.harness.sessionFor, 'function');
  await f.state.setSession(key, 'session-A');

  const listed = await runWorkspaceCommand('/sessionlist', f.harness, key);
  assert.match(listed.message, /1\. Session A（当前绑定）\n   ID: session-A/);
});

test('title binding in a pinned workspace preserves the bot default and other chats', async (t) => {
  const f = await fixture(t);
  const key = 'p2p:ou_owner';
  const otherKey = 'p2p:ou_other';
  await f.harness.switchConversationWorkspace(key, f.workspaceB);
  await f.state.setSession(otherKey, 'session-A');

  const bound = await runWorkspaceCommand('/session B', f.harness, key);

  assert.match(bound.message, /ID：session-B/);
  assert.equal(f.state.sessionFor(key), 'session-B');
  assert.equal(f.state.sessionFor(otherKey), 'session-A');
  assert.equal(f.harness.currentWorkspace(), f.workspaceA);
  assert.equal(f.harness.currentConversationWorkspace(key), f.workspaceB);
  assert.equal(f.workspaces.hasConversationWorkspaceOverride(f.botId, key), true);

  // Explicit IDs retain the documented bot-wide switching behavior.
  await runWorkspaceCommand('/session session-B', f.harness, key);
  assert.equal(f.harness.currentWorkspace(), f.workspaceB);
  assert.equal(f.state.sessionFor(otherKey), null);
});

test('a workspace change during title search rejects the stale selection', async (t) => {
  let release;
  let ready;
  const paused = new Promise((resolve) => { ready = resolve; });
  const resume = new Promise((resolve) => { release = resolve; });
  let block = true;
  const f = await fixture(t, {
    async beforeList() {
      if (!block) return;
      block = false;
      ready();
      await resume;
    },
  });
  const key = 'p2p:ou_owner';
  const otherKey = 'p2p:ou_other';
  await f.harness.switchConversationWorkspace(key, f.workspaceB);
  await f.state.setSession(otherKey, 'session-A');
  const selecting = runWorkspaceCommand('/session B', f.harness, key);
  await paused;
  try {
    await f.harness.switchConversationWorkspace(key, f.workspaceA);
  } finally {
    release();
  }

  const result = await selecting;
  assert.match(result.message, /工作区或会话状态已发生变化/);
  assert.equal(f.harness.currentWorkspace(), f.workspaceA);
  assert.equal(f.harness.currentConversationWorkspace(key), f.workspaceA);
  assert.equal(f.state.sessionFor(key), null);
  assert.equal(f.state.sessionFor(otherKey), 'session-A');
});

test('QQ menus list conversation sessions while workspace choices retain the bot default', async (t) => {
  const f = await fixture(t);
  const key = 'c2c:owner';
  await runWorkspaceCommand(`/conv ${f.workspaceB}`, f.harness, key);
  const sessions = await qqMenuView('sessions', f.harness, f.state, key);
  assert.deepEqual(f.listedWorkspaces, [f.workspaceB]);
  assert.ok(sessions.entries.some((entry) => entry.action.text === '/session session-B'));
  assert.ok(!sessions.entries.some((entry) => entry.action.text === '/session session-A'));

  await qqMenuView('main', f.harness, f.state, key);
  assert.equal(f.listedWorkspaces.at(-1), f.workspaceB);
  const choices = await qqMenuView('workspaces', f.harness, f.state, key);
  const current = choices.entries.find((entry) => entry.label.startsWith('✓ '));
  assert.equal(current.action.text, `/workspace ${f.workspaceA}`);
  assert.equal(f.harness.currentWorkspace(), f.workspaceA);
});

test('QQ rejects an actor\'s old session menu after another group actor changes /conv', async (t) => {
  const f = await fixture(t);
  const key = 'group:group-one';
  const sent = [];
  const policy = directAccessPolicy({ users: [
    { id: 'owner', canExecuteCommands: true }, { id: 'other', canExecuteCommands: true },
  ] });
  policy.getSettings().group = structuredClone(policy.getSettings().direct);
  const bridge = new QqHarnessBridge({
    bot: {
      async send(message) { sent.push(message); return { id: `reply-${sent.length}` }; },
      async sendText(_target, text) { sent.push({ content: text }); return { id: `reply-${sent.length}` }; },
    },
    ownerUserOpenid: 'owner', harness: f.harness, state: f.state, accessPolicy: policy,
    logger: { warn() {}, error() {} },
    workspaceRoots: [f.workspaceA, f.workspaceB, f.defaultWorkspace, f.alternateWorkspace].filter(Boolean),
  });
  let sequence = 0;
  const send = async (content, senderId = 'owner') => {
    const messageId = `message-${++sequence}`;
    await bridge.accept({
      kind: 'group', groupOpenid: 'group-one', rawEventType: 'GROUP_AT_MESSAGE_CREATE',
      senderId, messageId, content,
      replyTarget: { scope: 'group', targetId: 'group-one', msgId: messageId },
    });
  };
  await send(`/conv ${f.workspaceB}`);
  await send('/m sessions');
  const menu = sent.findLast((message) => message.keyboard);
  assert.ok(menu);
  const choice = menu.keyboard.content.rows[0].buttons[0].action.data;
  await send(`/conv ${f.workspaceA}`, 'other');
  assert.equal(f.state.sessionFor(key), null);
  await send(choice);

  assert.deepEqual(f.adoptedSessions, []);
  assert.equal(f.harness.currentConversationWorkspace(key), f.workspaceA);
  assert.equal(f.state.sessionFor(key), null);
  assert.match(JSON.stringify(sent.at(-1)), /会话或工作区已变化/u);
});

test('the production scope exposes archiveWorkspaceSession for /sessionarchive', async (t) => {
  const f = await fixture(t, { sessionCount: 2 });
  assert.equal(typeof f.harness.archiveWorkspaceSession, 'function');

  const result = await runWorkspaceCommand('/sessionarchive session-A-2', f.harness, 'p2p:ou_owner');
  assert.deepEqual(f.archivedSessionCalls, [{ sessionId: 'session-A-2', stopActivity: false }]);
  assert.match(result.message, /^已归档会话：/);
  assert.match(result.message, /ID：session-A-2/);

  // An index only previews; the destructive call needs the explicit id.
  const preview = await runWorkspaceCommand('/sessionarchive 1', f.harness, 'p2p:ou_owner');
  assert.match(preview.message, /按序号归档只做预览/);
  assert.equal(f.archivedSessionCalls.length, 1);

  const withStop = await runWorkspaceCommand('/sessionarchive session-A --stop', f.harness, 'p2p:ou_owner');
  assert.deepEqual(f.archivedSessionCalls.at(-1), { sessionId: 'session-A', stopActivity: true });
  assert.match(withStop.message, /ID：session-A/);
});
