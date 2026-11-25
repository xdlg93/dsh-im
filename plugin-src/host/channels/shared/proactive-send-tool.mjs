/**
 * Agent tools that push a message to a configured IM delivery target.
 *
 * The channels this fork ships can only send on their own schedule: WeChat
 * refuses a send once the conversation session expires (iLink `errcode -14`) and
 * holds the message until the recipient writes again, while QQ accepts it
 * directly. Both outcomes are reported honestly instead of being flattened into
 * "sent", because a model that claims a message arrived when it is queued has
 * told the user something untrue.
 */
const LIST_TOOL = 'dsh_im_targets';
const SEND_TOOL = 'dsh_im_send';

const textOutput = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
};

function deliveryError(code, message) {
  return Object.assign(new Error(message), { code });
}

function targetSummary(botId, channel, target) {
  return {
    botId,
    channel,
    targetId: target?.targetId,
    name: target?.name ?? null,
    kind: target?.kind ?? null,
    route: target?.route ?? null,
  };
}

export function createProactiveSendTools({ deliveryService }) {
  if (!deliveryService
    || typeof deliveryService.listBots !== 'function'
    || typeof deliveryService.listTargets !== 'function'
    || typeof deliveryService.send !== 'function') {
    throw new TypeError('proactive send tools require the delivery service');
  }

  const listTargets = async () => {
    const bots = await deliveryService.listBots();
    const entries = [];
    for (const bot of bots) {
      let listed;
      try {
        listed = await deliveryService.listTargets(bot.botId);
      } catch {
        // One account that cannot be read must not hide the others.
        continue;
      }
      for (const target of listed?.targets ?? []) {
        entries.push(targetSummary(bot.botId, listed.channel ?? bot.channel, target));
      }
    }
    return entries;
  };

  return [
    {
      name: LIST_TOOL,
      description: 'List the IM delivery targets configured for this DSH profile (WeChat users, QQ users and groups) so a message can be pushed proactively. Returns botId, channel, targetId, name, kind and route for each target. Call this before dsh_im_send when the target id is unknown.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: textOutput,
      execute: async () => {
        const targets = await listTargets();
        return { targets, count: targets.length };
      },
    },
    {
      name: SEND_TOOL,
      description: 'Push a message to a configured IM delivery target without waiting for the user to write first. Requires botId and targetId from dsh_im_targets. The result says whether the message was sent or queued: WeChat holds a message until the recipient writes to the bot again (the platform refuses sends after the conversation session expires), so report "queued, delivered when the chat reopens" rather than claiming it arrived. QQ sends immediately.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          botId: { type: 'string', description: 'Account id from dsh_im_targets.' },
          targetId: { type: 'string', description: 'Target id from dsh_im_targets.' },
          text: { type: 'string', description: 'Message body to deliver.' },
          format: { type: 'string', enum: ['plain', 'markdown'], description: 'Message format; plain unless the channel renders Markdown.' },
        },
        required: ['botId', 'targetId', 'text'],
      },
      output: textOutput,
      execute: async ({ botId, targetId, text, format = 'plain' }) => {
        if (typeof botId !== 'string' || !botId.trim()) throw deliveryError('bad-request', 'botId is required');
        if (typeof targetId !== 'string' || !targetId.trim()) throw deliveryError('bad-request', 'targetId is required');
        if (typeof text !== 'string' || !text.trim()) throw deliveryError('bad-request', 'text is required');
        const result = await deliveryService.send(botId.trim(), targetId.trim(), text, {
          ...(format === 'markdown' ? { format } : {}),
        });
        if (result?.queued === true) {
          return {
            delivered: false,
            queued: true,
            reason: result.reason ?? 'session-timeout',
            pending: result.pending ?? null,
            note: 'The message is stored and will be delivered as soon as the recipient writes to the bot.',
          };
        }
        return { delivered: true, queued: false };
      },
    },
  ];
}

/** Register the proactive push tools and the prompt note that explains them. */
export function installProactiveSendTools(ctx, { deliveryService } = {}) {
  if (typeof ctx?.tools?.register !== 'function') return false;
  let tools;
  try {
    tools = createProactiveSendTools({ deliveryService });
  } catch {
    return false;
  }
  for (const tool of tools) ctx.tools.register(tool);
  if (typeof ctx?.systemPrompt?.context === 'function') {
    ctx.systemPrompt.context({
      name: 'dsh-im:proactive-send',
      order: 117,
      text: () => `To push a message to a configured IM target (WeChat or QQ) without waiting for the user, call ${LIST_TOOL} to read the targets and then ${SEND_TOOL}. A queued result means the channel is holding the message until the recipient writes again; never describe a queued message as already delivered.`,
    });
  }
  return true;
}
