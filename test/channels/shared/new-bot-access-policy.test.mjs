import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { initialAccessPolicyFor } from '../../../plugin-src/host/channels/shared/access-policy-production.mjs';
import { createAccessPolicy, createAccessPolicyScope } from '../../../src/channels/shared/access-policy.mjs';
import { evaluateInboundAccess } from '../../../src/channels/shared/inbound-access.mjs';

for (const channel of ['qq']) {
  test(`${channel} opens new bot messages and commands while preserving saved policies and legacy migration`, async (t) => {
    const dataDir = await mkdtemp(join(tmpdir(), `dsh-new-access-${channel}-`));
    t.after(() => rm(dataDir, { recursive: true, force: true }));
    const path = join(dataDir, 'workspaces.json');
    const chatOnlyScope = createAccessPolicyScope({
      mode: 'open',
      open: { defaultCanExecuteCommands: false, commandPermissionOverrides: [] },
      allowlist: { users: [] },
    });
    const chatOnly = createAccessPolicy({ direct: chatOnlyScope, group: chatOnlyScope });
    const restricted = createAccessPolicy({
      direct: createAccessPolicyScope({
        mode: 'allowlist',
        open: { defaultCanExecuteCommands: true, commandPermissionOverrides: [] },
        allowlist: { users: [{ id: 'member', canExecuteCommands: false }] },
      }),
    });
    await writeFile(path, JSON.stringify({
      version: 2,
      workspaces: { saved: dataDir, damaged: dataDir, chat_only: dataDir },
      accessPolicies: { saved: restricted, damaged: null, chat_only: chatOnly },
    }));
    const bot = (id, owner = 'owner') => ({
      id, botId: id, appId: `app_${id}`, secretRef: `secret_${id}`,
      ownerOpenIds: [owner], ownerUserOpenid: owner,
    });
    const bots = ['legacy', 'saved', 'damaged', 'chat_only'].map((id) => bot(id));
    let controllerOptions;
    let runtimeOptions;
    class ConfigStore {
      async load() { return this; }
      list() { return bots; }
      getBot(id) { return bots.find((config) => config.id === id); }
    }
    class StateStore { async load() { return this; } }
    class Harness { stopManagedProcess() {} }
    class Runtime { constructor(options) { runtimeOptions = options; } }
    class Controller {
      constructor(options) { controllerOptions = options; }
      status() { return { bots: bots.map(({ botId }) => ({ botId, configured: true })) }; }
      async close() {}
    }
    const { createProductionController } = await import(`../../../plugin-src/host/channels/${channel}/production.mjs`);
    const start = () => createProductionController({
      credentials: {}, typertGateway: { invoke() {}, stream() {} },
      logger: () => ({ error() {}, warn() {}, info() {}, debug() {} }),
    }, { dataDir, workspace: dataDir }, {
      ConfigStore, StateStore, HarnessClient: Harness, Controller, Runtime, FeishuRuntime: Runtime,
      qrAuth: {}, lark: {}, proxyEnv: {},
      createConnectionSupervisor: () => ({
        ready: Promise.resolve(), start() { return this; }, async close() {},
      }),
    });
    const connect = async (config) => {
      await controllerOptions.createRuntime({ botId: config.botId, config });
      return runtimeOptions.accessPolicy;
    };
    const checkAccess = (provider, conversationType, senderIds, text) => evaluateInboundAccess(provider, {
      conversationType, senderIds, text,
    });
    let production = await start();
    t.after(() => production.close());
    const legacyPolicy = initialAccessPolicyFor(channel, bots[0]);
    assert.deepEqual((await connect(bots[0])).getSettings(), legacyPolicy);
    assert.deepEqual((await connect(bots[1])).getSettings(), restricted);
    const damaged = await connect(bots[2]);
    assert.equal(damaged.getSettings(), null);
    assert.equal(checkAccess(damaged, 'direct', 'other', 'hello').reason, 'policy-unavailable');
    const existingChatOnly = await connect(bots[3]);
    for (const conversationType of ['direct', 'group']) {
      assert.equal(checkAccess(existingChatOnly, conversationType, 'other', 'hello').allowed, true);
      assert.equal(checkAccess(existingChatOnly, conversationType, 'other', '/status').reason, 'command-not-allowed');
    }

    // A bot connected today starts closed: only the scanning account reaches it,
    // and a stranger cannot run commands in either chat type.
    const freshBot = bot('new');
    bots.push(freshBot);
    const fresh = await connect(freshBot);
    const freshPolicy = fresh.getSettings();
    for (const conversationType of ['direct', 'group']) {
      assert.equal(freshPolicy[conversationType].mode, 'allowlist');
      assert.equal(freshPolicy[conversationType].open.defaultCanExecuteCommands, false);
      assert.equal(checkAccess(fresh, conversationType, 'other', 'hello').allowed, false);
      assert.equal(checkAccess(fresh, conversationType, 'other', '/status').allowed, false);
      assert.deepEqual(checkAccess(fresh, conversationType, 'owner', 'hello'),
        { allowed: true, reason: 'privileged-sender' });
      assert.deepEqual(checkAccess(fresh, conversationType, 'owner', '/status'),
        { allowed: true, reason: 'privileged-sender' });
    }

    // A legacy wildcard owner records no identity, so the bot is closed: chat
    // access alone would still let a stranger drive tools through the model.
    const manualBot = bot('manual', '*');
    bots.push(manualBot);
    const manual = await connect(manualBot);
    const manualPolicy = manual.getSettings();
    assert.equal(manualPolicy.direct.mode, 'allowlist');
    assert.equal(checkAccess(manual, 'direct', 'other', 'hello').allowed, false);
    assert.equal(checkAccess(manual, 'direct', 'other', '/status').allowed, false);
    assert.equal(manualPolicy.group.mode, 'allowlist');
    assert.equal(checkAccess(manual, 'group', 'other', 'hello').allowed, false);

    const customizedBot = bot('customized');
    bots.push(customizedBot);
    const customized = await connect(customizedBot);
    await production.controller.updateAccessPolicy(customizedBot.botId, restricted);
    assert.deepEqual(customized.getSettings(), restricted, 'saved restrictions apply without reconnecting');
    assert.deepEqual((await connect(customizedBot)).getSettings(), restricted, 'reconnecting keeps settings');

    await production.close();
    production = await start();
    const expected = [legacyPolicy, restricted, null, chatOnly, freshPolicy, manual.getSettings(), restricted];
    for (const [index, config] of bots.entries()) {
      assert.deepEqual((await connect(config)).getSettings(), expected[index], `${config.botId} after restart`);
    }
    const persisted = JSON.parse(await readFile(path, 'utf8')).accessPolicies;
    assert.deepEqual(persisted.new, freshPolicy);
    assert.deepEqual(persisted.customized, restricted);
    assert.deepEqual(persisted.legacy, legacyPolicy);
    assert.equal(persisted.damaged, null);
    assert.deepEqual(persisted.chat_only, chatOnly);
  });
}

