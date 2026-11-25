import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateInboundAccess } from '../src/channels/shared/inbound-access.mjs';

import {
  accessPolicyProvider,
  initialAccessPolicyFor,
  newBotAccessPolicyFor,
  privilegedSenderIdsFor,
} from '../plugin-src/host/channels/shared/access-policy-production.mjs';
import {
  SET_ACCESS_POLICY_ENDPOINT,
  validAccessPolicyPayload,
} from '../plugin-src/host/channels/shared/access-policy-rpc.mjs';
import { createWeixinRpcHandler, WEIXIN_ENDPOINTS } from '../plugin-src/host/channels/weixin/rpc.mjs';
import { createQqRpcHandler, QQ_ENDPOINTS } from '../plugin-src/host/channels/qq/rpc.mjs';

const users = (values = []) => values.map((value) => (
  value && typeof value === 'object'
    ? value
    : { id: value, canExecuteCommands: true }
));
const scope = ({
  mode,
  defaultCanExecuteCommands,
  commandPermissionOverrides = [],
  allowlistUsers = [],
}) => ({
  mode,
  open: {
    defaultCanExecuteCommands,
    commandPermissionOverrides: users(commandPermissionOverrides),
  },
  allowlist: { users: users(allowlistUsers) },
});
const open = (allowlistUsers = [], defaultCanExecuteCommands = true) => scope({
  mode: 'open', defaultCanExecuteCommands, allowlistUsers,
});
const allowlist = (allowlistUsers = []) => scope({
  mode: 'allowlist', defaultCanExecuteCommands: false, allowlistUsers,
});
const policy = (direct = open(), group = open()) => ({ direct, group });

test('Host initialization preserves each channel access baseline', () => {
  assert.deepEqual(initialAccessPolicyFor('weixin', { ownerUserId: 'wx-owner' }),
    policy(allowlist(), allowlist()));
  assert.deepEqual(initialAccessPolicyFor('qq', { ownerUserOpenid: 'qq-owner' }),
    policy(allowlist(), open()));
  assert.deepEqual(initialAccessPolicyFor('qq', { ownerUserOpenid: '*' }), policy());
});

test('new QQ bots open messages and commands for QR and manual binding', () => {
  assert.deepEqual(newBotAccessPolicyFor('qq', { ownerUserOpenid: 'qq-owner' }), policy());
  assert.deepEqual(newBotAccessPolicyFor('qq', { ownerUserOpenid: '*' }), policy());
  assert.deepEqual(newBotAccessPolicyFor('weixin', { ownerUserId: 'wx-owner' }),
    initialAccessPolicyFor('weixin', { ownerUserId: 'wx-owner' }));
});

test('Host-only owner identities are not copied into public access-policy rows', () => {
  const cases = [
    ['weixin', { ownerUserId: 'wx-private-owner' }, 'wx-private-owner'],
    ['qq', { ownerUserOpenid: 'qq-private-owner' }, 'qq-private-owner'],
  ];
  for (const [channel, config, ownerId] of cases) {
    assert.equal(JSON.stringify(initialAccessPolicyFor(channel, config)).includes(ownerId), false, channel);
  }
});

test('Host access provider reads the latest committed workspace policy', () => {
  let current = policy(allowlist(), allowlist());
  const provider = accessPolicyProvider({ accessPolicyFor: () => current }, 'bot_one', {
    channel: 'weixin', config: { ownerUserId: 'wx-owner' },
  });
  assert.equal(provider.botId, 'bot_one');
  assert.equal(provider.getSettings(), current);
  current = policy();
  assert.equal(provider.getSettings(), current);
  assert.equal(provider.isPrivileged(['wx-owner'], 'direct'), true);
  assert.equal(provider.isPrivileged(['*'], 'group'), false);
  assert.equal(provider.isPrivileged(['wx-other'], 'direct'), false);
  assert.equal(provider.isPrivileged(['wx-owner'], 'unknown'), false);
  const qq = accessPolicyProvider({ accessPolicyFor: () => current }, 'bot_qq', {
    channel: 'qq', config: { ownerUserOpenid: 'qq-owner' },
  });
  assert.equal(qq.isPrivileged(['qq-owner'], 'group'), true);
});

test('Host privileged identities come only from durable owner or legacy authorization fields', () => {
  assert.deepEqual(privilegedSenderIdsFor('weixin', { ownerUserId: 'wx-owner' }), ['wx-owner']);
  assert.deepEqual(privilegedSenderIdsFor('qq', { ownerUserOpenid: '*' }), []);
  assert.deepEqual(privilegedSenderIdsFor('qq', { ownerUserOpenid: 'qq-owner' }), ['qq-owner']);
});

