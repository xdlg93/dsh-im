import { weixinStageError } from './connection-error.mjs';
import { deferredStateAccess, normalizeDeferredState } from '../shared/deferred-state.mjs';
import { createSessionRingSupport, normalizePendingTitles, normalizeSessionRings } from '../shared/session-ring-support.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { weixinMessageTimestampMs } from './weixin-api.mjs';

const EMPTY_STATE = Object.freeze({
  version: 1,
  sessions: {},
  seenMessageIds: [],
  getUpdatesBuf: '',
  recentOutboundMessages: [],
});

// The recent-outbound ring exists to attribute a provider message id and to avoid
// echoing our own text; it does not need a month of chat history, so it keeps a
// small window. Bodies are stored in the account state file (0600) and this is
// the only place the plugin persists message text.
export const WEIXIN_RECENT_OUTBOUND_LIMIT = 20;
export const WEIXIN_RECENT_OUTBOUND_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const WEIXIN_RECENT_OUTBOUND_TEXT_LIMIT = 2_000;
export const WEIXIN_RECENT_OUTBOUND_MATCH_TOLERANCE_MS = 15_000;
const CONTEXT_TOKEN_LIMIT = 200;
// A context token only continues a conversation session; an unused one is stale.
const CONTEXT_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
// A proactive message that iLink refused because the conversation session had
// expired is worth keeping: the session reopens as soon as the recipient writes
// again, and the message is delivered then. The queue is bounded so a bot that
// nobody talks to cannot grow the state file without limit.
export const WEIXIN_OUTBOX_LIMIT = 50;
export const WEIXIN_OUTBOX_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const WEIXIN_OUTBOX_TEXT_LIMIT = 8_000;

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function timestamp(value) {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value;
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : null;
}

function sequence(value) {
  const text = typeof value === 'string' ? value : Number.isSafeInteger(value) ? String(value) : '';
  return /^\d+$/.test(text) ? BigInt(text).toString() : null;
}

function normalizeContextTokens(value) {
  if (!value || typeof value !== 'object' || !/^[a-f0-9]{64}$/.test(value.credentialHash ?? '')) return undefined;
  const users = Object.create(null);
  const now = Date.now();
  for (const [userId, entry] of Object.entries(value.users ?? {}).slice(-CONTEXT_TOKEN_LIMIT)) {
    if (!nonEmptyString(userId) || !nonEmptyString(entry?.token)) continue;
    // Drop tokens nothing has refreshed for a week: they cannot open a session.
    if (Number.isFinite(entry?.receivedAt) && now - entry.receivedAt > CONTEXT_TOKEN_TTL_MS) continue;
    users[userId] = {
      token: entry.token,
      seq: sequence(entry.seq),
      messageTimeMs: timestamp(entry.messageTimeMs),
      receivedAt: timestamp(entry.receivedAt),
    };
  }
  return { credentialHash: value.credentialHash, users };
}

function normalizeOutbox(value, now = Date.now()) {
  if (!Array.isArray(value)) return [];
  const entries = [];
  for (const entry of value) {
    const id = nonEmptyString(entry?.id);
    const toUserId = nonEmptyString(entry?.toUserId);
    const text = typeof entry?.text === 'string' ? entry.text : '';
    const createdAt = timestamp(entry?.createdAt);
    if (!id || !toUserId || !text.trim() || createdAt === null) continue;
    if (now - createdAt > WEIXIN_OUTBOX_TTL_MS) continue;
    entries.push({
      id,
      toUserId,
      text: text.slice(0, WEIXIN_OUTBOX_TEXT_LIMIT),
      format: entry?.format === 'markdown' ? 'markdown' : 'plain',
      createdAt,
      attempts: Number.isSafeInteger(entry?.attempts) && entry.attempts >= 0 ? entry.attempts : 0,
      lastError: nonEmptyString(entry?.lastError),
    });
  }
  // Oldest first: delivery order is the order the caller asked for. The sort is
  // stable, so messages queued in the same millisecond keep their queue order.
  entries.sort((left, right) => left.createdAt - right.createdAt);
  return entries.slice(-WEIXIN_OUTBOX_LIMIT);
}

function providerMessageIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((id) => (id === undefined || id === null ? null : nonEmptyString(String(id))))
    .filter(Boolean))];
}

function truncateText(value) {
  const text = nonEmptyString(value);
  return text ? [...text].slice(0, WEIXIN_RECENT_OUTBOUND_TEXT_LIMIT).join('') : null;
}

function normalizeRecentOutboundMessage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const toUserId = nonEmptyString(value.toUserId);
  const text = truncateText(value.text);
  const sentAt = timestamp(value.sentAt);
  const completedAt = timestamp(value.completedAt) ?? sentAt;
  if (!toUserId || !text || sentAt === null || completedAt === null) return null;
  return {
    toUserId,
    text,
    sentAt,
    completedAt: Math.max(sentAt, completedAt),
    providerMessageIds: providerMessageIds(value.providerMessageIds),
  };
}

