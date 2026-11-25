# Group message history and shared files

[简体中文](group-history.md) · [Back to README](../README.en.md)

A QQ bot can save the group messages and attachments it actually receives. Mention the bot in the group afterwards to query the history, summarize a discussion, or read a file. WeChat is direct-message only today, so group history does not apply there.

Collection is on by default, needs no prior mention, and has no per-group switch. Saving a message never calls the model or creates an AI session; the bot still follows its existing mention rules and access settings when deciding whether to answer.

## Quick start

1. Scan the QQ QR code to connect the bot to DSH, then add it to the target group.
2. The group owner must authorize the bot, through the entry QQ provides for that application, to see all conversations in the group. Whether that entry exists depends on the QQ application and client; a bot that has merely joined the group is not necessarily authorized.
3. Confirm the group shows the authorization result, such as "the group owner has authorized … to view all conversations".
4. Keep DSH and the bot online while members chat or send attachments; the plugin saves what it receives.
5. Mention the bot in the same group, for example:

   ```text
   @bot Summarize today's discussion and list the decisions and follow-ups.
   @bot Search the last 7 days of chat history for "budget".
   @bot List the files this group received yesterday.
   @bot Read yesterday's "meeting-notes.txt" and tell me the confirmed delivery date.
   ```

No dedicated history command is needed. The model queries the local group history on demand and gets a session copy when it reads a file. Asking about a group from the Web UI, the CLI, or a bot DM grants no access to that group's history.

## What QQ needs

| Item | Requirement |
| --- | --- |
| Receiving non-mentioned messages | The application supports non-mentioned group messages, the group owner authorized viewing all conversations through QQ's prompt, and delivery is confirmed |
| Group files | The actual message event carries a downloadable attachment |

If QQ does not deliver ordinary group messages to this application, dsh-im cannot fill the gap from local settings. QQ history is isolated per application: two different QQ applications do not automatically share history for the same real group.

**Verified**: on 2026-10-18, in an authorized group, non-mentioned plain text and text attachments were saved and later read after a mention. Other applications still depend on what the platform actually delivers.

## Retention and storage

Where: **DSH Settings → IM bots → gear "General settings" (top right) → General → Group history retention days**. This is a plugin-wide setting, not the "General" page inside a bot card.

- 14 days by default; any other positive integer works and applies to every group without a restart.
- Retention rolls over `N × 24` hours by message send time, not by message count or calendar day. `0` is not accepted as "keep forever" or "stop collecting".
- Queries exclude expired records immediately. Cleanup runs at startup, hourly, and after the retention value changes; shortening retention deletes expired messages and files, and lengthening it cannot restore deleted content.
- Attachment retention on the **Attachments** tab governs session attachment copies, not original group files.

Data lives on the machine running DSH:

```text
<DSH_HOME>/integrations/dsh-im/
  general-settings.json    # retention days, created after the first save
  group-history.sqlite     # groups, messages, attachment metadata
  group-files/             # downloaded original group files
```

`DSH_HOME` defaults to `~/.dsh` when unset. Every message is stored as its own row with the group identity, platform message ID, sender, time, text, and attachment metadata; file contents live under `group-files/`, not in the database.

History is shared per group and independent of bots, AI sessions, and workspaces. Within one DSH data directory, bots with the same group identity read the same records; switching sessions or workspaces, or removing a bot, does not delete group history. Different machines never sync automatically.

Files are copied into the current session workspace only when read; originals stay with the group. Text, summaries, and file copies that already entered an AI session follow their own retention rules, so changing group retention does not clear those copies.

## Query scope and file limits

The model queries messages or file lists by time and keyword through `dsh_im_group_history`, at most 100 rows per page with a bounded response size, and fetches a downloaded file's session copy through `dsh_im_group_file` before reading it. Keyword search covers message text or file names, never attachment contents.

More history never means more context automatically: large groups should be queried in time slices, and a truncated result must not be treated as a complete summary.

Only messages and attachments the plugin actually received and recognised are stored:

- No backfill of history from before the bot was connected, no guarantee of messages missed while offline, and no crawling of the platform's group file library.
- Edits, retractions, and bot-to-bot messages are not fully synchronised.
- Attachments download asynchronously. The archive limit is **100 MiB per file**, further bounded by the channel downloader and any lower platform limit.
- An attachment that never finished downloading, failed, was interrupted by a restart, or has expired may only have metadata, not readable content. Re-send it after permissions and connectivity recover.
- Saving a file is not parsing it: image understanding, PDF, or spreadsheet parsing still depends on the current model and available tools.

## Verify that saving and reading work

1. Keep the bot online and have an ordinary member send a message with random content, for example "record check: codename Pine-8426, budget 315", **without mentioning or replying to the bot**.
2. Then mention the bot in the same group: "Look up the codename and budget in that record check and read the group history." Do not repeat the answer in the question.
3. Check whether `dsh_im_group_history` was called and whether the answer matches. A normal reply alone does not prove the bot read the history.
4. For files, send a small `.txt` with a different random value inside, then ask the bot to read its contents. It should query the file record first and then fetch a copy through `dsh_im_group_file`, not just return the file name.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Only mentioned messages are stored | Confirm the owner authorized the bot and that QQ really delivers non-mentioned messages; send a new message after authorizing |
| Messages are saved but the bot does not answer | Check the bot's access settings, mention style, platform send permission, and connection state |
| File contents are unreadable | Confirm the download finished, the file is under the size limit, and it is within retention; re-send it as a test |
| Older messages are missing | Check when the bot was connected, the retention days, and the connection state at the time; full history is never backfilled |
| The group history setting cannot be read | Save a valid retention value again under General settings; a corrupt setting pauses collection, queries, and cleanup |
