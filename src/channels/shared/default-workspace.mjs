import { mkdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

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
  const registry = typeof ctx?.get === 'function' ? ctx.get('workspaceRegistry') : undefined;
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
export function defaultImWorkspace(config = {}, { dshWorkspaces = [] } = {}) {
  const [workspace] = (Array.isArray(dshWorkspaces) ? dshWorkspaces : [])
    .filter((path) => typeof path === 'string' && isAbsolute(path));
  if (workspace) return resolve(dirname(resolve(workspace)), IM_WORKSPACE_DIRECTORY);
  const dshHome = config.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh');
  return resolve(dshHome, 'im');
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