function recentOutboundMessages(value, now = Date.now()) {
  if (!Array.isArray(value)) return [];
  const cutoff = now - WEIXIN_RECENT_OUTBOUND_TTL_MS;
  return value
    .map(normalizeRecentOutboundMessage)
    .filter((entry) => entry && entry.completedAt >= cutoff)
    .slice(-WEIXIN_RECENT_OUTBOUND_LIMIT);
}

function normalizeState(value) {
  if (!value || typeof value !== 'object') return structuredClone(EMPTY_STATE);
  const sessions = {};
  if (value.sessions && typeof value.sessions === 'object' && !Array.isArray(value.sessions)) {
    for (const [key, sessionId] of Object.entries(value.sessions)) {
      if (typeof key === 'string' && typeof sessionId === 'string' && sessionId) {
        sessions[key] = sessionId;
      }
    }
  }
  const contextTokens = normalizeContextTokens(value.contextTokens);
  // A file written before the navigation ring existed loads unchanged: the keys
  // are only added when they hold something.
  const rings = normalizeSessionRings(value.rings);
  const pendingTitles = normalizePendingTitles(value.pendingTitles);
  return {
    version: 1,
    sessions,
    ...(value.deferred ? { deferred: normalizeDeferredState(value.deferred) } : {}),
    seenMessageIds: Array.isArray(value.seenMessageIds)
      ? value.seenMessageIds.filter((id) => typeof id === 'string').slice(-1_000)
      : [],
    getUpdatesBuf: typeof value.getUpdatesBuf === 'string' ? value.getUpdatesBuf : '',
    recentOutboundMessages: recentOutboundMessages(value.recentOutboundMessages),
    ...(contextTokens ? { contextTokens } : {}),
    ...(normalizeOutbox(value.outbox).length ? { outbox: normalizeOutbox(value.outbox) } : {}),
    ...(Object.keys(rings).length ? { rings } : {}),
    ...(Object.keys(pendingTitles).length ? { pendingTitles } : {}),
  };
}

export class WeixinStateStore {
  #path;
  #state = structuredClone(EMPTY_STATE);
  #writeQueue = Promise.resolve();
  #deferred = deferredStateAccess(() => this.#state, () => this.#persist());

  constructor(path) {
    this.#path = path;
    // The navigation ring is a view over this store's state, shared with the
    // channels that inherit `ConversationStateStore`.
    Object.assign(this, createSessionRingSupport({
      state: () => this.#state,
      persist: () => this.#persist(),
    }));
  }
  async load() {
    try {
      this.#state = normalizeState(JSON.parse(await readFile(this.#path, 'utf8')));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw weixinStageError('account-state-read-failed', error);
      this.#state = structuredClone(EMPTY_STATE);
      await this.#persist();
    }
    return this;
  }

