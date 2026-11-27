import { evaluateAccessPolicy } from './access-policy.mjs';
import { isSharedLocalCommand } from './command-permission.mjs';

export const COMMAND_PERMISSION_DENIED_MESSAGE = '你可以发送普通消息，但没有执行命令的权限。请联系管理员在 DSH 设置 → IM机器人 → 对应机器人 → 访问设置中，为你开启当前私聊或群聊场景的命令权限后重试。';
/**
 * Shown to an allowlisted sender when guest chat is off.
 *
 * A plain message still starts an Agent turn, and tools such as `read` or
 * `web_fetch` run without an approval, so "allowed to chat" would hand a guest
 * the Host's files. Only the owner chats unless the bot opts in.
 */
export const GUEST_CHAT_DENIED_MESSAGE = '机器人默认只允许所有者对话：普通消息会驱动 Agent 调用读取类工具，无法按发送者隔离。请让所有者在「访问设置」里为该场景开启访客对话，或改用命令。';

const POLICY_NOT_CONFIGURED = Object.freeze({ allowed: true, reason: 'policy-not-configured' });
const PRIVILEGED_SENDER = Object.freeze({ allowed: true, reason: 'privileged-sender' });

/**
 * Read one committed policy snapshot and decide a single inbound event.
 * A missing provider is kept backward-compatible for direct bridge fixtures;
 * production always injects a provider, whose missing/damaged value fails closed.
 */
export function evaluateInboundAccess(accessPolicy, {
  conversationType,
  senderIds,
  text = '',
  hasImages = false,
  hasFiles = false,
  isCommand = isSharedLocalCommand(text, { hasImages, hasFiles }),
} = {}) {
  if (!accessPolicy) return POLICY_NOT_CONFIGURED;
  try {
    if (typeof accessPolicy.isPrivileged === 'function'
      && accessPolicy.isPrivileged(senderIds, conversationType) === true) {
      return PRIVILEGED_SENDER;
    }
  } catch {
    // A broken privilege lookup must not bypass the persisted policy.
  }
  let policy = null;
  try {
    policy = accessPolicy.getSettings();
  } catch {
    // Provider failures are equivalent to an unavailable persisted policy.
  }
  const decision = evaluateAccessPolicy(policy, {
    conversationType,
    senderIds,
    isCommand,
    ...(typeof accessPolicy.equals === 'function' ? { equals: accessPolicy.equals } : {}),
  });
  if (decision.allowed === true && isCommand !== true && !guestChatAllowed(accessPolicy)) {
    // A chat message starts a turn whose tools are not sandboxed per sender.
    return { allowed: false, reason: 'guest-chat-disabled' };
  }
  return decision;
}

/** Whether the bot lets an allowlisted (non-owner) sender start a chat turn. */
function guestChatAllowed(accessPolicy) {
  if (typeof accessPolicy?.allowsGuestChat !== 'function') return false;
  try {
    return accessPolicy.allowsGuestChat() === true;
  } catch {
    return false;
  }
}
