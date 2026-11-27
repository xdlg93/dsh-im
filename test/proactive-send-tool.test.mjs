import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createProactiveSendTools,
  installProactiveSendTools,
} from '../plugin-src/host/channels/shared/proactive-send-tool.mjs';

function fakeApproval(outcome = 'allowed-once') {
  const asked = [];
  return {
    asked,
    request: async (req) => { asked.push(req); return outcome; },
  };
}

function execution(sessionId = 'session-1') {
  return { agent: { session: { id: sessionId } }, signal: new AbortController().signal };
}

function fakeDelivery({ queued = false } = {}) {
  const sends = [];
  return {
    sends,
    listBots: async () => [{ botId: 'wx-1', channel: 'weixin' }, { botId: 'qq-1', channel: 'qq' }],
    listTargets: async (botId) => (botId === 'wx-1'
      ? { botId, channel: 'weixin', targets: [{ targetId: 't1', name: '我', kind: 'user', route: { toUserId: 'owner' } }] }
      : { botId, channel: 'qq', targets: [{ targetId: 't2', kind: 'group', route: { groupOpenId: 'g1' } }] }),
    send: async (botId, targetId, text, options) => {
      sends.push({ botId, targetId, text, options });
      return queued
        ? { sent: false, queued: true, reason: 'session-timeout', pending: 1 }
        : { sent: true };
    },
  };
}

test('the target tool lists every account with its channel and route', async () => {
  const [list] = createProactiveSendTools({ deliveryService: fakeDelivery() });
  assert.equal(list.name, 'dsh_im_targets');
  const result = await list.execute({}, {});
  assert.equal(result.count, 2);
  assert.deepEqual(result.targets.map((target) => `${target.botId}:${target.targetId}`), ['wx-1:t1', 'qq-1:t2']);
  assert.equal(result.targets[0].channel, 'weixin');
  assert.equal(result.targets[1].kind, 'group');
});

test('the send tool reports a delivered message after the user approves', async () => {
  const service = fakeDelivery();
  const approval = fakeApproval();
  const [, send] = createProactiveSendTools({ deliveryService: service, approval });
  assert.equal(send.name, 'dsh_im_send');
  const result = await send.execute({ botId: 'qq-1', targetId: 't2', text: 'hi' }, execution());
  assert.equal(approval.asked.length, 1);
  assert.equal(approval.asked[0].toolName, 'dsh_im_send');
  assert.match(approval.asked[0].reason, /qq-1\/t2/);
  assert.deepEqual(result, { delivered: true, queued: false });
  assert.deepEqual(service.sends[0], { botId: 'qq-1', targetId: 't2', text: 'hi', options: {} });
});

test('the send tool reports a queued WeChat message instead of claiming delivery', async () => {
  const [, send] = createProactiveSendTools({
    deliveryService: fakeDelivery({ queued: true }),
    approval: fakeApproval(),
  });
  const result = await send.execute({ botId: 'wx-1', targetId: 't1', text: 'later' }, execution());
  assert.equal(result.delivered, false);
  assert.equal(result.queued, true);
  assert.equal(result.reason, 'session-timeout');
  assert.match(result.note, /recipient writes to the bot/u);
});

test('the send tool rejects incomplete arguments before touching the channel', async () => {
  const service = fakeDelivery();
  const [, send] = createProactiveSendTools({ deliveryService: service });
  await assert.rejects(send.execute({ botId: '', targetId: 't1', text: 'x' }, {}), /botId is required/u);
  await assert.rejects(send.execute({ botId: 'wx-1', targetId: '', text: 'x' }, {}), /targetId is required/u);
  await assert.rejects(send.execute({ botId: 'wx-1', targetId: 't1', text: '  ' }, {}), /text is required/u);
  assert.equal(service.sends.length, 0);
});

test('installing without a usable delivery service registers nothing', () => {
  const registered = [];
  const ctx = {
    tools: { register: (tool) => registered.push(tool.name) },
    systemPrompt: { context: () => {} },
  };
  assert.equal(installProactiveSendTools(ctx, {}), false);
  assert.deepEqual(registered, []);
  assert.equal(installProactiveSendTools(ctx, { deliveryService: fakeDelivery() }), true);
  assert.deepEqual(registered, ['dsh_im_targets', 'dsh_im_send']);
});

test('a send the user did not approve never reaches the channel', async () => {
  for (const outcome of ['denied', 'cancelled', 'unavailable']) {
    const service = fakeDelivery();
    const [, send] = createProactiveSendTools({
      deliveryService: service,
      approval: fakeApproval(outcome),
    });
    await assert.rejects(send.execute({ botId: 'qq-1', targetId: 't2', text: 'hi' }, execution()),
      { code: `approval-${outcome}` });
    assert.equal(service.sends.length, 0);
  }
});

test('a Session without an approval answerer cannot push messages', async () => {
  const service = fakeDelivery();
  const [, send] = createProactiveSendTools({ deliveryService: service });
  await assert.rejects(send.execute({ botId: 'qq-1', targetId: 't2', text: 'hi' }, execution()),
    { code: 'approval-unavailable' });
  assert.equal(service.sends.length, 0);
});

test('one Session may push at most three messages a minute', async () => {
  const service = fakeDelivery();
  const [, send] = createProactiveSendTools({ deliveryService: service, approval: fakeApproval() });
  for (const text of ['one', 'two', 'three']) {
    await send.execute({ botId: 'qq-1', targetId: 't2', text }, execution());
  }
  await assert.rejects(send.execute({ botId: 'qq-1', targetId: 't2', text: 'four' }, execution()),
    { code: 'rate-limited' });
  assert.equal(service.sends.length, 3);
  // Another Session has its own budget.
  await send.execute({ botId: 'qq-1', targetId: 't2', text: 'other' }, execution('session-2'));
  assert.equal(service.sends.length, 4);
});

test('the unattended switch lets a Session without an answerer push', async () => {
  const service = fakeDelivery();
  const [, send] = createProactiveSendTools({
    deliveryService: service,
    unattendedSend: async () => true,
  });
  const result = await send.execute({ botId: 'qq-1', targetId: 't2', text: 'scheduled' }, execution());
  assert.deepEqual(result, { delivered: true, queued: false });
  assert.equal(service.sends.length, 1);
});

test('the unattended switch never overrides an explicit refusal', async () => {
  const service = fakeDelivery();
  const [, send] = createProactiveSendTools({
    deliveryService: service,
    approval: fakeApproval('denied'),
    unattendedSend: async () => true,
  });
  await assert.rejects(send.execute({ botId: 'qq-1', targetId: 't2', text: 'hi' }, execution()),
    { code: 'approval-denied' });
  assert.equal(service.sends.length, 0);
});

test('an unreadable unattended setting stays closed', async () => {
  const service = fakeDelivery();
  const [, send] = createProactiveSendTools({
    deliveryService: service,
    unattendedSend: async () => { throw new Error('damaged document'); },
  });
  await assert.rejects(send.execute({ botId: 'qq-1', targetId: 't2', text: 'hi' }, execution()),
    { code: 'approval-unavailable' });
  assert.equal(service.sends.length, 0);
});