  deferredEntries() { return this.#deferred.entries(); }
  putDeferred(entry) { return this.#deferred.put(entry); }
  patchDeferred(id, patch) { return this.#deferred.patch(id, patch); }
  removeDeferred(id) { return this.#deferred.remove(id); }

  // Context belongs to this bot login, not to a Harness session or workspace.
  async bindContextTokens(token) {
    const credentialHash = createHash('sha256').update(token).digest('hex');
    if (this.#state.contextTokens?.credentialHash === credentialHash) return;
    this.#state.contextTokens = { credentialHash, users: Object.create(null) };
    await this.#persist();
  }

  contextTokenFor(userId) {
    return this.#state.contextTokens?.users?.[userId]?.token ?? undefined;
  }

  /**
   * Queue one proactive message that the platform refused because the
   * conversation session had expired. The queue is per recipient and ordered.
   */
  async enqueueOutbox({ toUserId, text, format = 'plain', reason = null }) {
    const recipient = nonEmptyString(toUserId);
    const body = typeof text === 'string' ? text.slice(0, WEIXIN_OUTBOX_TEXT_LIMIT) : '';
    if (!recipient || !body.trim()) throw new TypeError('toUserId and text are required');
    const entry = {
      id: randomUUID(),
      toUserId: recipient,
      text: body,
      format: format === 'markdown' ? 'markdown' : 'plain',
      createdAt: Date.now(),
      attempts: 1,
      lastError: nonEmptyString(reason),
    };
    const entries = [...normalizeOutbox(this.#state.outbox), entry].slice(-WEIXIN_OUTBOX_LIMIT);
    this.#state.outbox = entries;
    await this.#persist();
    return { ...entry, pending: entries.filter((item) => item.toUserId === recipient).length };
  }

  /** Queued proactive messages, oldest first; omit `toUserId` for every recipient. */
  listOutbox(toUserId = undefined) {
    const entries = normalizeOutbox(this.#state.outbox);
    const recipient = nonEmptyString(toUserId);
    return structuredClone(recipient ? entries.filter((entry) => entry.toUserId === recipient) : entries);
  }

  /** Drop one queued message, or every message of one recipient. */
  async removeOutbox({ id = undefined, toUserId = undefined } = {}) {
    const entries = normalizeOutbox(this.#state.outbox);
    const target = nonEmptyString(id);
    const recipient = nonEmptyString(toUserId);
    const kept = entries.filter((entry) => {
      if (target) return entry.id !== target;
      if (recipient) return entry.toUserId !== recipient;
      return false;
    });
    const removed = entries.length - kept.length;
    if (removed === 0) return 0;
    if (kept.length) this.#state.outbox = kept;
    else delete this.#state.outbox;
    await this.#persist();
    return removed;
  }

  async rememberContextToken({ userId, contextToken, seq, messageTimeMs }) {
    if (!nonEmptyString(userId) || !nonEmptyString(contextToken) || !this.#state.contextTokens) return;
    const users = this.#state.contextTokens.users;
    const previous = users[userId];
    const next = { token: contextToken, seq: sequence(seq), messageTimeMs: timestamp(messageTimeMs), receivedAt: Date.now() };
    // Late/duplicate batches must not replace a newer conversation capability.
    if (previous) {
      if (previous.seq !== null && next.seq !== null && BigInt(next.seq) <= BigInt(previous.seq)) return;
      if (previous.messageTimeMs !== null && next.messageTimeMs !== null
        && next.messageTimeMs < previous.messageTimeMs) return;
    }
    delete users[userId];
    users[userId] = next;
    const keys = Object.keys(users);
    if (keys.length > CONTEXT_TOKEN_LIMIT) delete users[keys[0]];
    await this.#persist();
  }

  sessionFor(key) {
    return this.#state.sessions[key] ?? null;
  }

  async setSession(key, sessionId) {
    this.#state.sessions[key] = sessionId;
    await this.#persist();
  }

  async clearSession(key) {
    delete this.#state.sessions[key];
    await this.#persist();
  }

  async clearSessions() {
    this.#state.sessions = {};
    await this.#persist();
  }

  hasSeen(messageId) {
    return this.#state.seenMessageIds.includes(messageId);
  }

  async markSeen(messageId) {
    if (this.hasSeen(messageId)) return;
    this.#state.seenMessageIds.push(messageId);
    if (this.#state.seenMessageIds.length > 1_000) {
      this.#state.seenMessageIds.splice(0, this.#state.seenMessageIds.length - 1_000);
    }
    await this.#persist();
  }

  getUpdatesBuf() {
    return this.#state.getUpdatesBuf;
  }

  async setGetUpdatesBuf(value) {
    if (typeof value !== 'string' || value === this.#state.getUpdatesBuf) return;
    this.#state.getUpdatesBuf = value;
    await this.#persist();
  }

  async rememberOutboundMessage({
    toUserId,
    text,
    sentAt = Date.now(),
    completedAt = Date.now(),
    providerMessageIds: messageIds = [],
  } = {}) {
    const entry = normalizeRecentOutboundMessage({
      toUserId,
      text,
      sentAt,
      completedAt,
      providerMessageIds: messageIds,
    });
    if (!entry) throw new TypeError('Invalid Weixin outbound message');
    this.#state.recentOutboundMessages = recentOutboundMessages([
      ...this.#state.recentOutboundMessages,
      entry,
    ]);
    await this.#persist();
  }

  recentOutboundTextFor({
    toUserId,
    messageId,
    createTimeMs,
    updateTimeMs,
    now = Date.now(),
  } = {}) {
    const recipient = nonEmptyString(toUserId);
    if (!recipient) return null;
    const active = recentOutboundMessages(this.#state.recentOutboundMessages, now)
      .filter((entry) => entry.toUserId === recipient);
    const quotedMessageId = messageId === undefined || messageId === null
      ? null
      : nonEmptyString(String(messageId));
    if (quotedMessageId) {
      const exact = active.filter((entry) => entry.providerMessageIds.includes(quotedMessageId));
      if (exact.length === 1) return exact[0].text;
      if (exact.length > 1) return null;
    }
    const quotedTimes = [
      timestamp(createTimeMs),
      timestamp(updateTimeMs),
      weixinMessageTimestampMs(quotedMessageId, { now }),
    ]
      .filter((value) => value !== null);
    if (quotedTimes.length === 0) return null;
    const candidates = active.filter((entry) => quotedTimes.some((quotedAt) => (
      quotedAt >= entry.sentAt - WEIXIN_RECENT_OUTBOUND_MATCH_TOLERANCE_MS
        && quotedAt <= entry.completedAt + WEIXIN_RECENT_OUTBOUND_MATCH_TOLERANCE_MS
    )));
    return candidates.length === 1 ? candidates[0].text : null;
  }

  snapshot() {
    const { contextTokens, ...state } = this.#state;
    return structuredClone(state);
  }

  async remove() {
    try {
      await unlink(this.#path);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw weixinStageError('account-state-cleanup-failed', error);
    }
    this.#state = structuredClone(EMPTY_STATE);
  }

  async #persist() {
    const snapshot = `${JSON.stringify(this.#state, null, 2)}\n`;
    const operation = this.#writeQueue.then(async () => {
      await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
      const temporary = `${this.#path}.tmp`;
      await writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, this.#path);
    });
    this.#writeQueue = operation.then(() => undefined, () => undefined);
    await operation.catch(error => { throw weixinStageError('account-state-write-failed', error); });
  }
}
