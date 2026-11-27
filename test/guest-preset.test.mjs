/**
 * Guest chat runs under a tool-less Agent preset.
 *
 * `read`, `web_fetch` and the shell run without an approval prompt, so a guest
 * turn has to be bounded by its composition, not by an approval card.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { GUEST_PRESET_ID, installGuestPreset } from '../plugin-src/host/guest-preset.mjs';

test('the built-in guest preset is registered with no plugins', async () => {
  const registered = [];
  const ctx = {
    get: (name) => (name === 'agentPresets'
      ? { register: async (definition) => { registered.push(definition); } }
      : undefined),
  };
  const id = installGuestPreset(ctx, {});
  assert.equal(id, GUEST_PRESET_ID);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(registered.length, 1);
  assert.equal(registered[0].id, GUEST_PRESET_ID);
  // No tool plugin is mounted, which is the whole point of the preset.
  assert.deepEqual(registered[0].plugins, []);
});

test('an operator-named preset wins over the built-in one', () => {
  const registered = [];
  const ctx = { get: () => ({ register: async (definition) => registered.push(definition) }) };
  assert.equal(installGuestPreset(ctx, { guestAgentPreset: 'my-guest' }), 'my-guest');
  assert.deepEqual(registered, []);
});

test('a Host without the preset service disables guest sessions instead of failing', () => {
  assert.equal(installGuestPreset({ get: () => undefined }, {}), null);
  assert.equal(installGuestPreset({}, {}), null);
});

test('a guest session is created under the preset while the owner keeps the bot preset', async () => {
  const { QqHarnessBridge } = await import('../src/channels/qq/qq-bridge.mjs');
  const created = [];
  const sent = [];
  const asked = [];
  const bridge = new QqHarnessBridge({
    bot: { sendText: async (_target, text) => sent.push(text) },
    ownerUserOpenid: 'owner',
    guestAgentPreset: 'dsh-im-guest',
    accessPolicy: {
      getSettings: () => ({
        direct: { mode: 'allowlist', open: { defaultCanExecuteCommands: false, commandPermissionOverrides: [] }, allowlist: { users: [{ id: 'guest', canExecuteCommands: false }] } },
        group: { mode: 'allowlist', open: { defaultCanExecuteCommands: false, commandPermissionOverrides: [] }, allowlist: { users: [] } },
      }),
      isPrivileged: (ids) => [].concat(ids).includes('owner'),
      allowsGuestChat: () => true,
    },
    harness: {
      sessionExists: async () => false,
      createSession: async (options) => {
        created.push(options);
        return `session-${created.length}`;
      },
      ask: async (sessionId, text) => { asked.push({ sessionId, text }); return 'ok'; },
      workspaceSession: (sessionId) => ({
        ask: async (text) => { asked.push({ sessionId, text }); return 'ok'; },
        sessionExists: async () => true,
      }),
    },
    state: {
      hasSeen: () => false,
      markSeen: async () => {},
      sessionFor: () => undefined,
      setSession: async () => true,
      clearSession: async () => true,
    },
  });
  const message = (id, senderId) => ({
    kind: 'c2c', rawEventType: 'C2C_MESSAGE_CREATE', senderId, messageId: id, content: '你好',
    replyTarget: { scope: 'c2c', targetId: senderId, msgId: id },
  });
  await bridge.accept(message('guest-1', 'guest'));
  await bridge.accept(message('owner-1', 'owner'));
  const guestCreate = created.find((options) => options.agentPreset === 'dsh-im-guest');
  assert.ok(guestCreate, 'the guest session names the preset');
  const ownerCreate = created.find((options) => options.agentPreset === undefined);
  assert.ok(ownerCreate, 'the owner session keeps the bot preset');
});
