import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import semver from 'semver';

import manifest from '../../package.json' with { type: 'json' };
import { withSessionBindingLock } from '../../src/channels/shared/session-binding-lock.mjs';
import { NPM_REGISTRY, PACKAGE_NAME } from './update-runtime.mjs';

const ACTIVE_STATES = new Set(['installing', 'verifying']);
const JOB_STATES = new Set([...ACTIVE_STATES, 'restart-required', 'completed', 'failed', 'interrupted']);
const MAX_METADATA_BYTES = 256 * 1024;
const SNAPSHOT_FILES = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'];
const NO_LOCK = Symbol('no update lock');
// Shared across Host instances; keep network and installer work outside these transactions.
const stateIoQueue = {};

export function updateError(code) {
  return Object.assign(new Error(code), { code });
}

/** Read only the fixed npm package; neither RPC callers nor registry metadata choose a command. */
export async function fetchNpmRelease(fetchImpl = globalThis.fetch, timeoutMs = 10_000) {
  let response;
  try {
    response = await fetchImpl(`${NPM_REGISTRY}${encodeURIComponent(PACKAGE_NAME)}/latest`, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    // This fork is not on npm yet: a missing package is a state, not a network
    // failure, and the reader deserves the difference.
    if (response.status === 404) throw updateError('not-published');
    if (!response.ok) throw updateError('check-failed');
    if (Number(response.headers.get('content-length')) > MAX_METADATA_BYTES) {
      throw updateError('invalid-release');
    }
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.byteLength;
      if (length > MAX_METADATA_BYTES) throw updateError('invalid-release');
      chunks.push(Buffer.from(chunk));
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const version = value.version;
    if (value.name !== PACKAGE_NAME || typeof version !== 'string'
      || semver.valid(version) !== version || semver.prerelease(version)) {
      throw updateError('invalid-release');
    }
    const nodeRange = value.engines?.node;
    if (nodeRange !== undefined && (typeof nodeRange !== 'string' || !semver.validRange(nodeRange))) {
      throw updateError('invalid-release');
    }
    const tarball = new URL(value.dist?.tarball);
    const integrity = value.dist?.integrity;
    if (tarball.origin !== new URL(NPM_REGISTRY).origin || tarball.username || tarball.password
      || tarball.search || tarball.hash
      || tarball.pathname !== `/@xdlg93/dsh-im/-/dsh-im-${version}.tgz`
      || typeof integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity)) {
      throw updateError('invalid-release');
    }
    return { version, nodeRange: nodeRange ?? '*', integrity, tarball: tarball.href };
  } catch (error) {
    if (error?.code === 'invalid-release' || error instanceof SyntaxError || error instanceof TypeError && response?.ok) {
      throw updateError('invalid-release');
    }
    throw updateError('check-failed');
  }
}

/** Largest release tarball this updater will buffer. */
const TARBALL_MAX_BYTES = 32 * 1024 * 1024;

/** The plugin index this fork publishes; it names git sources, not npm tarballs. */
export const RELEASE_INDEX_URL = 'https://xdlg93.github.io/dsh-im/index.json';
const COMMIT = /^[0-9a-f]{40}$/u;

/**
 * Newest version the plugin index publishes for this Host.
 *
 * The index is the release channel for this fork: each version pins a repository
 * commit, and `engines.dsh` says which DSH releases can run it. The newest
 * version that this Host satisfies is the update target.
 *
 * @returns the release with the exact pnpm spec to install.
 */