// Weixin keeps its own new-bot default: an allowlist scoped to the owner, so an
// unknown sender is refused until the operator opens the bot.
test('weixin seeds a new bot with the owner allowlist and keeps it across a restart', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-new-access-weixin-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const bots = [{ id: 'wx', botId: 'wx', accountId: 'account@im.bot', ownerUserId: 'owner' }];
  class ConfigStore {
    async load() { return this; }
    list() { return bots; }
    getBot(id) { return bots.find((config) => config.id === id); }
  }
  class StateStore { async load() { return this; } }
  class Harness { stopManagedProcess() {} }
  class Runtime { constructor(options) { runtimeOptions = options; } }
  let runtimeOptions;
  class Controller {
    constructor(options) { controllerOptions = options; }
    status() { return { bots: bots.map(({ botId }) => ({ botId, configured: true })) }; }
    async close() {}
  }
  let controllerOptions;
  const { createProductionController } = await import('../../../plugin-src/host/channels/weixin/production.mjs');
  const production = await createProductionController({
    credentials: {}, typertGateway: { invoke() {}, stream() {} },
    logger: () => ({ error() {}, warn() {}, info() {}, debug() {} }),
  }, { dataDir, workspace: dataDir }, {
    ConfigStore, StateStore, HarnessClient: Harness, Controller, Runtime,
    api: { beginLogin() {}, pollLogin() {} },
    createConnectionSupervisor: () => ({
      ready: Promise.resolve(), start() { return this; }, async close() {},
    }),
  });
  t.after(() => production.close());
  await controllerOptions.createRuntime({ botId: 'wx', config: bots[0] });
  const policy = runtimeOptions.accessPolicy.getSettings();
  assert.deepEqual(policy, initialAccessPolicyFor('weixin', bots[0]));
  for (const conversationType of ['direct', 'group']) {
    assert.equal(policy[conversationType].mode, 'allowlist');
    assert.equal(evaluateInboundAccess(runtimeOptions.accessPolicy, {
      conversationType, senderIds: 'other', text: 'hello',
    }).allowed, false);
  }
  assert.equal(evaluateInboundAccess(runtimeOptions.accessPolicy, {
    conversationType: 'direct', senderIds: 'owner', text: '/status',
  }).reason, 'privileged-sender');
});
