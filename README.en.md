# dsh-im: WeChat and QQ for DeepSeek Harness

Scan a QR code in the DSH settings page and you can talk to your local DeepSeek Harness from WeChat or QQ: send messages, run tasks, approve actions, and read results in the chat window you already use.

> **About this repository**
>
> This project is a fork of [xmanrui/dsh-im](https://github.com/xmanrui/dsh-im) **5.10.0**, distributed under the MIT License. Copyright for the upstream work belongs to xmanrui and its contributors.
>
> This fork ([xdlg93/dsh-im](https://github.com/xdlg93/dsh-im), maintained by xdlg93) **keeps only the WeChat and QQ QR-code channels**. Code, UI, and documentation for every other channel have been removed. The upstream attribution and the full MIT text are in [LICENSE](LICENSE); third-party components are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Contents

- [What this fork changes](#what-this-fork-changes)
- [Supported channels](#supported-channels)
- [Compatibility](#compatibility)
- [Installation](#installation)
- [Getting started: WeChat](#getting-started-wechat)
- [Getting started: QQ](#getting-started-qq)
- [Shared capabilities](#shared-capabilities)
- [How it works](#how-it-works)
- [Data and privacy](#data-and-privacy)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License and credits](#license-and-credits)

## What this fork changes

Upstream dsh-im bundles a dozen IM platforms into one settings page, and its code and documentation grew with them. This fork is a deliberate trim:

| Change | Detail |
| --- | --- |
| Two channels only | WeChat and QQ. Host code, client UI, tests, and docs for every other channel are deleted, with no hidden entries or half-finished code left behind. |
| QR onboarding only | Both channels are onboarded by scanning a QR code; the per-platform credential forms, app manifests, and permission-repair flows are gone. |
| Rewritten docs | README, CHANGELOG, and the proactive-delivery guide describe only what actually ships. |
| Shared features intact | Session sync, group history, context enhancement, proactive delivery, model and workspace settings, and the rest of the shared feature set are unchanged. |

If you need Feishu, DingTalk, WeCom, Telegram, Slack, Discord, WhatsApp, Matrix, iMessage, or email, use the [upstream project](https://github.com/xmanrui/dsh-im).

## Supported channels

| Channel | Onboarding | Messaging |
| --- | --- | --- |
| **WeChat** | Scan with the mobile WeChat app (Tencent iLink) | iLink long polling; a typing indicator while Harness works, final replies split at 1,800 characters |
| **QQ** | Scan and authorize with the mobile QQ app | Official WebSocket connection; a typing indicator and a single Markdown reply in DMs, final answer only when mentioned in a group |

Both channels support:

- multiple bots per channel, each with independent connection state, workspace, model, and session bindings;
- QR onboarding, account management, DM policies plus QQ group policies, context enhancement, session title prefixes, proactive delivery, model settings, and workspace binding;
- image and file transfer in both directions, QQ group history, queueing and interjection, interactive questions, and remote approvals;
- bot messages in Simplified Chinese, English, and Russian, following the DSH interface language.

## Compatibility

| Item | Requirement |
| --- | --- |
| DeepSeek Harness | **0.2.2-rc.5 or newer** (`dsh.compatibility.dsh` in `package.json`) |
| Node.js | 22.19 or newer |
| Runtime profile | `web` (declared in `dsh.compatibility.profiles`); DSH Desktop uses the same plugin, see the install commands below |

The plugin declares only the host versions it has actually been verified against; it makes no promises about untested future releases. After upgrading, restart the Host and refresh the page so the Host and client load the same plugin version.

## Installation

This package is **not published to npm yet**; install it from the Git repository (pinned to a tag) or from the plugin index.

**From the plugin index (recommended)** — Settings → Plugins → Discover → add an index source and paste:

```
https://xdlg93.github.io/dsh-im/index.json
```

Then install "DSH IM bots (WeChat + QQ)" from the results. Until Pages is live, the same document is served raw at
`https://raw.githubusercontent.com/xdlg93/dsh-im/main/docs/index.json`.

**From Git** — run this in the terminal that starts your Harness, then restart `dsh web` and refresh the browser:

```sh
dsh plugin --profile web install git+https://github.com/xdlg93/dsh-im.git#v1.3.1
```

**DSH Desktop** — run this in Desktop's built-in terminal, then quit and reopen Desktop:

```sh
dsh plugin --profile desktop install git+https://github.com/xdlg93/dsh-im.git#v1.3.1
```

`--profile` must name the profile you actually run; `add` works as a synonym for `install`. Swap `#v1.3.1` for
another tag (or drop it to follow `main`) to upgrade or roll back.

### When the network blocks github.com

Both the plugin index and the Git command make `pnpm` run `git clone` against github.com directly. That step
**does not go through the npm registry and does not use npm's proxy settings**, so a blocked network fails with
`fatal: unable to access 'https://github.com/xdlg93/dsh-im.git/': Recv failure: Connection was reset`.

Three ways out, any one is enough:

**1) Give the DSH process a proxy** — git children inherit `HTTPS_PROXY`. With systemd:

```sh
sudo systemctl edit dsh-web
# add inside the editor:
#   [Service]
#   Environment=HTTPS_PROXY=http://127.0.0.1:7890
#   Environment=HTTP_PROXY=http://127.0.0.1:7890
sudo systemctl restart dsh-web
```

Starting it by hand with `HTTPS_PROXY=http://127.0.0.1:7890 dsh web` works the same way.

**2) Point git at the proxy** (git only):

```sh
git config --global http.proxy http://127.0.0.1:7890
# undo: git config --global --unset http.proxy
```

**3) Install from the release tarball** — no git, no npm account, only `xdlg93.github.io`:

```sh
dsh plugin --profile web add https://xdlg93.github.io/dsh-im/pkg/dsh-im-1.3.1.tgz
```

Every release leaves `docs/pkg/dsh-im-<version>.tgz` behind, and the URL follows the same rule. The plugin's
"check for updates" keeps reading the plugin index; update a tarball install by repeating that command.

**From the DSH UI** — ask the agent to install the same Git address through `plugin_manager install_bundle`, or add it to the profile's `package.json` yourself. Either way, restart the Host when the install finishes.

**Local development / link install** — clone the repository and install the absolute path into your profile; rebuild after editing:

```sh
git clone https://github.com/xdlg93/dsh-im.git
cd dsh-im
npm install
npm run build
dsh plugin --profile web add "$(pwd)"
```

A local directory is recorded as a `link:` dependency in the profile; rebuild and restart the Host to pick up changes.

Once installed and restarted, open **Settings → IM bots**. You should see the **WeChat** and **QQ** tabs in the left rail. The plugin registers a single "IM bots" entry in the DSH settings menu, and DSH builds that support sidebar panels also show an entry with the same name in the left sidebar.

## Getting started: WeChat

The WeChat channel uses Tencent iLink QR login. After binding, that WeChat account acts as the bot that exchanges messages with Harness.

1. Open **Settings → IM bots → WeChat**.
2. Click **Scan to add bot** and wait for the QR code (it is issued by Tencent's iLink service).
3. Scan the code with the mobile WeChat app.
4. Confirm the connection on your phone.
5. If the page asks for a pairing code, enter **the number shown in WeChat** — an extra safety step. The pairing code is used only for this login attempt and is never written to config or logs.
6. Wait for "WeChat confirmed, starting the message connection". Credentials go straight to the local Harness Host; the browser never receives `bot_token`.
7. Send a message to the bot in WeChat and start working.

Notes:

- QR codes expire. Click **Regenerate QR code** (or **Use another QR code**) to get a new one; one failed login does not affect accounts that are already bound.
- Each WeChat account is its own card, with independent alias, workspace, model, Agent Preset, and access policy.
- WeChat is direct-message only today: the group section says the channel does not support groups, and saving DM settings preserves any existing group policy.
- Click **Remove** on a card to stop the connection and delete the local `bot_token`, account config, and session mappings for that account only.

## Getting started: QQ

The QQ channel creates or binds a bot through `@tencent-connect/qqbot-connector` QR authorization, then talks to the platform over a `@tencent-connect/qqbot-nodejs` WebSocket connection.

1. Open **Settings → IM bots → QQ**.
2. Click **Scan to add bot** and wait for the QR code.
3. Scan the code with the mobile QQ app.
4. Confirm creating or binding the bot on Tencent's authorization page. The QR code refreshes on its own, and you can click **Regenerate QR code** if it expires.
5. On success the page shows "QQ authorized, connecting the bot"; credentials are stored locally and the message connection starts.
6. Once configured, **mention the bot** in QQ, or just message it in a DM.

Notes:

- Group chats only respond when the bot is mentioned; ordinary group messages do not trigger an answer. DMs respond directly.
- Sending files from QQ is subject to the platform's daily upload quota; when it runs out the plugin says so and asks you to retry later.
- You can bind several QQ bots; each card keeps its own workspace, model, and access policy.

## Shared capabilities

Both channels share one feature set. Everything is configured in the matching tab under **Settings → IM bots**.

### Sessions and workspaces

- Each bot card shows the current Harness workspace. Type an absolute path or open the directory picker to switch. Switching only clears that bot's chat mappings; it never deletes, clears, or archives old sessions.
- A new bot's default Workspace is a `dsh-im` directory **beside** your DSH Workspace (a Workspace at `/home/me/DSH/workspace` gets `/home/me/DSH/dsh-im`), so bot files never land in the Workspace you work in; a Host with no registered Workspace (headless, CLI) keeps `$DSH_HOME/im` (`~/.dsh/im` when `DSH_HOME` is unset). The directory is created only when something actually uses it, and new sessions appear under "Ungrouped".
- In chat, `/sessionlist` lists sessions and `/session <ID or index>` binds one; `/new` starts a fresh session on the next message.
- Optional Agent Preset grouping: set `groupByAgentPreset: true` in the plugin config and new sessions land in `presets/<preset-id>` workspaces. See [the configuration notes](docs/preset-workspaces.md).

### Group history (QQ)

QQ saves the group messages and attachments it actually receives, including non-mentioned messages the platform allows. Saving never triggers a model reply; mention the bot in the group to query the history, summarize a discussion, or read a file.

History is shared per group and independent of bots and workspaces. It rolls off after 14 days by default; change it under **General settings → General → Group history retention**. Only received content is stored — the plugin never backfills full history. See [Group message history and shared files](docs/group-history.en.md).

### Context enhancement

Open **Context enhancement** on a bot card to configure group and direct chats separately: enable switches, source fields, and guidance text, applied atomically on save. Available fields are `channel`, `conversationType`, `senderId`, `senderName`, `conversationTitle`, `chatId`, `threadId`, and `botId`, with only `senderId` on by default. The plugin sends only the values selected for the current scope that the incoming message actually carries; it never calls a platform API to fill gaps. See [Context enhancement](docs/context-enhancement.md).

### Access policies

- **Direct messages**: all users by default, or "allowlisted users only". The allowlist stores platform user IDs; once saved, other users cannot use the bot.
- **Group chats** (QQ): group allowlists and a default command permission can be set separately. A QR-scanned DM identity is exempt only when it matches the confirmed owner; other members follow the group allowlist.
- **Command permissions**: allowlisted users can be given individual command tiers.

### Queueing and interjection

On a bot card, open **More settings → General** and choose how new messages are handled while a task runs:

- **Queue (default)**: the new message waits until the current task finishes, with a queue notice if the wait is noticeable;
- **Interject**: plain-text messages join the running task as extra instructions that the agent reads on its next step.

With no running task, messages start a new task as usual; images, files, and quoted messages keep their existing handling. `/steer <text>` works in both modes.

### Proactive delivery

Proactive delivery lets an external app send text through a connected bot without a fresh user message. The caller only stores a stable `botId + targetId` — no `sessionId`, chat reference, or temporary webhook. The settings page can pick a target from past conversations, test the route before saving, and copy the call parameters, and the same target configuration serves HTTP POST, the same-Host `ctx.dshIm.send()` service, and Connection RPC.

The assistant can also push directly: `dsh_im_targets` lists the configured targets and `dsh_im_send` delivers text to one `botId + targetId`, with no external script.

WeChat has one platform limit worth knowing: iLink only accepts a send while the conversation session is open, and answers `errcode -14` once it expires. Such a message is not lost — it is queued in the account state and delivered in order when the recipient writes to the bot again, and the caller receives `queued: true` instead of `sent: true`.

Fields, examples, management endpoints, error codes, and troubleshooting are in the [proactive delivery guide](PROACTIVE_DELIVERY.en.md) ([简体中文](PROACTIVE_DELIVERY.md)).

### Session sync

After saving a direct-message delivery target, you can turn on **two-way session sync** (off by default). Text you submit in the DSH Web UI or CLI for that DM's current session, and the final answer, are mirrored back into the DM; scheduled tasks also deliver their final answer on success. The switch follows the current session across `/session`, `/new`, and workspace changes, and the chat's own questions and `/steer` are never duplicated. The first version syncs text only, for the current Host, in DMs — no images, files, cards, or tool progress.

### Models and reasoning effort

Every bot card can pick any model the Host currently offers, plus the reasoning effort that model supports, or follow the Host default. Settings are stored per bot and apply only to new sessions: send `/new` and then a normal message to use the new choice. In chat, `/models`, `/model`, and the `/reasoning` family inspect and switch the current session.

### Session title prefixes

IM sessions are marked at the source: the Web session list and search show a "WeChat ·" or "QQ ·" prefix rendered as the channel logo, while the original title and DSH's automatic title rules stay untouched. If the icon fails to load or the page structure does not match, the plugin falls back to the text prefix.

### Sidebar entry

DSH builds with the global panel list show an **IM bots** entry in the left sidebar that opens the full management panel. **Settings → IM bots** and the plugin detail page's "Open IM bots" action remain available. Host plugins can also embed the panel through the optional `dshImClient` client service; see [client panel integration](docs/client-integration.md).

### Languages

Bot messages and command help follow the DSH interface language and ship in **Simplified Chinese, English, and Russian**, with Chinese as the final fallback. Switch the DSH language under **Settings → General → Language** and bot messages change from the next message, with no restart or reconnect. A bot's message language can also be pinned in the settings page (follow DSH / Chinese / English / Russian), and the plugin's `language` option takes precedence over both.

### Bot commands

Send commands in chat to manage sessions; the full list is in [Command details](docs/bot-commands.md).

| Command | Purpose |
| --- | --- |
| `/help` | Show available commands and usage. |
| `/menu`, `/m` | QQ: open the button and numeric menu (sessions, workspace, preset, model, status). |
| `/new [title]` | Clear this chat's binding so the next message starts a fresh session. |
| `/sessionlist`, `/sessions` | List sessions and mark the bound one. |
| `/session <ID, index, or title>` | Bind this chat to an existing session. |
| `/status` | Check the bot's connection to Harness. |
| `/version` | Show the running plugin version. |
| `/models`, `/model` | Inspect and switch available models and reasoning effort. |
| `/reasoning`, `/reasoninglist` | Inspect and switch the current model's reasoning effort. |
| `/presetlist`, `/preset` | Inspect and set this bot's Agent Preset. |
| `/workspace`, `/ws` | Inspect and switch the bot workspace. |
| `/conv` | Give this conversation its own workspace. |
| `/stop` | Stop the task running in this chat. |
| `/steer <text>` | Add an instruction to the running task. |
| `/compact`, `/clear`, `/reset` | Compact, clear, or reset the current session context. |
| `/history [count]` | Show recent messages in a DM. |
| `/batch`, `/send`, `/cancel` | DM batch input: collect up to 10 text messages and submit them together. |

Interactive questions accept an option number, the option text, or free-form text (comma-separate multiple choices). Approvals accept "approve", "reject", "yes", or "no" (Chinese equivalents also work). Web and chat can both handle the same approval; the first submission wins and the other side is invalidated.

### Images and files

- **Image input**: JPEG, PNG, WebP, and GIFs sent as image files can accompany text. By default each original image may be up to 30 MB and a message up to 20 images; originals are stored in the session workspace and the model copy is scaled to 5 MB per image and 20 MB total. Oversized images or models without vision support receive the file instead. All four limits live under **General settings → Attachments → Image input**.
- **File input**: files sent in chat are stored in the session workspace and handed to Harness.
- **Result delivery**: files Harness can read are sent back as native attachments; images are preferred as native image messages and fall back to file attachments when the channel rejects them. What actually sends depends on platform permissions and quotas.

### Multiple bots and connection management

A channel can host several bots, each with its own credentials, connection state, workspace, model, Agent Preset, and session mappings. While a bot is online, **Check connection** sends a test message to its most recent DM (no session, no model call); when offline the action becomes **Reconnect**; **Remove** affects only the selected bot.

## How it works

A conversation goes roughly like this:

1. **Onboarding**: the settings page requests a QR code from the platform; after confirmation the credentials land in the local Host credential store, and the plugin starts a long-lived connection with automatic reconnects.
2. **Inbound**: the platform pushes a message, the channel bridge parses text, quotes, images, and files, applies the direct/group policy, and hands the result to the shared `TextHarnessBridge`.
3. **Execution**: the bridge submits to the bound Harness session (or creates one from the workspace, Agent Preset, and model settings), translating approvals, questions, and tool progress into something the platform can render.
4. **Outbound**: the answer goes back to the same chat, split or converted to Markdown as the platform requires; tasks that outlive the front-end timeout keep running through deferred delivery and post their final text when done.

Both channels share the session binding, command, context enhancement, group history, delivery, and approval logic under `src/channels/shared/`, and diverge only in platform API, credentials, and presentation. That is why the two tabs behave and configure almost identically.

## Data and privacy

| Content | Default location |
| --- | --- |
| WeChat account config (with `bot_token` references), account state, workspaces | `~/.dsh/integrations/dsh-weixin/` (`config.json`, `accounts/`, `workspaces.json`) |
| QQ bot config, bot state, workspaces | `~/.dsh/integrations/dsh-qq/` (`config.json`, `bots/`, `workspaces.json`) |
| Shared settings: delivery sync, sidebar, interface language, attachment retention | `~/.dsh/integrations/dsh-im/` (`delivery-sync-settings.json`, `sidebar-settings.json`, `interface-language.json`, `settings.json`) |

When `DSH_HOME` is set, it replaces `~/.dsh` above; the plugin's own `dshHome` option wins over both.

Privacy and security boundaries:

- QR-scanned tokens and secrets go only to the local Harness Host and its protected credential store. The browser sees QR codes, masked state, and the bot list; no RPC response ever returns raw credentials.
- Bot state files keep session bindings, `senderId`, and "is this a bot" identity only — never message text.
- Group history stores only messages and attachments that were actually received, shared per group and rolled off by retention days.
- The proactive-delivery HTTP endpoint has no authentication; use it only on the local machine or a trusted network, never expose it to the public internet.

## Troubleshooting

### The QR code does nothing, or it expired

QR codes are issued by the platform and expire. Click **Regenerate QR code** for a new one, confirm the phone has network access, and make sure you actually confirmed on the phone. When the platform asks for a pairing code, WeChat shows a number on the phone that must be entered in the settings page; scanning without it never completes the binding. If it keeps failing, expand **Diagnostics** and copy the details — the reference (`WX-CONN-…` or `IM-CONN-…`) ties the failure to the matching Host log.

### Credentials expired, or the bot went offline

First check whether the account was unbound, had its password changed, or was logged out elsewhere. If credentials really expired, remove the account and scan again; other accounts are unaffected. The plugin reconnects with backoff, and **Reconnect** on the card forces an immediate retry.

### The bot shows offline while the network is fine

- Check whether the Host just restarted; long connections need a few seconds to come back.
- WeChat: a healthy long poll does not guarantee proactive sends. If `ret=-2 prepare failed` persists, ask the target user to send a message and retry; do not send heartbeats to extend the session.
- QQ: confirm the bot is still enabled on Tencent's side and that this machine can reach the QQ open platform.
- If it still fails, expand **Diagnostics** and use the reference together with the Host log.

### Ports, LAN access, and reverse proxies

- IM management uses Harness's browser authentication and Host/Origin trust checks. If DSH already allows LAN access, you can configure bots from a LAN machine or NAS without touching the plugin config.
- When accessing through a custom domain, a `transport failure for /api/dsh-im/...: HTTP 403` in the settings page means you need to start DSH with that domain and restart: `dsh web --trusted-host dsh.example.com`. Pass the bare domain; repeat the flag for multiple domains.
- To restrict management to the local machine, set `rpcAuthority: loopback` in the profile's `cordis.patch.yml` (the default is `trusted-host`).
- A reverse proxy must preserve the browser's domain and port and keep `Origin` consistent with `Host`, otherwise 403 persists.

### Why does the bot ignore group messages

QQ group chats respond only when the bot is mentioned, and the group allowlist, command permissions, and "new message handling" setting also decide whether a reply happens. WeChat is direct-message only for now.

### The page did not change after upgrading

Plugin updates need a Host restart and a browser refresh; refreshing alone keeps the old Host code running. Use **Check for updates** in the top-right corner of **Settings → IM bots** to confirm the version. Updates touch only `@xdlg93/dsh-im` and never Harness or Desktop itself.

### How do I back up or migrate bound accounts

Config and state live in the directories above; copy them wholesale to migrate. Credentials are owned by Harness, so copying config files alone carries no tokens. On a new machine, prefer removing the old account and scanning again so stale credentials do not keep occupying the platform's bot slots.

### Can I rename a bot

Yes. Click the pencil next to the bot name, set an alias, and save; it takes effect immediately without a reconnect. The alias only changes the display name in this settings page and can be reset at any time. It does not affect `botId`, so proactive-delivery call parameters stay valid.

### Can one bot serve several chats

Yes. Each chat (DM or group) binds its own Harness session and they stay independent; within one chat, `/session` switches the bound session. Group history is shared per group and independent of bots and sessions.

## Development

```sh
npm install
npm run build   # builds lib/index.js and lib/client.js
npm test        # unit tests
npm run check   # build + tests + package verification
```

Source layout:

- `src/channels/weixin/`, `src/channels/qq/`: config, state, API, bridge, and runtime for each channel;
- `src/channels/shared/`: sessions, commands, context enhancement, group history, delivery, and other shared capabilities;
- `plugin-src/host/`: Host RPC, connection supervision, and production wiring;
- `plugin-src/client/`: the settings page and sidebar panel;
- `lib/index.js`, `lib/client.js`: build output and the entry points declared in `package.json`.

Rebuild after changing client code. The plugin registers itself as `xdlg93-dsh-im` through `cordis.patch.yml`.

## License and credits

- Released under the **MIT License**; see [LICENSE](LICENSE) for the full text.
- Upstream: [xmanrui/dsh-im](https://github.com/xmanrui/dsh-im) (MIT). The WeChat and QQ channel implementations and most shared capabilities come from upstream 5.10.0.
- The WeChat iLink request format and QR state machine are adapted from Tencent's [`openclaw-weixin`](https://github.com/Tencent/openclaw-weixin) (MIT).
- QQ onboarding and messaging rely on Tencent Connect's [`@tencent-connect/qqbot-connector`](https://www.npmjs.com/package/@tencent-connect/qqbot-connector) and [`@tencent-connect/qqbot-nodejs`](https://github.com/tencent-connect/qqbot).
- Other third-party components, license texts, and trademark notes are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

This is an independent DeepSeek Harness integration with no affiliation to Tencent or DeepSeek. WeChat, QQ, and related marks belong to their respective owners.
