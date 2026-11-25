import { mkdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

/**
 * Read one Host service from a context.
 *
 * `ctx.get(name)` answers only for a service the current fiber injected, and a
 * plain `ctx.name` throws on Cordis 4.2 when it was not declared. Both routes are
 * tried so a caller can pass either the plugin context or an injected child.
 */
function serviceOf(ctx, name) {
  if (typeof ctx?.get === 'function') {
    try {
      const service = ctx.get(name);
      if (service !== undefined) return service;
    } catch {
      // Fall through to the property read below.
    }
  }
  try {
    return ctx?.[name];
  } catch {
    return undefined;
  }
}

/** Directory name the plugin creates beside the reader's DSH Workspace. */
export const IM_WORKSPACE_DIRECTORY = 'dsh-im';

/**
 * Absolute paths of the Workspaces this Host knows, in registration order.
 *
 * The plugin keeps its conversations in their own directory instead of inside a
 * Workspace the reader works in, and it needs to know where that Workspace lives
 * to put the directory next to it. The registry is the Host's own answer; a Host
 * without one (headless, CLI) simply reports nothing and the caller falls back.
 */
export function dshWorkspacePaths(ctx) {
  const registry = serviceOf(ctx, 'workspaceRegistry');
  if (!registry || typeof registry.list !== 'function') return [];
  try {
    const listed = registry.list();
    if (!Array.isArray(listed)) return [];
    return listed
      .map((workspace) => (typeof workspace?.path === 'string' ? workspace.path : null))
      .filter((path) => typeof path === 'string' && isAbsolute(path));
  } catch {
    return [];
  }
}

/**
 * Where a bot keeps its conversations by default.
 *
 * Next to the reader's Workspace, as a sibling named `dsh-im`: the bot writes
 * files, so it must not fill the Workspace the reader is working in, and a
 * sibling keeps both visible in one parent directory. Without a known Workspace
 * the historical `<dshHome>/im` directory stays the answer, so headless Hosts and
 * existing installations keep working.
 */
/** The DSH home the plugin stores its own state in. */
export function imDshHome(config = {}) {
  return resolve(config.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'));
}

/**
 * Whether a registered Workspace is somewhere the reader actually works.
 *
 * The plugin's own directories get registered as Workspaces too, so anchoring on
 * "the first registered Workspace" would drift: the bot directory becomes a
 * Workspace, then becomes the anchor, then the next directory is derived from
 * it. Anything inside the DSH home is plugin or state data, and the plugin's own
 * directory name is never an anchor.
 */
export function isReaderWorkspace(path, dshHome) {
  if (typeof path !== 'string' || !isAbsolute(path)) return false;
  const resolved = resolve(path);
  const home = resolve(dshHome);
  if (resolved === home || resolved.startsWith(`${home}/`)) return false;
  return basename(resolved) !== IM_WORKSPACE_DIRECTORY;
}

export function defaultImWorkspace(config = {}, { dshWorkspaces = [] } = {}) {
  const dshHome = imDshHome(config);
  const anchor = (Array.isArray(dshWorkspaces) ? dshWorkspaces : [])
    .find((path) => isReaderWorkspace(path, dshHome));
  if (anchor) return resolve(dirname(resolve(anchor)), IM_WORKSPACE_DIRECTORY);
  return resolve(dshHome, 'im');
}

/**
 * Directories the plugin used to pick on its own. A bot still pointing at one of
 * them was never moved by the reader, so startup may relocate it to the current
 * default without guessing what the reader wanted.
 */
export function legacyImWorkspaces(config = {}) {
  const dshHome = imDshHome(config);
  return [resolve(dshHome, 'im'), resolve(dshHome, IM_WORKSPACE_DIRECTORY)];
}

/**
 * Register the plugin's directory as a DSH Workspace.
 *
 * A directory is only a Workspace once the Host registry knows it, and only a
 * registered Workspace shows up in the sidebar together with the Sessions whose
 * cwd is that directory. Without this the bot writes into a folder the reader
 * cannot find, so adoption is part of creating the default directory.
 *
 * @returns whether the directory is registered; a Host without the Workspace
 * services reports false and the caller carries on.
 */
export async function adoptDshWorkspace(ctx, path) {
  if (typeof path !== 'string' || !isAbsolute(path)) return false;
  try {
    const registry = serviceOf(ctx, 'workspaceRegistry');
    if (registry && typeof registry.resolveByPath === 'function' && await registry.resolveByPath(path)) {
      return true;
    }
  } catch {
    // An unreadable registry falls through to the controller, which is the only
    // writer anyway.
  }
  const controller = serviceOf(ctx, 'workspaceController');
  if (!controller || typeof controller.create !== 'function') return false;
  try {
    // The registry adopts an existing directory only; the bot needs the directory
    // whether or not adoption succeeds.
    await mkdir(path, { recursive: true });
    await controller.create({ path });
    return true;
  } catch {
    return false;
  }
}

export async function sameWorkspacePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string'
    || !isAbsolute(left) || !isAbsolute(right)) return false;
  if (resolve(left) === resolve(right)) return true;
  try {
    return resolve(await realpath(left)) === resolve(await realpath(right));
  } catch {
    return false;
  }
}

export async function prepareBotWorkspace(config = {}, options = {}) {
  const ungroupedWorkspace = defaultImWorkspace(config, options);
  const defaultWorkspace = resolve(config.workspace ?? ungroupedWorkspace);
  return { defaultWorkspace, ungroupedWorkspace };
}

export async function ensureImWorkspaceDirectory(workspace, ungroupedWorkspace) {
  if (await sameWorkspacePath(workspace, ungroupedWorkspace)) {
    await mkdir(workspace, { recursive: true });
  }
}
