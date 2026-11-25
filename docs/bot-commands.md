# Command details

[简体中文](机器人命令.md) · [Back to README](../README.en.md)

Both WeChat and QQ bots accept commands that start with `/`. Commands only recognise plain-text messages, follow the bot's access policy and command permissions, and stay responsive while a task runs; a command never triggers an extra model call unless it submits work itself.

## Permission presets (QQ)

`/permission` reads the current bound session. `/permissionlist` lists the Host's available presets in numbered order and marks the current value. `/permission 2` uses the latest list in this bot and chat; `/permission workspace-write` accepts an ID without listing first, and `/permission id:123` addresses a numeric ID. Numbered lists expire after 15 minutes or a bot restart; switching the bound session requires a new list. A switch takes effect on the current session and updates sandbox and approval policies together without changing defaults for new sessions. Existing tool executions and pending approvals are not replayed or automatically approved. The Host owns the catalog; `custom` is display-only.

WeChat does not offer this command.

## Sessions

| Command | Description |
| --- | --- |
| `/new [title]` | Clear this chat's binding so the next plain message starts a fresh Harness session; a title is optional. |
| `/reset` | Reset the current session context while keeping its identifier, so `/session` can still find the old session. |
| `/clear` | Clear the current session context while keeping the binding and history. |
| `/compact` | Compact the earlier context of the current session now. |
| `/sessionlist`, `/sessions` | List session IDs and titles in the current workspace, marking the bound one. `--all` spans workspaces; `--limit N` caps the count. |
| `/session <ID, index, or title>` | Bind this chat to an existing session; a title keyword binds automatically only when it matches exactly one session in the workspace. |
| `/history [count]` | Show recent messages of the bound session in a DM: 3 by default, 5 at most. |
| `/status` | Show the bot's Harness connection, effective workspace, bound session, current model, and Agent Preset. |
| `/version` | Show the running plugin version. |

`/status` never sends a message to the model or changes the binding; its receipt is always a single message, and a field that cannot be read is simply omitted.

## Workspaces and models

| Command | Description |
| --- | --- |
| `/workspace`, `/ws` | List switchable workspaces, or switch by index or absolute path. |
| `/conv`, `/conversation` | Show or set this conversation's own workspace; `/conv clear` removes it. |
| `/models` | List every configured model in numbered order. |
| `/model` | Show the model and reasoning effort of the current session. |
| `/model <index or Provider/modelID> [effortID]` | Switch the session model, optionally with a supported reasoning effort. |
| `/reasoninglist`, `/reasonings` | List the reasoning efforts the current model supports. |
| `/reasoning` | Show the current model and reasoning effort. |
| `/reasoning <index or effortID>` | Switch the current model's reasoning effort. |
| `/reasoning --default` | Restore the current model's default effort. |

Model and effort switches affect only the current session; the model setting on the bot card affects only sessions created afterwards.

## Agent Preset

| Command | Description |
| --- | --- |
| `/presetlist`, `/presets` | List the Host's available Agent Presets in numbered order, marking the Host default and this bot's choice. |
| `/preset` | Show this bot's Agent Preset for new sessions. |
| `/preset <index or preset ID>` | Set this bot's Agent Preset; use `/preset id:<ID>` for a numeric ID. |
| `/preset --default` | Clear the explicit choice so new sessions follow the Host default. |

## Task control

| Command | Description |
| --- | --- |
| `/stop` | Stop the task running in this chat immediately, keeping queued messages that have not started. |
| `/steer <text>` | Add an instruction to the task running in this chat immediately. |
| `/batch` | Start batch input in a DM, collecting up to 10 plain-text messages. |
| `/send` | Submit the collected messages together, in order. |
| `/cancel` | Cancel batch input and discard the collected messages. |

If the bot's "new message handling" is set to interject, ordinary plain-text messages join the running task automatically without `/steer`.

## QQ menu

`/menu` or `/m` opens the button and numeric menu: sessions, workspace, mode/preset, model, new session, session list, stop, compact, extra instructions, archive display, status, and help. Lists paginate, and you can reply with a number when buttons are unavailable. Menus are isolated per chat and per actor, expire after 15 minutes or a bot restart, and a plain message exits numeric selection while approvals, questions, and batch input keep their priority.

## Questions and approvals

- **Interactive questions**: reply with the option number, the option text, or free-form text; separate multiple choices with commas.
- **Remote approvals**: reply "approve", "reject", "yes", or "no" (Chinese equivalents also work). Web and chat can both handle the same approval; the first "approve once" or "reject" wins and the other side is invalidated. Permanent approval is not offered.

## Help

`/help` shows the commands the bot supports and their usage. Availability depends on the bot's access policy and command permissions: an unauthorised command is refused rather than silently ignored.
