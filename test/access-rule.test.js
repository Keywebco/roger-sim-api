// Access-rule tests — Step 2 of the Sim Redesign Proposal.
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

// Placeholder private brain only — labelled, invented, never real contents.
const PLACEHOLDER_BRAIN = {
  loaded: true,
  prompt: 'PLACEHOLDER private prompt (test fixture only, not real contents).',
  soulMap: '## Placeholder Soul\nThis is a placeholder soul-map section about the Federation pattern, for tests only.\n\n## Placeholder Memory\nA placeholder memory about building the Federation, for tests only.',
};

test('access: Roger Sim is the only Sim with the private brain', () => {
  assert.equal(server.resolveSimAccess('roger-sim').privateBrain, true);
  assert.equal(server.resolveSimAccess('roger').privateBrain, true);
  assert.equal(server.resolveSimAccess().privateBrain, true, 'default is Roger Sim');
  assert.equal(server.resolveSimAccess('aria').privateBrain, false);
  assert.equal(server.resolveSimAccess('catalyst').privateBrain, false);
  assert.equal(server.resolveSimAccess('pontus').privateBrain, false);
  assert.ok(server.resolveSimAccess('aria').note.includes('Echo'));
  assert.ok(server.resolveSimAccess('catalyst').note.includes('placeholder'));
  assert.equal(server.accessTable().length, 3);
});

test('access: private brain loader is fail-closed with no token', async () => {
  const brain = await server.loadPrivateBrain({}, async () => { throw new Error('must not fetch without a token'); });
  assert.equal(brain.loaded, false);
  assert.equal(brain.reason, 'not configured');
});

test('access: private brain loader is fail-closed on a 401', async () => {
  const fetch401 = async () => ({ ok: false, status: 401, text: async () => '' });
  const brain = await server.loadPrivateBrain({ SIM_PRIVATE_BRAIN_TOKEN: 'PLACEHOLDER-TOKEN-TEST-ONLY' }, fetch401);
  assert.equal(brain.loaded, false);
  assert.ok(brain.reason.includes('401'));
});

test('access: private brain loads from stubbed fetch, retrieval is capped', async () => {
  const fetchOk = async () => ({ ok: true, status: 200, text: async () => 'PLACEHOLDER private file text about the Federation pattern.' });
  const brain = await server.loadPrivateBrain({ SIM_PRIVATE_BRAIN_TOKEN: 'PLACEHOLDER-TOKEN-TEST-ONLY' }, fetchOk);
  assert.equal(brain.loaded, true);
  const retrieved = server.retrievePrivateBrain('Federation pattern', brain);
  assert.ok(retrieved.includes('PLACEHOLDER'));
  assert.ok(retrieved.length <= 2100, 'private retrieval is capped');
  assert.equal(server.retrievePrivateBrain('Federation pattern', { loaded: false }), '');
});

test('access: only Roger Sim system prompt gets private material', async () => {
  const knowledge = { coreSections: server.splitSections(fixture('CORE.md')), directory: '' };
  const roger = server.buildSimSystemPrompt('Federation pattern', knowledge, server.resolveSimAccess('roger-sim'), PLACEHOLDER_BRAIN);
  assert.ok(roger.includes('PLACEHOLDER private file text') || roger.includes('placeholder soul-map') || roger.includes('PLACEHOLDER'), 'Roger Sim prompt includes retrieved private sections');
  const aria = server.buildSimSystemPrompt('Federation pattern', knowledge, server.resolveSimAccess('aria'), PLACEHOLDER_BRAIN);
  assert.ok(!aria.includes('PLACEHOLDER private file text') && !aria.includes('placeholder soul-map'), 'Aria prompt must not contain private material');
  assert.ok(aria.includes('Echo'));
  const other = server.buildSimSystemPrompt('Federation pattern', knowledge, server.resolveSimAccess('catalyst'), PLACEHOLDER_BRAIN);
  assert.ok(!other.includes('PLACEHOLDER private file text') && !other.includes('placeholder soul-map'));
  assert.ok(other.includes('placeholder'));
});

test('server: /sims/access and /health report the rule, never contents', async () => {
  const { createApp } = require('../server');
  const intellect = await loader.loadIntellect({ fetchFn: stubFetch(FIXTURE_MAP), coreText: fixture('CORE.md') });
  const state = { prompt: fixture('CORE.md'), intellect, privateBrain: { loaded: false, reason: 'not configured' } };
  const app = createApp({ env: {}, fetchFn: stubFetch(FIXTURE_MAP), state });
  const appServer = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => appServer.on('listening', resolve));
  const port = appServer.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const access = await (await fetch(`${base}/sims/access`)).json();
    assert.equal(access.access.length, 3);
    assert.ok(access.rule.includes('not actually him'));
    assert.equal(access.private_brain_loaded, false);
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.private_brain_loaded, false);
    assert.equal(health.status, 'online');
    // /proxy/chat with no provider keys: same as main (502), sim param accepted.
    const proxy = await fetch(`${base}/proxy/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sim: 'aria', messages: [{ role: 'user', content: 'hello' }] }) });
    assert.equal(proxy.status, 502);
  } finally {
    appServer.close();
  }
});
