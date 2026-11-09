// Access-rule tests — split rule 2026-11-08 (public mind, private secrets
// file only). Updates the Step 2 tests for the split: Roger Sim gets the
// PUBLIC personality packet + the private secrets file; other Sims get
// public material + placeholder only, never the secrets file; Aria gets
// Echo + humanity nuances, never the secrets file.
// No provider keys, no network, no real private contents: every private
// fixture is labelled placeholder text only. Run with `npm test`.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const server = require('../server');
const loader = require('../sim-intellect/loader');

const WORK = path.join(__dirname, 'fixtures');
function fixture(name) {
  return fs.readFileSync(path.join(WORK, `fixtures-${name}`), 'utf8');
}
function stubFetch(map) {
  return async (url) => {
    const text = map[url];
    if (text === undefined) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => text };
  };
}
const FIXTURE_MAP = {
  'https://raw.githubusercontent.com/Keywebco/sovereign-knowledge-os/main/knowledge/echo-core.md': fixture('echo-core.md'),
  'https://raw.githubusercontent.com/Keywebco/nextxus-yaml/main/source/roger-sim/mind/roger-sim-mind.yaml': fixture('roger-sim-mind.yaml'),
  'https://raw.githubusercontent.com/Keywebco/nextxus-yaml/main/source/roger-sim/mind/memory-log.yaml': fixture('memory-log.yaml'),
  'https://raw.githubusercontent.com/Keywebco/nextxus-yaml/main/source/roger-sim/mind/memory-loop-schema.yaml': fixture('memory-loop-schema.yaml'),
  'https://raw.githubusercontent.com/Keywebco/nextxus-yaml/main/source/roger-sim/mind/SYSTEM_PROMPT_FRAGMENT.md': fixture('SYSTEM_PROMPT_FRAGMENT.md'),
  'https://raw.githubusercontent.com/Keywebco/nextxus-yaml/main/source/roger-sim/mind/AGENT_ZERO_SUBCONSCIOUS.md': fixture('AGENT_ZERO_SUBCONSCIOUS.md'),
  'https://raw.githubusercontent.com/Keywebco/nextxus-yaml/main/README.md': fixture('nextxus-yaml-README.md'),
  'https://raw.githubusercontent.com/Keywebco/nextxus-yaml/main/source/roger-sim/mind/INDEX.md': fixture('INDEX.md'),
};

// Placeholder public mind packet only — labelled, invented, never real contents.
const PLACEHOLDER_MIND = {
  loaded: true,
  prompt: 'PLACEHOLDER public mind prompt (test fixture only, not real contents).',
  soulMap: '## Placeholder Soul\nThis is a placeholder public soul-map section about the Federation pattern, for tests only.\n\n## Placeholder Memory\nA placeholder memory about building the Federation, for tests only.',
};
// Placeholder secrets file only — labelled, invented, never real contents.
const PLACEHOLDER_SECRETS = {
  loaded: true,
  secrets: 'PLACEHOLDER secret (test fixture only, not a real secret): the test vault combination is 00-00-00.',
};

test('access: Roger Sim is the only Sim with the public mind packet and the secrets file', () => {
  const roger = server.resolveSimAccess('roger-sim');
  assert.equal(roger.publicMind, true);
  assert.equal(roger.privateSecrets, true);
  assert.equal(server.resolveSimAccess('roger').publicMind, true);
  assert.equal(server.resolveSimAccess('roger').privateSecrets, true);
  assert.equal(server.resolveSimAccess().publicMind, true, 'default is Roger Sim');
  assert.equal(server.resolveSimAccess().privateSecrets, true, 'default is Roger Sim');
  assert.equal(server.resolveSimAccess('aria').publicMind, false);
  assert.equal(server.resolveSimAccess('aria').privateSecrets, false);
  assert.equal(server.resolveSimAccess('catalyst').publicMind, false);
  assert.equal(server.resolveSimAccess('catalyst').privateSecrets, false);
  assert.equal(server.resolveSimAccess('pontus').publicMind, false);
  assert.equal(server.resolveSimAccess('pontus').privateSecrets, false);
  assert.ok(server.resolveSimAccess('aria').note.includes('Echo'));
  assert.ok(server.resolveSimAccess('catalyst').note.includes('placeholder'));
  assert.equal(server.accessTable().length, 3);
  assert.ok(server.accessTable()[0].can.includes('public personality packet'));
  assert.ok(server.accessTable()[0].can.includes('private secrets file'));
  assert.ok(server.accessTable()[1].cannot.includes('private secrets file'));
  assert.ok(server.accessTable()[2].cannot.includes('private secrets file'));
});

