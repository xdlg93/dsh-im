# Proactive Delivery Guide

[简体中文](PROACTIVE_DELIVERY.md) · **English**

Proactive delivery lets an application send text through a bot connected to DSH-IM without a fresh user message. The caller only stores a stable `botId + targetId` pair — no Harness `sessionId`, chat reference, message ID, or temporary webhook.

Both the WeChat and QQ channels support proactive delivery.

## Quick start

1. Open **Settings → IM bots** and find the bot that should send the message.
2. Click the gear icon in the top-right corner of the bot card.
3. Copy the `Bot ID` from **Call identifier**.
4. Click **New target** and pick a past conversation, or use **Manual entry (advanced)** to supply the platform-native ID.
5. Fill in or confirm the `Target ID`, target type, and platform-native ID.
6. Click **Test**. Once the target receives the test message (in a Chinese interface: `DSH-IM 主动投递测试成功。`), click **Save target**.
7. On the saved target, click **Copy call parameters** to get the `{ botId, targetId }` pair your application should store.
8. Send messages with HTTP POST, the same-Host `ctx.dshIm.send()`, or the Connection RPC `message.send`.

## Configure a delivery target

### 1. Get the Bot ID

`botId` is the real call identifier of a connected bot. Copy it from the settings page and treat it as an opaque string: do not infer the channel from its prefix, and do not substitute the bot name, the platform App ID, or the masked ID shown on the card.

Targets are stored per bot. Removing a bot also clears its delivery targets; after re-adding it, copy the new `botId` and configure targets again.

### 2. Create a target

After clicking **New target**, the default view offers **Pick from past conversations**:

- Candidates come from that bot's persisted conversation mappings — not the platform address book, and not a strictly chronological list of recent conversations.
- Candidates carry only the target type and platform-native ID needed for delivery; they never include the Harness `sessionId`, message text, message IDs, conversation names, or last-activity times.
- An already-configured target shows **Added** and is disabled.
- With no candidates, send the bot a message on that platform first, then click **Refresh**. If it still does not appear, use **Manual entry (advanced)**.

Selecting a candidate only prefills the form; it never saves automatically.

### 3. Understand Target ID

`targetId` is a stable alias you define for the caller — not a platform user ID, group ID, or channel ID.

- It only has to be unique within one bot; different bots may reuse the same `targetId`.
- Allowed characters are letters, digits, dots, underscores, colons, `@`, and hyphens, with a length of 1–128.
- New targets default to `tgt_` plus 16 hex characters, for example `tgt_7f3a91c8d2e64b10`.
- You can change it before the first save, for example to `daily-report` or `release-alerts`.
- After saving, `targetId` is immutable, but the name, target type, and platform route can still change; callers keep using the original `botId + targetId`.

### 4. Test, save, and copy

Whether you create a target from a conversation, create one manually, or edit an existing one, the form shows a **Test** button at the bottom:

- The button is enabled only when the bot is online and every platform ID the current target type needs is filled in.
- The test uses the target type and platform IDs currently in the form; it does not create, update, or save the target first.
- After you change a tested platform ID, the previous success notice clears and you must test again.
- On a saved target, **Test** exercises the route currently stored for that target.
- A successful test means the platform send API accepted the request or the SDK returned successfully; it does not mean the message was read.

After saving, **Copy call parameters** copies JSON like this:

```json
{
  "botId": "bot_9577c8572d454122a4ef7fb4d8420a91",
  "targetId": "release-alerts"
}
```

### Example: a QQ alert group

Suppose the QQ bot has already been mentioned in the alert group:

1. Open the bot's settings page and copy the `Bot ID`.
2. Click **New target** and pick the alert group from the dropdown.
3. Change the generated `Target ID` to `release-alerts` and set the display name to "Release alerts".
4. Confirm the target type is **Group** and that the group Open ID is filled in.
5. Click **Test** and confirm the test message in the QQ group.
6. Click **Save target**, then **Copy call parameters**.

If you later edit the group Open ID, callers can keep using the same `botId + release-alerts` pair.

### Example: a WeChat DM reminder

WeChat only has DM targets:

1. Send the bot a message in WeChat so the plugin remembers the conversation.
2. Open the bot's settings page, copy the `Bot ID`, click **New target**, and pick that DM from the dropdown.
3. Change `Target ID` to `daily-reminder` and keep the target type as **Direct message**.
4. Click **Test**; once the test message arrives in WeChat, save the target and copy the call parameters.

