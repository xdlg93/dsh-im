/**
 * Decode a stored conversation key back into the parts a caller can reason
 * about: whether it is a private chat or a group, plus the ids inside it.
 *
 * The keys are written by the channels themselves, so this reader accepts the
 * shapes this fork ships and nothing else. It never invents a key: an unknown
 * or malformed string yields `null` and the caller treats the conversation as
 * unidentified.
 *
 * Known shapes:
 *   p2p:<userId>     Weixin private chat
 *   c2c:<openId>     QQ private chat
 *   group:<chatId>   QQ group chat
 */

/**
 * @typedef {Object} ParsedConversationKey
 * @property {'dm'|'group'} chatType
 * @property {?string} chatId
 * @property {?string} threadId Always null: no shipped channel threads a chat.
 * @property {?string} senderId
 */

const SEP = ':';

/** Everything before the first separator is the scope. */
function scopeOf(key) {
  const index = key.indexOf(SEP);
  return index === -1 ? key : key.slice(0, index);
}

function restOf(key) {
  const index = key.indexOf(SEP);
  return index === -1 ? '' : key.slice(index + 1);
}

/** `p2p:` and `c2c:` keys are written per sender by every channel that uses them. */
function dm(senderId) {
  return { chatType: 'dm', chatId: null, threadId: null, senderId: senderId || null };
}

function group(chatId) {
  return { chatType: 'group', chatId: chatId || null, threadId: null, senderId: null };
}

/**
 * Decode one conversation key.
 * @param {unknown} key stored conversation key
 * @returns {?ParsedConversationKey} parts, or null when the key is not ours
 */
export function parseConversationKey(key) {
  if (typeof key !== 'string' || key === '' || key.length > 1_024) return null;
  const scope = scopeOf(key);
  const rest = restOf(key);
  if (rest === '') return null;
  if (scope === 'p2p' || scope === 'c2c') return dm(rest);
  if (scope === 'group') return group(rest);
  return null;
}
