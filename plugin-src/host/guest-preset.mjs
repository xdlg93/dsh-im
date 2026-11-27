/**
 * The Agent preset a guest chat runs under.
 *
 * A guest is allowed to chat but must not reach the Host: `read`, `web_fetch`
 * and the shell all run without an approval prompt, so the only place a chat
 * turn can be bounded is the composition it runs. A preset with an empty plugin
 * list mounts no tool plugin at all, which is exactly that bound.
 *
 * The preset is registered through the Host's own `agentPresets` service, so it
 * appears in the roster like any other and needs no profile edit. An operator can
 * point `guestAgentPreset` at a preset of their own instead, in which case this
 * module only reads the id.
 */
export const GUEST_PRESET_ID = 'dsh-im-guest';
export const GUEST_PRESET_NAME = 'IM 访客（无工具）';
export const GUEST_PRESET_DESCRIPTION = '供 IM 访客对话使用：不挂载任何工具插件，只能聊天。';

/**
 * Register the built-in guest preset unless the operator named their own.
 *
 * @param ctx - Host context; `agentPresets` is read through the fiber's services.
 * @param config - Plugin config; `guestAgentPreset` overrides the built-in id.
 * @returns the preset id to use for guest sessions, or null when unavailable.
 */
export function installGuestPreset(ctx, config = {}) {
  const configured = typeof config.guestAgentPreset === 'string' ? config.guestAgentPreset.trim() : '';
  if (configured) return configured;
  const presets = serviceOf(ctx, 'agentPresets');
  if (!presets || typeof presets.register !== 'function') return null;
  const registration = presets.register({
    id: GUEST_PRESET_ID,
    name: GUEST_PRESET_NAME,
    description: GUEST_PRESET_DESCRIPTION,
    // No tools: the composition is the sandbox a guest chat runs inside.
    plugins: [],
  });
  // Registration is asynchronous and a duplicate id is a configuration mistake,
  // not a reason to fail the Host: log it and keep the id usable.
  Promise.resolve(registration).catch((error) => {
    const logger = typeof ctx?.logger === 'function' ? ctx.logger('dsh-im:guest-preset') : ctx?.logger ?? console;
    logger.warn?.(`[dsh-im] guest preset unavailable: ${error?.message ?? error}`);
  });
  return GUEST_PRESET_ID;
}

function serviceOf(ctx, name) {
  if (typeof ctx?.get === 'function') {
    try {
      const value = ctx.get(name);
      if (value !== undefined) return value;
    } catch {
      // Not injected on this fiber; fall through to the property read.
    }
  }
  try {
    return ctx?.[name];
  } catch {
    return undefined;
  }
}