export async function fetchIndexRelease(fetchImpl = globalThis.fetch, { dshVersion, timeoutMs = 10_000 } = {}) {
  let response;
  try {
    response = await fetchImpl(RELEASE_INDEX_URL, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw updateError('index-unreachable');
  }
  if (!response.ok) throw updateError('index-unreachable');
  let document;
  try {
    document = JSON.parse(await response.text());
  } catch {
    throw updateError('index-invalid');
  }
  if (document?.format !== 1 || !Array.isArray(document.plugins)) throw updateError('index-invalid');
  const entry = document.plugins.find((plugin) => plugin?.name === PACKAGE_NAME);
  if (!entry || !Array.isArray(entry.versions) || entry.versions.length === 0) throw updateError('index-invalid');
  const candidates = [];
  for (const version of entry.versions) {
    if (typeof version?.version !== 'string' || semver.valid(version.version) !== version.version) continue;
    if (version.source?.type !== 'git') continue;
    const url = typeof version.source.url === 'string' ? version.source.url : '';
    const commit = typeof version.source.commit === 'string' ? version.source.commit : '';
    if (!/^https:\/\//u.test(url) || !COMMIT.test(commit)) continue;
    const range = typeof version.engines?.dsh === 'string' ? version.engines.dsh : undefined;
    // A version the running DSH cannot activate is not an update, it is a broken
    // install: skip it rather than offering it.
    if (range !== undefined && typeof dshVersion === 'string' && semver.valid(dshVersion)
      && !semver.satisfies(dshVersion, range, { includePrerelease: true })) continue;
    // A release tarball is the fallback channel for a network that blocks git.
    const tgz = typeof version.tgz === 'string' && /^https:\/\/[^\s]+\.tgz$/u.test(version.tgz)
      ? version.tgz : null;
    // The index also publishes the tarball digest, so the no-git channel can be
    // verified before anything is installed. A missing digest is allowed for
    // older index documents but reported as unverified.
    const tgzSha256 = typeof version.tgzSha256 === 'string' && /^[a-f0-9]{64}$/u.test(version.tgzSha256)
      ? version.tgzSha256 : null;
    candidates.push({ version: version.version, dshRange: range ?? null, url, commit, tgz, tgzSha256 });
  }
  if (candidates.length === 0) throw updateError('no-compatible-release');
  candidates.sort((left, right) => semver.rcompare(left.version, right.version));
  const newest = candidates[0];
  return {
    version: newest.version,
    nodeRange: '*',
    dshRange: newest.dshRange,
    installSpec: `git+${newest.url}#${newest.commit}`,
    tgzSpec: newest.tgz,
    tgzSha256: newest.tgzSha256,
    source: 'index',
  };
}

/**
 * The newest release from whichever channel answers.
 *
 * The index is authoritative for this fork; npm is only a fallback for a Host
 * that cannot reach GitHub Pages.
 */
export async function fetchRelease(fetchImpl = globalThis.fetch, options = {}) {
  try {
    return await fetchIndexRelease(fetchImpl, options);
  } catch (indexError) {
    try {
      const release = await fetchNpmRelease(fetchImpl, options.timeoutMs);
      return { ...release, dshRange: null, installSpec: null, tgzSpec: null, tgzSha256: null, source: 'npm' };
    } catch {
      throw indexError;
    }
  }
}

function pathsFor(environment) {
  if (!isAbsolute(environment.homeDir ?? '') || !isAbsolute(environment.profileDir ?? '')) return null;
  const key = createHash('sha256').update(environment.profileDir).digest('hex').slice(0, 24);
  const directory = join(environment.homeDir, 'updates', 'dsh-im', key);
  return {
    directory,
    state: join(directory, 'state.json'),
    lock: join(directory, 'install.lock'),
    backup: join(directory, 'before.json'),
    downloads: join(directory, 'downloads'),
  };
}

function withStateIo(path, operation) {
  const absolute = resolve(path);
  const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  return withSessionBindingLock(stateIoQueue, key, operation);
}

function readJson(path, missing = null) {
  return withStateIo(path, () => readJsonUnlocked(path, missing));
}

async function readJsonUnlocked(path, missing = null) {
  try {
    if ((await stat(path)).size > 10 * 1024 * 1024) throw updateError('state-unavailable');
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return missing;
    throw updateError('state-unavailable');
  }
}

function writeJson(path, value) {
  return withStateIo(path, () => writeJsonUnlocked(path, value));
}

async function writeJsonUnlocked(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    for (let retry = 0; ; retry++) {
      try {
        await rename(temporary, path);
        break;
      } catch (error) {
        // Windows readers can temporarily deny replacement. Keep the old journal
        // and retry the same atomic rename; never remove the destination first.
        if (process.platform !== 'win32' || error.code !== 'EPERM' || retry >= 5) throw error;
        await delay(10 * 2 ** retry);
      }
    }
  } catch {
    throw updateError('state-unavailable');
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw updateError('state-unavailable');
    });
  }
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function publicJob(job) {
  if (!job) return null;
  const { id, state, targetVersion, previousVersion, message, startedAt, updatedAt } = job;
  return {
    id,
    state,
    targetVersion,
    ...(typeof previousVersion === 'string' ? { previousVersion } : {}),
    ...(Number.isFinite(startedAt) ? { startedAt } : {}),
    ...(Number.isFinite(updatedAt) ? { updatedAt } : {}),
    // Which channel carried the install, and whether git was unreachable first.
    ...(typeof job.installSource === 'string' ? { installSource: job.installSource } : {}),
    ...(job.fellBack === true ? { fellBack: true } : {}),
    message,
    recoverable: job.recoverable === true,
  };
}

