const test = require('node:test');
const assert = require('node:assert/strict');
const { cliConnectionPolicy } = require('../src/cli-connection-policy');

test('private CLI connection leaves network identity and engine version to the local CLI', () => {
  const policy = cliConnectionPolicy('0.1.14', true);
  assert.deepEqual(policy.args, ['agent', '--no-leader', 'stdio']);
  assert.equal(policy.initialize._meta, undefined);
  assert.deepEqual(policy.initialize.clientInfo, { name: 'grok-build-desktop', version: '0.1.14' });
  assert.deepEqual(policy.sessionMeta, {});
  assert.equal(policy.initialize.clientCapabilities._meta['x.ai/folderTrust'].interactive, true);
});

test('shared-worker compatibility keeps permission notifications scoped to the desktop', () => {
  const policy = cliConnectionPolicy('0.1.14', false);
  assert.deepEqual(policy.args, ['agent', 'stdio']);
  assert.equal(policy.initialize._meta.clientIdentifier, policy.sessionMeta.clientIdentifier);
  assert.equal(policy.initialize._meta.clientVersion, undefined);
  assert.equal(policy.isolated, false);
});
