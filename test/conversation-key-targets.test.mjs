import assert from 'node:assert/strict';
import test from 'node:test';

import {
  conversationKeyMatchesTarget,
  deliverySuggestionFromConversationKey,
  privateConversationKeyMatchesTarget,
  privateDeliverySuggestionFromConversationKey,
  resolveConversationKey,
  resolvePrivateConversationKey,
} from '../plugin-src/host/delivery-suggestions.mjs';

const GROUP_TARGET = { kind: 'group', route: { groupOpenId: 'qq-group' } };
const PRIVATE_TARGET = { kind: 'user', route: { userOpenId: 'qq-user' } };

test('a QQ group key matches its own group target only', () => {
  const key = 'group:qq-group';
  assert.deepEqual(deliverySuggestionFromConversationKey('qq', key), GROUP_TARGET);
  assert.equal(conversationKeyMatchesTarget('qq', key, GROUP_TARGET), true);
  assert.equal(conversationKeyMatchesTarget('qq', key, PRIVATE_TARGET), false);
  assert.equal(conversationKeyMatchesTarget('qq', 'group:other-group', GROUP_TARGET), false);
  assert.equal(conversationKeyMatchesTarget('qq', key, { ...GROUP_TARGET, targetId: 'daily' }), true,
    'targetId and name are not part of the route identity');
  assert.equal(conversationKeyMatchesTarget('qq', key, {
    kind: 'group', route: { groupOpenId: 'another-group' },
  }), false);
});

test('Session sync resolves a group conversation key the same way as a private one', () => {
  const sessions = {
    'c2c:qq-user': 'session-private',
    'group:qq-group': 'session-group',
    'c2c:other-user': 'session-other',
  };
  assert.equal(resolveConversationKey('qq', sessions, GROUP_TARGET), 'group:qq-group');
  assert.equal(resolveConversationKey('qq', sessions, PRIVATE_TARGET), 'c2c:qq-user');
  assert.equal(resolveConversationKey('qq', sessions, {
    kind: 'group', route: { groupOpenId: 'unknown-group' },
  }), null, 'an unknown group cannot be enabled');
  assert.equal(resolveConversationKey('qq', {}, GROUP_TARGET), null);
  assert.equal(resolveConversationKey('unknown', sessions, GROUP_TARGET), null);
  assert.equal(resolveConversationKey('qq', null, GROUP_TARGET), null);
});

test('weixin private and QQ private routes resolve to their own conversations', () => {
  const weixinTarget = { kind: 'user', route: { toUserId: 'wx-user' } };
  assert.equal(
    resolveConversationKey('weixin', { 'p2p:wx-user': 'session-weixin' }, weixinTarget),
    'p2p:wx-user',
  );
  assert.equal(
    resolveConversationKey('weixin', { 'p2p:other': 'session-other' }, weixinTarget),
    null,
  );
});

test('the same id in a private chat and a group stays two distinct routes', () => {
  const sessions = {
    'c2c:qq-user': 'session-private',
    'group:qq-user': 'session-group',
  };
  assert.equal(resolveConversationKey('qq', sessions, PRIVATE_TARGET), 'c2c:qq-user');
  assert.equal(resolveConversationKey('qq', sessions, {
    kind: 'group', route: { groupOpenId: 'qq-user' },
  }), 'group:qq-user');
  assert.equal(privateConversationKeyMatchesTarget('qq', 'c2c:qq-user', PRIVATE_TARGET), true);
  assert.equal(conversationKeyMatchesTarget('qq', 'group:qq-user', PRIVATE_TARGET), false);
});

test('the private helpers stay private-chat only, as the target hints need', () => {
  assert.equal(privateDeliverySuggestionFromConversationKey('qq', 'group:qq-group'), null);
  assert.equal(privateConversationKeyMatchesTarget('qq', 'group:qq-group', GROUP_TARGET), false);
  assert.equal(resolvePrivateConversationKey('qq', {
    'group:qq-group': 'session-group',
    'c2c:qq-user': 'session-private',
  }, GROUP_TARGET), null);
  assert.equal(conversationKeyMatchesTarget('qq', 'c2c:qq-user', GROUP_TARGET), false);
});