WeChat proactive sends rely on the most recent `context_token` the bot received. After a long idle period a send may fail; have the target user send a message and retry.

## Two-way session sync

Session sync needs no pre-created target: the address comes from the Session's current chat binding — its conversation key in a connected chat (a WeChat DM, a QQ DM, or a QQ group). Whether to sync is decided by **General settings → Delivery**, which is the only switch; the **Delivery targets** page only serves manual delivery and the candidate scope for synced approvals and synced questions.

1. Ordinary questions and `/steer` in that chat keep using the normal reply path; the sync logic never resends or forwards them to another target.
2. When a Turn from another source finishes successfully, only the **final answer** is delivered — the text after the last tool call, not the concatenation of every step and not the chatter before the tool call. That covers Turns submitted in the Web GUI, scheduled tasks (`schedule`, `deliveryMode: host`), pending-question receipts, and internal notifications such as `subagent-settled`.
3. Whether the text typed in the Web UI is mirrored to the chat, and whether model answers are delivered, is decided by **General settings → Delivery**; the two prefix icons apply to mirrored input and model answers respectively.
4. Only text the reader submitted in the Web GUI is mirrored: Host-injected context snapshots, scheduled reminders, and internal notifications are never echoed, and only the model answer is delivered. If the mirror send fails, that Turn's answer is not delivered either.
5. Answers follow each channel's capability: QQ sends a Markdown message, WeChat sends full text, and a given answer reaches the chat exactly once. With both global switches off, mirroring and answers stop together because they read the same switches.
6. The address is read from the current binding before every delivery, so it follows `/session` switches and `/new` automatically. A Session with no binding delivers nothing and raises no error, but writes a log line without message text (Session, channel, and conversation key) so you can see why a chat received nothing.

Service injection never decides a Turn's origin: the context snapshot, scheduled reminders, and internal notifications the Host injects before each Turn only say "this is one message of this Turn" and never mark the Turn as service-initiated. A Turn counts as service-initiated only when none of its messages came from the reader (the Web UI or this chat); if even one message came from this chat, the chat answers that Turn itself and the sync logic delivers nothing.

The existing **Two-way session sync** switch on a target row now only affects the candidate scope for synced approvals and synced questions; it is no longer a prerequisite for session sync. That scope is still DM-only. The first version syncs text only, for the current Host: no images, files, cards, tool progress, approvals, or history. Channels with an explicit remote `harnessBaseUrl` are not supported either.

## Delivery settings

**General settings → Delivery** stores global settings, not per-bot ones, in `<dshHome>/integrations/dsh-im/delivery-sync-settings.json`:

```json
{
  "version": 1,
  "deliverySync": {
    "mirrorUserInput": false,
    "deliverModelAnswers": false,
    "inputIcon": "",
    "modelIcon": ""
  }
}
```

- `mirrorUserInput`: mirrors text submitted in the Web GUI into the chat bound to that Session; off by default. When off, input is not sent and model answers are still delivered.
- `deliverModelAnswers`: delivers the model answer of Turns that did not originate in this chat; off by default, matching input mirroring. A fresh install has both off, and an unreadable settings file is also treated as both off — the coordinator logs a single warning and never starts mirroring on its own.
- `inputIcon` / `modelIcon`: prefix icons for mirrored input and model answers. Leading and trailing whitespace is trimmed, the maximum is 32 characters, and multi-line or control characters are rejected; invalid values become an empty string, and an empty string adds no prefix. A non-empty icon produces "icon + blank line + text".

The local settings page reads and writes this file through `settings.delivery-sync.get` / `settings.delivery-sync.set` (`set` applies only the fields you pass, and all four are optional). The message language is switched through `settings.language.set` between "follow the DSH interface language" and `zh` / `en` / `ru`: an explicit choice outranks the DSH interface language, and the plugin's `language` option outranks both.

## Native fields for both channels

Prefer picking from past conversations. Only when the target is missing from the candidates do you need the platform-native IDs below.

| Channel | Target type | Field to fill in | Example or note |
| --- | --- | --- | --- |
| WeChat | `user` | WeChat user ID (`toUserId`) | The WeChat user ID that receives the message |
| QQ | `user` | User Open ID (`userOpenId`) | The platform's `user_openid` |
| QQ | `group` | Group Open ID (`groupOpenId`) | The platform's `group_openid` |