/** One update job per profile. Persist intent before starting pnpm, and never apply a restart here. */
export function createUpdateService({
  runtime,
  runningVersion = manifest.version,
  nodeVersion = process.versions.node,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  checkTimeoutMs = 10_000,
  confirmationTtlMs = 10 * 60_000,
  installTimeoutMs = 15 * 60_000,
} = {}) {
  const queue = {};
  let checked = null;
  let checking = null;
  let lastCheckAt = -Infinity;
  let activeJob = null;
  let activeTask = null;
  let abortController = null;
  let unsavedJob = null;
  let disposed = false;

  function assertActive() {
    if (disposed) throw updateError('disposed');
  }

  async function readJob(environment) {
    const paths = pathsFor(environment);
    if (!paths) return null;
    // A failed final write must not make this Host display the old "installing"
    // record forever. Keep the lock and expose the outcome we actually observed.
    if (unsavedJob?.statePath === paths.state) return unsavedJob.job;
    let job = await readJson(paths.state);
    const lock = await readJson(paths.lock, NO_LOCK);
    if (!job) {
      if (lock !== NO_LOCK) {
        return { id: 'locked', state: 'interrupted', message: 'recovery-required', targetVersion: null };
      }
      return null;
    }
    if (!JOB_STATES.has(job.state) || typeof job.id !== 'string' || !semver.valid(job.targetVersion)) {
      throw updateError('state-unavailable');
    }
    // The state directory is keyed by profile, not by package, so an install that
    // replaced another dsh-im build (the upstream @xmanrui/dsh-im lineage) still
    // finds its job here. That record describes versions this package never had,
    // and reporting it as an interrupted install would block every later check, so
    // discard the foreign record instead of trusting it.
    if (job.packageName !== PACKAGE_NAME) {
      await clearForeignJob(paths, job);
      return null;
    }
    // Recovery is derived from the current installation, never a persisted flag.
    job = { ...job, recoverable: false };
    const historical = job.id !== activeJob?.id;
    if (ACTIVE_STATES.has(job.state) && historical) {
      if (lock === NO_LOCK || lock?.id !== job.id || !processAlive(lock?.pid)) {
        job = { ...job, state: 'interrupted', message: 'recovery-required' };
      }
    }
    if (historical && !ACTIVE_STATES.has(job.state) && lock !== NO_LOCK) {
      return { ...job, state: 'interrupted', message: 'recovery-required' };
    }
    if (job.state === 'restart-required' || job.state === 'completed') {
      if (environment.installedVersion !== job.targetVersion || environment.packageValid !== true) {
        job = { ...job, state: 'interrupted', message: 'installation-changed' };
      } else {
        job = { ...job, state: runningVersion === job.targetVersion ? 'completed' : 'restart-required' };
      }
    }
    // Reconcile after deriving the job state so an external upgrade or rollback
    // can also recover. Keep history read-only and do not claim its target ran.
    if (historical && lock === NO_LOCK && ['failed', 'interrupted'].includes(job.state)
      && environment.packageValid === true && environment.eligible === true
      && environment.installedVersion === runningVersion && !environment.blockedReason) {
      return job.targetVersion === runningVersion
        ? { ...job, state: 'completed', message: 'recovered' }
        : { ...job, recoverable: true };
    }
    return job;
  }

  /**
   * Remove a job document, its lock and its rollback snapshot when they describe
   * another package. Failure to clean up must not turn a stale record into an
   * error, so every step is best effort.
   */
  async function clearForeignJob(paths, job) {
    for (const path of [paths.state, paths.lock, join(paths.directory, 'before.json')]) {
      try {
        await unlink(path);
      } catch (error) {
        if (error?.code !== 'ENOENT') return;
      }
    }
    unsavedJob = null;
    void job;
  }

  function snapshot(environment, job) {
    let blockedReason = environment.blockedReason ?? checked?.blockedReason ?? null;
    if (job?.state === 'interrupted' && !job.recoverable
      || job?.state === 'failed' && environment.installedVersion !== runningVersion) {
      blockedReason = 'recovery-required';
    } else if (job?.state === 'restart-required' || environment.installedVersion && environment.installedVersion !== runningVersion) {
      blockedReason = 'pending-restart';
    }
    const busy = ACTIVE_STATES.has(job?.state);
    const canInstall = Boolean(environment.eligible && !blockedReason && !busy && checked?.checkId
      && now() < checked.expiresAt && checked.installationKey === environment.installationKey
      && semver.valid(runningVersion) && semver.gt(checked.release.version, runningVersion));
    return {
      runningVersion,
      installedVersion: environment.installedVersion ?? null,
      latestVersion: checked?.release.version ?? null,
      // Which channel answered the check, so the panel can name it.
      releaseSource: checked?.release.source ?? null,
      // The no-git download for the newest release, when the index offers one.
      latestTgz: checked?.release.tgzSpec ?? null,
      profileName: environment.profileName ?? null,
      environmentKind: environment.environmentKind ?? 'cli',
      // Preserve source protection even when restart/recovery takes status priority.
      sourceInstall: environment.sourceInstall === true || environment.blockedReason === 'source-install',
      canInstall,
      blockedReason,
      checkedAt: checked?.checkedAt ?? null,
      checkId: canInstall ? checked.checkId : null,
      job: publicJob(job),
    };
  }

  async function status() {
    assertActive();
    const environment = await runtime.inspect();
    return snapshot(environment, await readJob(environment));
  }

  async function check() {
    assertActive();
    if (checking) return checking;
    // Collapse double clicks without turning a failed request into a cached success.
    if (checked?.checkId && now() - lastCheckAt < 2_000) return status();
    lastCheckAt = now();
    checking = (async () => {
      try {
        const environment = await runtime.inspect({ preflight: true });
        const release = await fetchRelease(fetchImpl, {
          dshVersion: environment.dshVersion ?? undefined,
          timeoutMs: checkTimeoutMs,
        });
        assertActive();
        checked = {
          release,
          checkId: randomUUID(),
          checkedAt: now(),
          expiresAt: now() + confirmationTtlMs,
          installationKey: environment.installationKey,
          profileDir: environment.profileDir,
          blockedReason: environment.blockedReason
            ?? (!semver.satisfies(nodeVersion, release.nodeRange) ? 'incompatible-node' : null),
        };
        return snapshot(environment, await readJob(environment));
      } catch (error) {
        if (checked) checked = { ...checked, checkId: null, expiresAt: 0 };
        throw error;
      } finally {
        checking = null;
      }
    })();
    return checking;
  }

  async function releaseLock(paths, id) {
    await withStateIo(paths.lock, async () => {
      const lock = await readJsonUnlocked(paths.lock);
      if (lock?.id === id) await unlink(paths.lock);
    });
  }

  async function backupProfile(environment, paths, job) {
    const files = {};
    for (const filename of SNAPSHOT_FILES) {
      try {
        const path = join(environment.profileDir, filename);
        if ((await stat(path)).size > 3 * 1024 * 1024) throw updateError('state-unavailable');
        files[filename] = await readFile(path, 'utf8');
      } catch (error) {
        if (error.code !== 'ENOENT') throw updateError('state-unavailable');
      }
    }
    // Keep only the previous attempt's small manifests, never credentials or the entire home.
    await writeJson(paths.backup, { jobId: job.id, previousVersion: job.previousVersion, files });
  }

  function rememberUnsavedJob(paths) {
    activeJob = { ...activeJob, state: 'interrupted', message: 'state-unavailable' };
    unsavedJob = { statePath: paths.state, job: activeJob };
  }

  /**
   * Install one release through the channels the index offers, in the order the
   * current installation suggests.
   *
   * A profile installed from a tarball prefers the tarball; anything else tries
   * the git commit first and falls back to the tarball when git cannot reach the
   * repository — the case for a network that resets github.com.
   */
  /**
   * Download the release tarball and verify the digest the index published.
   *
   * The tarball channel is the one that does not go through a registry, so the
   * index's sha256 is the only integrity check it has. A missing digest is
   * refused here rather than installed blind: the index is generated by our own
   * publish script, which always writes it.
   */
  async function verifiedTarball(job, signal, paths) {
    const url = job.tgzSpec;
    const expected = typeof job.tgzSha256 === 'string' ? job.tgzSha256 : null;
    if (!url) return null;
    if (!expected) throw updateError('tgz-unverified');
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { accept: 'application/octet-stream' },
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(checkTimeoutMs)]),
      });
    } catch {
      throw updateError('install-failed');
    }
    if (!response?.ok) throw updateError('install-failed');
    // A tarball is a few megabytes; refuse an index entry that asks for more
    // before the whole body is buffered.
    const declared = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declared) && declared > TARBALL_MAX_BYTES) throw updateError('tgz-too-large');
    let bytes;
    try {
      bytes = Buffer.from(await response.arrayBuffer());
    } catch {
      throw updateError('install-failed');
    }
    if (bytes.length > TARBALL_MAX_BYTES) throw updateError('tgz-too-large');
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== expected) throw updateError('tgz-integrity');
    await mkdir(paths.downloads, { recursive: true, mode: 0o700 });
    const path = join(paths.downloads, `dsh-im-${job.targetVersion}.tgz`);
    await writeFile(path, bytes, { mode: 0o600 });
    return `file:${path}`;
  }

  async function installRelease(job, originalEnvironment, signal, paths) {
    const gitSpec = typeof job.installSpec === 'string' && job.installSpec ? job.installSpec : null;
    const tgzSpec = typeof job.tgzSpec === 'string' && job.tgzSpec ? job.tgzSpec : null;
    const order = job.installChannel === 'tgz' && tgzSpec
      ? [tgzSpec, gitSpec]
      : [gitSpec, tgzSpec];
    const attempts = order.filter((spec, index) => spec && order.indexOf(spec) === index);
    if (attempts.length === 0) {
      await runtime.install(job.targetVersion, { signal, expectedInstallationKey: originalEnvironment.installationKey });
      return { spec: null, fallback: false };
    }
    let lastError;
    for (const [index, spec] of attempts.entries()) {
      try {
        // A tarball attempt is downloaded and verified first; the installer then
        // receives a local file, so what was checked is exactly what is installed.
        const target = spec === tgzSpec ? (await verifiedTarball(job, signal, paths)) ?? spec : spec;
        await runtime.install(job.targetVersion, {
          signal,
          expectedInstallationKey: originalEnvironment.installationKey,
          spec: target,
        });
        return { spec, fallback: index > 0 };
      } catch (error) {
        lastError = error;
        // Only a network-ish failure justifies the next channel: a version or
        // state problem would fail the same way on the tarball.
        const retryable = error?.code === 'install-failed' || error?.code === 'install-timeout';
        if (!retryable || index === attempts.length - 1) throw error;
        activeJob = { ...activeJob, message: 'install-channel-fallback', updatedAt: now() };
        try { await writeJson(paths.state, activeJob); } catch { /* keep going; the install still decides */ }
      }
    }
    throw lastError;
  }

  async function execute(paths, job, originalEnvironment) {
    const deadline = AbortSignal.timeout(installTimeoutMs);
    try {
      const installed = await installRelease(
        job,
        originalEnvironment,
        AbortSignal.any([abortController.signal, deadline]),
        paths,
      );
      activeJob = {
        ...activeJob,
        installSource: installed.spec === job.tgzSpec ? 'tgz' : installed.spec === job.installSpec ? 'git' : 'registry',
        fellBack: installed.fallback,
        updatedAt: now(),
      };
      if (disposed) throw updateError('interrupted');
      activeJob = { ...activeJob, state: 'verifying', updatedAt: now() };
      await writeJson(paths.state, activeJob);
      const environment = await runtime.inspect();
      if (environment.homeDir !== originalEnvironment.homeDir || environment.profileDir !== originalEnvironment.profileDir
        || environment.profileName !== originalEnvironment.profileName || environment.blockedReason === 'installation-changed') {
        throw updateError('installation-changed');
      }
      if (environment.installedVersion !== job.targetVersion || environment.packageValid !== true) {
        throw updateError('verify-failed');
      }
      if (environment.blockedReason && environment.blockedReason !== 'pending-restart') throw updateError('verify-failed');
      activeJob = { ...activeJob, state: 'restart-required', message: null, updatedAt: now() };
      await writeJson(paths.state, activeJob);
    } catch (error) {
      const timedOut = deadline.aborted || error.code === 'install-timeout';
      const interrupted = disposed || abortController.signal.aborted
        || !timedOut && ['interrupted', 'install-interrupted'].includes(error.code);
      activeJob = {
        ...activeJob,
        state: interrupted ? 'interrupted' : 'failed',
        message: interrupted ? 'interrupted' : timedOut ? 'install-timeout'
          : ['verify-failed', 'state-unavailable', 'installation-changed', 'registry-conflict'].includes(error.code)
            ? error.code : 'install-failed',
        updatedAt: now(),
      };
      try {
        await writeJson(paths.state, activeJob);
      } catch {
        // Retain the lock when the final record cannot be saved; the next Host must inspect it.
        rememberUnsavedJob(paths);
        return;
      }
    }
    await releaseLock(paths, job.id);
  }

  function install({ checkId, requestId }) {
    return withSessionBindingLock(queue, 'install', async () => {
      assertActive();
      let environment = await runtime.inspect({ preflight: true });
      const previous = await readJob(environment);
      if (previous?.requestId === requestId) return snapshot(environment, previous);
      if (ACTIVE_STATES.has(previous?.state) || previous?.state === 'restart-required') throw updateError('update-busy');
      const confirmation = checked;
      if (!confirmation || !checkId || confirmation.checkId !== checkId || now() >= confirmation.expiresAt) {
        throw updateError('check-expired');
      }
      if (environment.profileDir !== confirmation.profileDir || environment.installationKey !== confirmation.installationKey) {
        throw updateError('installation-changed');
      }
      if (!snapshot(environment, previous).canInstall) throw updateError(environment.blockedReason ?? 'update-busy');
      const paths = pathsFor(environment);
      if (!paths) throw updateError('state-unavailable');
      const job = {
        id: randomUUID(), requestId, state: 'installing', message: null,
        packageName: PACKAGE_NAME,
        targetVersion: confirmation.release.version, previousVersion: environment.installedVersion,
        installSpec: confirmation.release.installSpec ?? null,
        tgzSpec: confirmation.release.tgzSpec ?? null,
        tgzSha256: confirmation.release.tgzSha256 ?? null,
        installChannel: environment.installChannel ?? null,
        startedAt: now(), updatedAt: now(),
      };
      let locked = false;
      try {
        await mkdir(paths.directory, { recursive: true, mode: 0o700 });
        await withStateIo(paths.lock, async () => {
          const lock = await open(paths.lock, 'wx', 0o600);
          locked = true;
          try {
            await lock.writeFile(JSON.stringify({ id: job.id, pid: process.pid, startedAt: now() }));
          } finally {
            await lock.close();
          }
        });
        const currentRelease = await fetchRelease(fetchImpl, {
          dshVersion: environment.dshVersion ?? undefined,
          timeoutMs: checkTimeoutMs,
        });
        if (JSON.stringify(currentRelease) !== JSON.stringify(confirmation.release)) throw updateError('check-expired');
        environment = await runtime.inspect({ preflight: true });
        if (environment.profileDir !== confirmation.profileDir || environment.installationKey !== confirmation.installationKey) {
          throw updateError('installation-changed');
        }
        if (!environment.eligible || environment.blockedReason) throw updateError(environment.blockedReason ?? 'update-busy');
        assertActive();
        await backupProfile(environment, paths, job);
        await writeJson(paths.state, job);
        assertActive();
      } catch (error) {
        if (locked) await releaseLock(paths, job.id);
        if (error.code === 'EEXIST') throw updateError('update-busy');
        if (error.code?.startsWith('E')) throw updateError('state-unavailable');
        throw error;
      }
      activeJob = job;
      abortController = new AbortController();
      activeTask = execute(paths, job, environment).catch(() => {
        // Keep unknown cleanup failures local and keep the on-disk lock for manual recovery.
        rememberUnsavedJob(paths);
      });
      return snapshot(environment, job);
    });
  }

  async function close() {
    disposed = true;
    abortController?.abort();
    if (activeTask) await activeTask;
  }

  return Object.freeze({ status, check, install, close });
}
