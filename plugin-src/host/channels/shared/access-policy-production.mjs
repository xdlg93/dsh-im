import {
  createAccessPolicy,
  createAccessPolicyScope,
} from '../../../../src/channels/shared/access-policy.mjs';

function policyUsers(users) {
  return users.map((id) => ({ id, canExecuteCommands: true }));
}

function openScope(allowlistUsers = []) {
  return createAccessPolicyScope({
    mode: 'open',
    open: {
      defaultCanExecuteCommands: true,
      commandPermissionOverrides: [],
    },
    allowlist: { users: policyUsers(allowlistUsers) },
  });
}

/** Reachable by anyone, but no command execution: only for a bot with no owner. */
function openScopeWithoutCommands() {
  return createAccessPolicyScope({
    mode: 'open',
    open: {
      defaultCanExecuteCommands: false,
      commandPermissionOverrides: [],
    },
    allowlist: { users: [] },
  });
}

function allowlistScope(users = []) {
  return createAccessPolicyScope({
    mode: 'allowlist',
    open: {
      defaultCanExecuteCommands: false,
      commandPermissionOverrides: [],
    },
    allowlist: { users: policyUsers(users) },
  });
}

function cleanIds(values) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .filter((value) => typeof value === 'string' || typeof value === 'number'
      || typeof value === 'bigint')
    .map((value) => String(value).trim())
    .filter(Boolean))];
}

/**
 * Build the one-time, backwards-compatible seed for a bot whose workspace
 * document does not yet contain an access policy.
 *
 * The default is the safe one for both channels: only the account that scanned
 * the bot may talk to it, and only allowlisted people may run commands. A chat
 * window reaches the Host's shell, files and Sessions, so "open to everyone"
 * must be a deliberate choice, never an upgrade default.
 */
export function initialAccessPolicyFor(channel, config = {}) {
  const key = String(channel ?? '').trim().toLowerCase();
  if (key === 'weixin') {
    return createAccessPolicy({
      direct: allowlistScope(),
      group: allowlistScope(),
    });
  }
  if (key === 'qq') {
    // The owner is a Host-only identity (privilegedSenderIdsFor), never copied
    // into the saved policy row, so the allowlist itself stays empty: the owner
    // still passes as a privileged sender, everyone else is refused.
    // The wildcard means "the previous build put no owner on this bot": keep the
    // old chat reachability but never grant command execution with it.
    const wildcard = cleanIds(config.ownerUserOpenid).includes('*');
    return createAccessPolicy({
      direct: wildcard ? openScopeWithoutCommands() : allowlistScope(),
      group: allowlistScope(),
    });
  }
  throw new TypeError(`Unsupported access-policy channel: ${channel}`);
}

/**
 * Seed newly connected bots after startup has migrated existing bots with
 * initialAccessPolicyFor(): the same owner-only allowlist, so a bot added today
 * cannot be driven by strangers. workspace ensure() preserves any saved policy.
 */
export function newBotAccessPolicyFor(channel, config = {}) {
  return initialAccessPolicyFor(channel, config);
}

export function privilegedSenderIdsFor(channel, config = {}) {
  const key = String(channel ?? '').trim().toLowerCase();
  if (key === 'weixin') return cleanIds(config.ownerUserId);
  if (key === 'qq') return cleanIds(config.ownerUserOpenid).filter((id) => id !== '*');
  return [];
}

export function accessPolicyProvider(workspaces, botId, { channel, config, equals } = {}) {
  if (!workspaces || typeof workspaces.accessPolicyFor !== 'function') {
    throw new TypeError('A workspace store with access policies is required');
  }
  const privilegedSenderIds = new Set(privilegedSenderIdsFor(channel, config));
  const sameSender = typeof equals === 'function' ? equals : (left, right) => left === right;
  return Object.freeze({
    botId,
    getSettings: () => workspaces.accessPolicyFor(botId),
    isPrivileged(senderIds, conversationType) {
      if (!['direct', 'group'].includes(conversationType)) return false;
      const candidates = Array.isArray(senderIds) ? senderIds : [senderIds];
      try {
        return candidates.some((senderId) => typeof senderId === 'string'
          && [...privilegedSenderIds].some((privilegedId) => (
            sameSender(senderId.trim(), privilegedId) === true
          )));
      } catch {
        return false;
      }
    },
  });
}