Platform ID strings must be non-empty and free of leading or trailing whitespace. A target accepts only the fields its channel and type require; extra fields are rejected.

## Send through HTTP POST

A plain external application can call the Host's proactive delivery endpoint directly:

```bash
curl --request POST \
  http://127.0.0.1:3080/api/dsh-im/delivery/messages \
  --header 'Content-Type: application/json' \
  --data '{
    "botId": "bot_9577c8572d454122a4ef7fb4d8420a91",
    "targetId": "release-alerts",
    "text": "The build has finished."
  }'
```

A successful response:

```json
{ "sent": true }
```

The body requires `botId`, `targetId`, and `text`, and accepts an optional `format` (`plain` or `markdown`, default `plain`); the whole JSON body may not exceed 1 MiB. Do not add platform routes, `sessionId`, `chatRef`, temporary webhooks, or `idempotencyKey`.

The path is fixed at `POST /api/dsh-im/delivery/messages` and reuses the current DSH Host WebServer, so it opens no extra port. The `3080` above is the default Web profile port; use whatever address the Host prints at startup.

The HTTP endpoint has no authentication and no CORS. Use it only on the local machine or a trusted network, and never expose it to the public internet.

## Send from a plugin in the same Host

A consumer plugin that declares the `dshIm` injection can call the shared service directly, without Connection RPC.

Here is a minimal example that sends one message when the plugin loads:

```js
export const inject = ['dshIm'];

export async function apply(ctx) {
  const result = await ctx.dshIm.send(
    'bot_9577c8572d454122a4ef7fb4d8420a91',
    'release-alerts',
    'The build has finished.',
  );

  if (result.sent !== true) {
    throw new Error('Proactive delivery did not report success');
  }
}
```

In practice, call `ctx.dshIm.send()` from your scheduled task, build callback, or business event handler. The optional fourth argument accepts a cancellation signal and a text format:

```js
await ctx.dshIm.send(botId, targetId, text, { signal }); // unchanged default behaviour
await ctx.dshIm.send(botId, targetId, '# Daily report\n\n**Checks passed**', {
  signal,
  format: 'markdown',
});
```

`format` accepts only `plain` and `markdown` and defaults to `plain`. HTTP and the `message.send` RPC accept the same field. Markdown reuses each channel's send path without starting a Session or a new stream:

| Channel | Markdown presentation |
| --- | --- |
| QQ | A Markdown message; a known format rejection falls back to text for that chunk only |
| WeChat | Full text, preserving code blocks and link targets |

Long messages are split per channel limit (WeChat keeps its 1,800-character budget). Fallbacks cover only local formatting errors or explicit format rejections; the plugin never resends a chunk that already succeeded and never changes format when the network result is unknown. An older Host may ignore `format`, so load the updated plugin.

The final assistant answer for session sync requests Markdown, while mirrored Web input uses plain text; both go through the normal delivery path using the Session's bound address.

A same-Host plugin can also list a bot's saved targets:

```js
const targets = await ctx.dshIm.listTargets(botId);
// [{ targetId, name?, kind, route }, ...]
```

A same-Host plugin can register a known conversation route as a delivery target. The `targetId` then works with `send` and appears in the settings page's target list. The example below uses a QQ DM, so `botId` must belong to a QQ bot:

```js
await ctx.dshIm.createTarget(botId, {
  targetId: 'release-alerts',
  kind: 'user',
  route: { userOpenId: 'A1B2C3D4E5F6' },
  name: 'Release reminders',     // optional
});
```

`kind` and `route` must match the bot's channel; see [native fields for both channels](#native-fields-for-both-channels). A QQ group uses `kind: 'group'` with `route: { groupOpenId: '...' }`; a WeChat DM uses `kind: 'user'` with `route: { toUserId: '...' }`.

An existing `targetId` is rejected with `target-conflict`; changing or deleting an existing target still goes through the management RPC's `target.update` / `target.delete`.

A same-Host plugin can discover configured bots through the same service:

```js
const bots = await ctx.dshIm.listBots();
// [{ botId, channel }, ...]
```

The result carries only stable public metadata — no credentials, platform routes, or target contents.

A failed call rejects the Promise; `error.code` uses the shared error codes listed later in this document.

## Send through Connection RPC