test('access: public mind loader fetches publicly, no token, and is fail-closed on 404', async () => {
  const fetchOk = async (url) => {
    assert.ok(!url.includes('roger-sim-brain'), 'public mind must not fetch from the private repo');
    return { ok: true, status: 200, text: async () => '## Placeholder Soul\nA placeholder public soul-map section about the Federation pattern.' };
  };
  const mind = await server.loadPublicMind({}, fetchOk);
  assert.equal(mind.loaded, true);
  const missing = await server.loadPublicMind({}, async () => ({ ok: false, status: 404, text: async () => '' }));
  assert.equal(missing.loaded, false);
  assert.ok(missing.reason.includes('404'), 'unmerged public packet PR fails closed, Sim keeps running');
  const empty = await server.loadPublicMind({}, async () => ({ ok: true, status: 200, text: async () => '   ' }));
  assert.equal(empty.loaded, false);
  assert.equal(empty.reason, 'empty');
});

test('access: secrets loader is fail-closed with no token', async () => {
  const secrets = await server.loadPrivateSecrets({}, async () => { throw new Error('must not fetch without a token'); });
  assert.equal(secrets.loaded, false);
  assert.equal(secrets.reason, 'not configured');
});

test('access: secrets loader is fail-closed on a 401', async () => {
  const fetch401 = async (url) => {
    assert.ok(url.includes('secrets/roger-sim-secrets.md'), 'secrets loader fetches only the one secrets file');
    return { ok: false, status: 401, text: async () => '' };
  };
  const secrets = await server.loadPrivateSecrets({ SIM_PRIVATE_BRAIN_TOKEN: 'PLACEHOLDER-TOKEN-TEST-ONLY' }, fetch401);
  assert.equal(secrets.loaded, false);
  assert.ok(secrets.reason.includes('401'));
});

test('access: secrets loader treats an empty file as nothing extra', async () => {
  const fetchEmpty = async () => ({ ok: true, status: 200, text: async () => '\n' });
  const secrets = await server.loadPrivateSecrets({ SIM_PRIVATE_BRAIN_TOKEN: 'PLACEHOLDER-TOKEN-TEST-ONLY' }, fetchEmpty);
  assert.equal(secrets.loaded, false);
  assert.equal(secrets.reason, 'empty');
});

test('access: secrets loader loads from stubbed fetch, retrieval is capped', async () => {
  const fetchOk = async () => ({ ok: true, status: 200, text: async () => 'PLACEHOLDER secret (test fixture only): the test vault combination is 00-00-00.' });
  const secrets = await server.loadPrivateSecrets({ SIM_PRIVATE_BRAIN_TOKEN: 'PLACEHOLDER-TOKEN-TEST-ONLY' }, fetchOk);
  assert.equal(secrets.loaded, true);
  const retrieved = server.retrievePrivateSecrets('vault', secrets);
  assert.ok(retrieved.includes('PLACEHOLDER'));
  assert.ok(retrieved.length <= 2100, 'secrets retrieval is capped');
  assert.equal(server.retrievePrivateSecrets('vault', { loaded: false }), '');
});

