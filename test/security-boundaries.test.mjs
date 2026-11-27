/**
 * The boundaries the security review asked for, as executable rules.
 *
 * A chat window reaches the Host's shell, files and Sessions. These tests pin the
 * four places that used to hand that power to anyone who could message the bot,
 * plus the file-out and message-out gates.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { evaluateInboundAccess } from '../src/channels/shared/inbound-access.mjs';
import { runPermissionCommand } from '../src/channels/shared/permission-command.mjs';
import { runWorkspaceCommand, workspaceSwitchRefusal } from '../src/channels/shared/workspace-command.mjs';
import {
  accessPolicyProvider,
  newBotAccessPolicyFor,
} from '../plugin-src/host/channels/shared/access-policy-production.mjs';

function qqPolicy(owner = 'owner') {
  const config = { ownerUserOpenid: owner };
  return accessPolicyProvider(
    { accessPolicyFor: () => newBotAccessPolicyFor('qq', config) },
    'bot',
    { channel: 'qq', config },
  );
}

test('a stranger cannot message or command a bot connected today', () => {
  const policy = qqPolicy();
  for (const conversationType of ['direct', 'group']) {
    for (const text of ['hello', '/status', '/permission danger-full-access', '/workspace /', '/sessionlist --all']) {
      const decision = evaluateInboundAccess(policy, { conversationType, senderIds: 'STRANGER', text });
      assert.equal(decision.allowed, false, `${conversationType}: ${text}`);
    }
    // The scanner keeps both chat and commands.
    assert.deepEqual(
      evaluateInboundAccess(policy, { conversationType, senderIds: 'owner', text: '/status' }),
      { allowed: true, reason: 'privileged-sender' },
    );
  }
});

function permissionFixture() {
  const calls = [];
  const session = {
    permissions: async () => ({
      currentValue: 'workspace-write',
      options: [{ value: 'workspace-write' }, { value: 'danger-full-access' }],
    }),
    executeCommand: async (line) => {
      calls.push(line);
      return { result: { kind: 'success', text: 'ok' } };
    },
  };
  return {
    calls,
    harness: { workspaceSession: () => session },
    state: { sessionFor: () => 'session-1' },
  };
}

test('a chat cannot switch to the preset that disables sandbox and approval', async () => {
  const f = permissionFixture();
  await runPermissionCommand('/permissionlist', f.harness, f.state, 'chat', { isOwner: true });
  const refused = await runPermissionCommand('/permission 2', f.harness, f.state, 'chat', { isOwner: true });
  assert.match(refused.message, /不能切换到 danger-full-access/u);
  assert.deepEqual(f.calls, []);
});

test('a non-owner cannot switch the preset', async () => {
  const f = permissionFixture();
  await runPermissionCommand('/permissionlist', f.harness, f.state, 'chat', { isOwner: false });
  const refused = await runPermissionCommand('/permission 1', f.harness, f.state, 'chat', { isOwner: false });
  assert.match(refused.message, /只有机器人所有者/u);
  assert.deepEqual(f.calls, []);
});

test('a workspace switch stays inside the registered roots', () => {
  assert.equal(workspaceSwitchRefusal('/', ['/tmp/project']), '不能把系统目录设为工作区。');
  assert.equal(workspaceSwitchRefusal('/etc', ['/tmp/project']), '不能把系统目录设为工作区。');
  assert.equal(workspaceSwitchRefusal('/tmp/elsewhere', ['/tmp/project']), '只能在已注册的 DSH 工作区之间切换；请先在 Web 端把该目录添加为工作区。');
  assert.equal(workspaceSwitchRefusal('/tmp/project/sub', ['/tmp/project']), null);
  // A channel that cannot name any root must not move the workspace at all.
  assert.match(workspaceSwitchRefusal('/tmp/project', []), /只能在已注册的 DSH 工作区之间切换/u);
  // A trusted in-process caller keeps its freedom.
  assert.equal(workspaceSwitchRefusal('/tmp/project', null), null);
});

test('the IM workspace command is owner-only and root-restricted', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-im-boundary-'));
  const allowed = join(root, 'allowed');
  const outside = join(root, 'outside');
  await mkdir(allowed);
  await mkdir(outside);
  t.after(() => rm(root, { recursive: true, force: true }));

  const switched = [];
  const harness = {
    async switchWorkspace(path) { switched.push(path); return path; },
    async listWorkspaces() { return [allowed]; },
  };

  const stranger = await runWorkspaceCommand(`/workspace ${outside}`, harness, 'chat', {
    isOwner: false, workspaceRoots: [allowed],
  });
  assert.match(stranger.message, /只有机器人所有者/u);

  const unregistered = await runWorkspaceCommand(`/workspace ${outside}`, harness, 'chat', {
    isOwner: true, workspaceRoots: [allowed],
  });
  assert.match(unregistered.message, /只能在已注册的 DSH 工作区之间切换/u);

  const accepted = await runWorkspaceCommand(`/workspace ${allowed}`, harness, 'chat', {
    isOwner: true, workspaceRoots: [allowed],
  });
  assert.match(accepted.message, /工作区已切换/u);
  assert.deepEqual(switched, [allowed]);
});

test('cross-workspace listing and Session adoption are owner-only', async () => {
  const harness = {
    async listWorkspaceSessions() { return { workspace: '/tmp/project', sessions: [] }; },
    async listWorkspaces() { return ['/tmp/project']; },
    async currentWorkspace() { return '/tmp/project'; },
    async bindWorkspaceSession() { throw new Error('must not bind'); },
  };
  const all = await runWorkspaceCommand('/sessionlist --all', harness, 'chat', { isOwner: false });
  assert.match(all.message, /跨工作区列出会话仅机器人所有者可用/u);
  const bind = await runWorkspaceCommand('/session session-123', harness, 'chat', { isOwner: false });
  assert.match(bind.message, /只有机器人所有者才能绑定已有会话/u);
});

test('a delivered file must come from the workspace and not look like a credential', async (t) => {
  const { createOutboundArtifactTool, OutboundArtifactRegistry } = await import(
    '../src/channels/shared/semantic/artifact.mjs'
  );
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-im-boundary-ws-'));
  const outside = await mkdtemp(join(tmpdir(), 'dsh-im-boundary-out-'));
  t.after(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
  await writeFile(join(outside, 'secret.txt'), 'secret');
  await writeFile(join(workspace, 'note.md'), 'note');
  await writeFile(join(workspace, '.env'), 'TOKEN=1');
  const registry = new OutboundArtifactRegistry({ uuid: () => 'id' });
  const close = registry.openConsumer('session-artifact', 'rpc');
  t.after(close);
  const agent = {
    session: {
      header: { id: 'session-artifact', cwd: workspace },
      events: [
        { type: 'turn/start', data: { turn: 1 } },
        { type: 'user/message', data: { turn: 1, source: { rpcId: 'rpc' } } },
      ],
    },
  };
  for (const event of agent.session.events) registry.observeSessionEvent(agent.session, event);
  const tool = createOutboundArtifactTool({ registry });
  const exec = (callId) => ({ name: 'dsh_im_return_file', agent, callId, rootCallId: callId, token: Symbol(callId) });

  await assert.rejects(tool.definition.execute({ path: join(outside, 'secret.txt') }, exec('out')),
    { code: 'artifact-outside-workspace' });
  await assert.rejects(tool.definition.execute({ path: '.env' }, exec('env')),
    { code: 'artifact-sensitive-path' });
  const accepted = exec('note');
  await tool.definition.execute({ path: 'note.md' }, accepted);
  // The tool stages a snapshot; onResult commits it to the turn.
  tool.onResult(accepted, { isError: false });
  assert.equal(registry.take('session-artifact', 1).length, 1);
});