Connection RPC suits callers that already hold the current DSH Host `connection` client, and it is what the settings page uses to manage targets. Plain external applications should prefer the HTTP POST above.

First wrap the RPC success and error envelopes:

```js
const DELIVERY_CHANNEL = '/dsh-im-delivery';

async function callDelivery(connection, endpoint, payload, signal) {
  const result = await connection.rpc.call(
    DELIVERY_CHANNEL,
    endpoint,
    payload,
    signal,
  );

  if (result?.ok !== true) {
    const error = new Error(result?.error?.message || 'delivery-failed');
    error.code = result?.error?.code || 'delivery-failed';
    throw error;
  }
  return result.value;
}
```

Then send text with the copied `botId + targetId`:

```js
const result = await callDelivery(connection, 'message.send', {
  botId: 'bot_9577c8572d454122a4ef7fb4d8420a91',
  targetId: 'release-alerts',
  text: 'The build has finished.',
});

// result: { sent: true }
```

`message.send` accepts `{ botId, targetId, text, format? }`, where `format` is `plain` or `markdown`. Do not add platform routes, `sessionId`, `chatRef`, temporary webhooks, or `idempotencyKey`.

### Example: deliver a daily report

```js
async function sendDailyReport(connection, summary) {
  try {
    await callDelivery(connection, 'message.send', {
      botId: 'bot_9577c8572d454122a4ef7fb4d8420a91',
      targetId: 'daily-report',
      text: `Today's summary\n\n${summary}`,
    });
  } catch (error) {
    if (error.code === 'bot-not-connected') {
      // Decide in your own business logic whether to retry after reconnection.
      return { delivered: false, reason: 'offline' };
    }
    throw error;
  }
  return { delivered: true };
}
```

## Management RPC reference

The settings page manages targets through the same Connection RPC channel. Most callers only need `message.send`; use the other endpoints when you manage targets yourself.

Every response is either `{ ok: true, value }` or `{ ok: false, error: { code, message, details } }`.

| Endpoint | Payload | `value` on success |
| --- | --- | --- |
| `message.send` | `{ botId, targetId, text }` | `{ sent: true }` |
| `target.list` | `{ botId }` | `{ botId, channel, targets }` |
| `target.suggestion.list` | `{ botId }` | `{ botId, channel, suggestions }` |
| `target.create` | `{ botId, target: { targetId, name?, kind, route } }` | The created target |
| `target.update` | `{ botId, targetId, target: { name?, kind, route } }` | The updated target |
| `target.delete` | `{ botId, targetId }` | `{ deleted: true }` |
| `target.session-sync.set` | `{ botId, targetId, enabled }` | `{ enabled, state }`; only for the local settings page |
| `target.test` | `{ botId, targetId }` | `{ sent: true }` |
| `target.test` | `{ botId, target: { kind, route } }` | `{ sent: true }`; draft test, nothing saved |

Fields are validated strictly. The inner `target` of `target.update` must not contain `targetId`, and a draft test must not contain `targetId` or `name`. Each target returned by `target.list` carries a read-only `sessionSync: { enabled, state }`, where `state` is `off`, `active`, `waiting`, or `unavailable`; internal DM keys are never returned to the client.

## Error handling

HTTP failures use `{ "error": { "code", "message", "details" } }`. The same-Host service and RPC use identical codes without HTTP statuses.

| Error code | HTTP status | Meaning and suggested action |
| --- | --- | --- |
| `bad-request` | 400 | Invalid request shape, ID format, JSON, or text; check field names and remove extra fields |
| `unknown-bot` | 404 | `botId` does not belong to this Host; copy it again from the bot settings page |
| `unknown-target` | 404 | No such `targetId` under that bot; check the copy or whether the target was deleted |
| `target-conflict` | 409 | The same `targetId` already exists under this bot; choose another alias |
| `invalid-target` | 422 | Target type or platform ID violates the channel rules; re-select the type and verify the ID |
| `bot-not-connected` | 503 | The bot is offline; the caller decides whether to retry after reconnection |
| `target-rejected` | 422 | The platform explicitly rejected the target or the bot lacks send permission; check platform permissions and the target ID |
| `delivery-failed` | 502 | Network, platform, or another failure that cannot be safely classified; check connection state and Host logs |
| `session-sync-unavailable` | — | The target is not a verifiable DM on this Host, no current Session exists, or the channel uses a remote Harness; create the target from a past DM and establish a Session |
| `cancelled` | 408 | The call was cancelled; finish or restart it as your business requires |

The HTTP layer may also return `method-not-allowed` (405), `unsupported-media-type` (415), or `payload-too-large` (413).

## Delivery semantics and limits

- Proactive delivery sends non-empty text only; the interface cannot send images, files, cards, or rich text.
- The HTTP JSON body is limited to 1 MiB.
- `{ sent: true }` means the platform send API accepted the request or the SDK returned successfully; it promises neither final delivery nor a read receipt.
- DSH-IM stores no proactive delivery history, generates no `deliveryHandle` or `idempotencyKey`, and never retries automatically.
- Retrying after a caller timeout can duplicate a message; if you need idempotency, store your own business event IDs and outcomes.
- Real sends use only the saved `botId + targetId`. Platform-native routes live in the target configuration and should not travel with each message.
- One call sends to one target. To notify several targets, call once per target and handle each result.
- While a bot is offline you can still edit targets, but you cannot test or send.
- WeChat proactive delivery, connection tests, and deferred task results use the `context_token` of the corresponding user the bot most recently received a message from. That context lives only in the Host's account state, survives restarts, and is never stored in a delivery target or returned to callers; rebinding with new login credentials clears it. After an upgrade, the bot needs one inbound user message before the cache exists.
- Whether WeChat accepts a send still depends on iLink server rules. A healthy long poll does not guarantee proactive sends; if `ret=-2 prepare failed` persists, do not send heartbeats to extend the session. Have the target user send a message and retry. That error is neither proof of expired credentials nor proof that the context expired or the quota ran out.
- WeChat proactive long text keeps the 1,800-character budget, and Markdown code fences are closed in every chunk. Each chunk consumes a platform send; splitting does not lift platform quotas. On rejection or an uncertain result the plugin stops and reports failure without resending accepted chunks, and diagnostics name the failed chunk and the total.
- A failed WeChat proactive send stays in the account's last-message error with the platform error code and masked diagnostics such as whether context was attached. Health polling does not clear it; a later successful delivery does. HTTP/RPC still returns `delivery-failed` and never retries or drops the healthy long-poll connection.
- QQ proactive sends are subject to platform message quotas and file upload quotas; an exhausted quota returns an explicit error so the caller can retry later.

## HTTP and RPC reachability

The HTTP endpoint is registered only when the current Host provides a WebServer, and it uses that server's address and port. The default Web profile usually listens on `127.0.0.1:3080` and is reachable only locally. To call it from another machine, bind the WebServer to a reachable address in that profile's `cordis.patch.yml` and restart the Host:

```yaml
- id: webserver
  config:
    host: '0.0.0.0'