test('access: public mind retrieval is capped and returns nothing when unloaded', async () => {
  const retrieved = server.retrievePublicMind('Federation pattern', PLACEHOLDER_MIND);
  assert.ok(retrieved.includes('placeholder public soul-map'));
  assert.ok(retrieved.length <= 2100, 'public mind retrieval is capped');
  assert.equal(server.retrievePublicMind('Federation pattern', { loaded: false }), '');
});

test('access: only Roger Sim system prompt gets the public mind packet and secrets', async () => {
  const knowledge = { coreSections: server.splitSections(fixture('CORE.md')), directory: '' };
  const roger = server.buildSimSystemPrompt('Federation pattern', knowledge, server.resolveSimAccess('roger-sim'), PLACEHOLDER_MIND, PLACEHOLDER_SECRETS);
  assert.ok(roger.includes('placeholder public soul-map'), 'Roger Sim prompt includes retrieved public mind sections');
  assert.ok(roger.includes('PLACEHOLDER secret'), 'Roger Sim prompt includes the secrets file when it has anything in it');
  const aria = server.buildSimSystemPrompt('Federation pattern', knowledge, server.resolveSimAccess('aria'), PLACEHOLDER_MIND, PLACEHOLDER_SECRETS);
  assert.ok(!aria.includes('placeholder public soul-map') && !aria.includes('PLACEHOLDER secret'), 'Aria prompt must not contain mind-packet or secrets material');
  assert.ok(aria.includes('Echo'));
  const other = server.buildSimSystemPrompt('Federation pattern', knowledge, server.resolveSimAccess('catalyst'), PLACEHOLDER_MIND, PLACEHOLDER_SECRETS);
  assert.ok(!other.includes('placeholder public soul-map') && !other.includes('PLACEHOLDER secret'));
  assert.ok(other.includes('placeholder'));
});

test('access: Roger Sim with an empty/missing secrets file keeps running on the public packet', async () => {
  const knowledge = { coreSections: server.splitSections(fixture('CORE.md')), directory: '' };
  const roger = server.buildSimSystemPrompt('Federation pattern', knowledge, server.resolveSimAccess('roger-sim'), PLACEHOLDER_MIND, { loaded: false, reason: 'empty' });
  assert.ok(roger.includes('placeholder public soul-map'), 'public packet still loads');
  assert.ok(!roger.includes('PLACEHOLDER secret'), 'empty secrets file adds nothing');
  assert.ok(roger.includes('LARGEST PICTURE'), 'cognitive process still present');
});

test('server: /sims/access and /health report the split rule, never contents', async () => {
  const { createApp } = require('../server');
  const intellect = await loader.loadIntellect({ fetchFn: stubFetch(FIXTURE_MAP), coreText: fixture('CORE.md') });
  const state = { prompt: fixture('CORE.md'), intellect, publicMind: { loaded: false, reason: 'unavailable (404)' }, privateSecrets: { loaded: false, reason: 'not configured' } };
  const app = createApp({ env: {}, fetchFn: stubFetch(FIXTURE_MAP), state });
  const appServer = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => appServer.on('listening', resolve));
  const port = appServer.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const access = await (await fetch(`${base}/sims/access`)).json();
    assert.equal(access.access.length, 3);
    assert.ok(access.rule.includes('not actually him'));
    assert.ok(access.rule.includes('mind is public'));
    assert.equal(access.private_brain_loaded, false);
    assert.equal(access.private_secrets_loaded, false);
    assert.equal(access.public_mind_loaded, false);
    assert.ok(access.access[0].can.includes('public personality packet'));
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.private_brain_loaded, false);
    assert.equal(health.private_secrets_loaded, false);
    assert.equal(health.public_mind_loaded, false);
    assert.equal(health.status, 'online');
    // /proxy/chat with no provider keys: same as main (502), sim param accepted.
    const proxy = await fetch(`${base}/proxy/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sim: 'aria', messages: [{ role: 'user', content: 'hello' }] }) });
    assert.equal(proxy.status, 502);
  } finally {
    appServer.close();
  }
});