test('confirmed owners bypass live allowlist and command restrictions without granting other users access', () => {
  const cases = [
    ['weixin', { ownerUserId: 'wx-owner' }, 'wx-owner'],
    ['qq', { ownerUserOpenid: 'qq-owner' }, 'qq-owner'],
  ];
  for (const [channel, config, owner] of cases) {
    let current;
    const provider = accessPolicyProvider({ accessPolicyFor: () => current }, channel, { channel, config });
    for (const restricted of [
      allowlist(),
      allowlist(['member']),
      allowlist([{ id: owner, canExecuteCommands: false }]),
      { ...open([], false), open: {
        defaultCanExecuteCommands: false,
        commandPermissionOverrides: [{ id: owner, canExecuteCommands: false }],
      } },
    ]) {
      current = policy(restricted, restricted);
      for (const conversationType of ['direct', 'group']) {
        for (const text of ['hello', '/status']) {
          assert.deepEqual(evaluateInboundAccess(provider, { conversationType, senderIds: owner, text }),
            { allowed: true, reason: 'privileged-sender' }, channel);
          assert.equal(evaluateInboundAccess(provider, {
            conversationType, senderIds: 'unrelated-user', text: '/status',
          }).allowed, false, channel);
        }
      }
    }
  }
});

test('wildcard-only and another bot owner never become privileged identities', () => {
  for (const [channel, config] of [
    ['feishu', { ownerOpenIds: ['*'] }],
    ['qq', { ownerUserOpenid: '*' }],
    ['discord', {}],
    ['feishu', { ownerOpenIds: ['ou_other_bot_owner'] }],
  ]) {
    const provider = accessPolicyProvider({ accessPolicyFor: () => policy(allowlist(), allowlist()) }, 'bot', {
      channel, config,
    });
    for (const senderIds of ['*', 'ou_owner', 'group-member-openid']) {
      assert.equal(evaluateInboundAccess(provider, {
        conversationType: 'direct', senderIds, text: '/status',
      }).reason, 'sender-not-allowed');
    }
  }
});

test('shared access-policy RPC payload is exact and validates the full atomic policy', () => {
  const value = policy(open([], false), allowlist());
  assert.equal(validAccessPolicyPayload({ botId: 'bot_one', policy: value }), true);
  assert.equal(validAccessPolicyPayload({ botId: 'bot_one', policy: value, extra: true }), false);
  assert.equal(validAccessPolicyPayload({ botId: '../bad', policy: value }), false);
  assert.equal(validAccessPolicyPayload({ botId: 'bot_one', accessMode: 'open' }), false);
  assert.equal(validAccessPolicyPayload({
    botId: 'bot_one',
    policy: {
      direct: { mode: 'open', defaultCanExecuteCommands: true, users: [] },
      group: { mode: 'open', defaultCanExecuteCommands: true, users: [] },
    },
  }), false, 'RPC accepts canonical scopes only');
  assert.equal(validAccessPolicyPayload({
    botId: 'bot_one',
    policy: { ...value, direct: { ...value.direct, mode: 'legacy' } },
  }), false);
});

function controllerFixture() {
  const calls = [];
  const snapshot = (accessPolicy = policy()) => ({
    schemaVersion: 2,
    revision: 1,
    bots: [{
      botId: 'bot_one',
      configured: true,
      connected: true,
      state: 'connected',
      accessPolicy,
    }],
  });
  const controller = {
    status: async () => snapshot(),
    bindCredentials: async () => snapshot(),
    reconnectBot: async () => snapshot(),
    deleteBot: async () => snapshot(),
    startProvisioning: async () => ({}),
    registrationStatus: async () => ({}),
    cancelProvisioning: async () => ({}),
    submitVerification: async () => ({}),
    approveSender: async () => snapshot(),
    revokeSender: async () => snapshot(),
    startRegistration: async () => ({}),
    cancelRegistration: async () => ({}),
    disconnect: async () => snapshot(),
    async updateAccessPolicy(botId, accessPolicy, projectStatus) {
      calls.push({ botId, policy: accessPolicy });
      const value = snapshot(accessPolicy);
      return projectStatus ? projectStatus(value) : value;
    },
  };
  return { controller, calls };
}

test('every Host RPC accepts only the unified bot.access-policy.set contract', async () => {
  const factories = [
    ['weixin', createWeixinRpcHandler, WEIXIN_ENDPOINTS],
    ['qq', createQqRpcHandler, QQ_ENDPOINTS],
  ];
  const next = policy(open([], false), allowlist(['operator']));
  for (const [channel, createHandler, endpoints] of factories) {
    const { controller, calls } = controllerFixture();
    const handler = createHandler(controller);
    assert.equal(endpoints.setAccessPolicy, SET_ACCESS_POLICY_ENDPOINT, channel);
    const result = await handler(endpoints.setAccessPolicy, { botId: 'bot_one', policy: next });
    assert.equal(result.ok, true, `${channel}: ${JSON.stringify(result)}`);
    assert.deepEqual(calls, [{ botId: 'bot_one', policy: next }], channel);
    assert.deepEqual(result.value?.bots?.[0]?.accessPolicy, next, `${channel} update projection`);
    const status = await handler(endpoints.status, {});
    assert.equal(status.ok, true, `${channel} status: ${JSON.stringify(status)}`);
    assert.deepEqual(status.value?.bots?.[0]?.accessPolicy, policy(), `${channel} status projection`);
    const legacy = await handler(endpoints.setAccessPolicy, {
      botId: 'bot_one', accessMode: 'open', allowedUsers: [],
    });
    assert.equal(legacy.ok, false, channel);
    assert.equal(legacy.error.code, 'bad-request', channel);
    assert.equal(calls.length, 1, channel);
  }
});