```

That also widens network reachability for every other page and route on the same WebServer. The proactive delivery endpoint has no authentication, so pair it with a trusted LAN, a firewall, or a reverse proxy — never expose it to the public internet.

Connection RPC allows loopback calls from the current Host by default. If the Web profile deliberately runs on a trusted LAN, reuse the existing Host authority in that profile's `cordis.patch.yml`:

```yaml
- id: xdlg93-dsh-im
  config:
    rpcAuthority: trusted-host
```

`trusted-host` is a Host/Origin reachability boundary, not user authentication. With it enabled, any caller that can reach that trusted authority can also reach the bot management interfaces; use it only on a trusted network.

## Troubleshooting

### The target conversation is missing from the dropdown

Send the bot a message on that platform first, then refresh the settings page. Candidates are not the platform's full conversation directory; if it still does not appear, use **Manual entry (advanced)**.

### The Test button is disabled

Confirm the bot is online and that every platform ID the current target type needs is filled in. A QQ group needs the group Open ID; a WeChat DM needs the WeChat user ID.

### Can Target ID be changed after saving?

No. You can edit the name, type, and platform route while keeping the call parameters unchanged; if you must change `targetId`, create a new target, switch the caller over, and then delete the old one.

### Why not use sessionId?

A `sessionId` identifies a Harness session, not a stable, platform-independent message address. Proactive delivery uses the stable combination of a bot and a saved target.

### The test succeeded, but the recipient cannot see the message

A successful test only proves the platform API accepted the send. Check bot permissions, platform limits, whether the target is correct, and any client-side message filtering or archiving.
