import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createProactiveSendTools,
  installProactiveSendTools,
} from '../plugin-src/host/channels/shared/proactive-send-tool.mjs';

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

test('the send tool reports a delivered message', async () => {
  const service = fakeDelivery();
  const [, send] = createProactiveSendTools({ deliveryService: service });
  assert.equal(send.name, 'dsh_im_send');
  const result = await send.execute({ botId: 'qq-1', targetId: 't2', text: 'hi' }, {});
  assert.deepEqual(result, { delivered: true, queued: false });
  assert.deepEqual(service.sends[0], { botId: 'qq-1', targetId: 't2', text: 'hi', options: {} });
});

test('the send tool reports a queued WeChat message instead of claiming delivery', async () => {
  const [, send] = createProactiveSendTools({ deliveryService: fakeDelivery({ queued: true }) });
  const result = await send.execute({ botId: 'wx-1', targetId: 't1', text: 'later' }, {});
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
