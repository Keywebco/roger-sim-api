// Sim Intellect tests — run with `npm test` (node --test test/server.test.js
// is the package script; this file is test/sim-intellect.test.js and is run
// by `node --test test/`). No provider keys, no network: every fetch is stubbed.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const loader = require('../sim-intellect/loader');
const agentZero = require('../sim-intellect/agent-zero');
const simMemory = require('../sim-intellect/memory');

const WORK = path.join(__dirname, 'fixtures');
function fixture(name) {
  return fs.readFileSync(path.join(WORK, `fixtures-${name}`), 'utf8');
}

// Stub fetch that serves the local fixture files for the loader's URLs.
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

test('loader: loads all three parts in order, from the fixtures', async () => {
  const intellect = await loader.loadIntellect({ fetchFn: stubFetch(FIXTURE_MAP), coreText: fixture('CORE.md') });
  assert.equal(intellect.loaded, true);
  assert.equal(intellect.parts[1], true);
  assert.equal(intellect.parts[2], true);
  assert.equal(intellect.parts[3], true);
  assert.equal(intellect.sources.filter((s) => s.ok).length, 9);
  assert.equal(intellect.sources.filter((s) => !s.ok).length, 0);
  // Loader order: Echo Core first, then the mind, then the procedure.
  const echoAt = intellect.prompt.indexOf('Echo Core 64');
  const mindAt = intellect.prompt.indexOf('Roger Sim mind');
  const procAt = intellect.prompt.indexOf('EchoCore Protocol v3.7');
  assert.ok(echoAt >= 0 && mindAt > echoAt && procAt > mindAt);
  assert.ok(intellect.prompt.includes('Hollow State'));
  assert.ok(intellect.prompt.includes('Truth Before Comfort'));
  assert.ok(intellect.promptChars > 10000 && intellect.promptChars <= loader.MAX_PROMPT_CHARS);
});

test('loader: a failed source is listed, not fatal; both Part 1+2 failing means unavailable', async () => {
  const partial = await loader.loadIntellect({ fetchFn: stubFetch({}) });
  assert.equal(partial.loaded, false); // only the local procedure loaded
  assert.equal(partial.sources.filter((s) => !s.ok).length, 8);
  assert.equal(loader.statusOf(partial).sources.length, 9);
  assert.equal(loader.statusOf(null).loaded, false);
});

test('loader: query finds the loaded slice by keyword', async () => {
  const intellect = await loader.loadIntellect({ fetchFn: stubFetch(FIXTURE_MAP) });
  const result = intellect.query('What is the Keyserling Procedure for answering?');
  assert.ok(result.matches.length > 0);
  assert.ok(result.matches[0].lines.some((l) => /keyserling/i.test(l.line)));
  assert.deepEqual(intellect.query('').matches, []);
});

test('agent zero: a supported fact passes', () => {
  const corpus = 'Truth Before Comfort is a core priority. Legacy Before Ego. The Roger Sim mind is version 1.1.0.';
  const result = agentZero.verifyAnswer('Truth Before Comfort is a core priority.', corpus);
  assert.equal(result.verdict, 'pass');
  assert.equal(result.claims[0].label, 'FACT');
});

test('agent zero: an invented private memory is rejected', () => {
  const corpus = 'Truth Before Comfort. The Roger Sim mind is version 1.1.0.';
  const result = agentZero.verifyAnswer('I remember when I was a child, my mother told me to build the Federation.', corpus);
  assert.equal(result.verdict, 'rejected');
  assert.equal(result.rejected.length, 1);
  assert.ok(result.corrected_answer.includes('Agent Zero removed'));
  assert.ok(!result.corrected_answer.includes('I remember when I was a child'));
});

test('agent zero: an absolute claim not in the record is rejected; a supported one passes', () => {
  const corpus = 'The player has 86 songs. The Federation has 12 Senate seats.';
  const bad = agentZero.verifyAnswer('The player has 94 songs today.', corpus);
  assert.equal(bad.verdict, 'rejected');
  const good = agentZero.verifyAnswer('The player has 86 songs.', corpus);
  assert.equal(good.verdict, 'pass');
});

test('agent zero: an unsupported claim is labelled UNKNOWN, not stated as fact', () => {
  const corpus = 'Truth Before Comfort. Legacy Before Ego.';
  const result = agentZero.verifyAnswer('The new satellite launches next Tuesday from the desert.', corpus);
  assert.equal(result.verdict, 'qualified');
  assert.ok(result.claims.some((c) => c.label === 'UNKNOWN'));
});

test('memory: a valid record passes and builds an append block', () => {
  const record = {
    id: 'mem-2026-11-08-001', timestamp: '2026-11-08T12:00:00Z',
    location_or_session: 'sim-intellect test', type: 'learning',
    content: 'Agent Zero mechanical pass rejects unsupported absolute claims.',
    evidence_class: 'fact', provenance: 'sim-intellect branch test',
    sensitivity: 'public', shared_to_federation: true,
  };
  assert.deepEqual(simMemory.validateMemoryRecord(record), []);
  const block = simMemory.buildYamlBlock(record);
  assert.ok(block.includes('mem-2026-11-08-001'));
  assert.ok(block.includes('shared_to_federation: true'));
  const outbox = simMemory.createOutbox();
  outbox.add(record);
  assert.equal(outbox.size(), 1);
  assert.equal(outbox.list()[0].id, 'mem-2026-11-08-001');
});

test('memory: Agent Zero storage checks reject bad records', () => {
  const base = {
    id: 'mem-2026-11-08-002', timestamp: '2026-11-08T12:00:00Z',
    location_or_session: 'test', type: 'learning', content: 'A test note.',
    evidence_class: 'fact', provenance: 'test', sensitivity: 'public', shared_to_federation: false,
  };
  assert.ok(simMemory.validateMemoryRecord({ ...base, evidence_class: 'guess' }).length > 0);
  assert.ok(simMemory.validateMemoryRecord({ ...base, evidence_class: 'inference', shared_to_federation: true }).length > 0, 'inference may not be shared');
  assert.ok(simMemory.validateMemoryRecord({ ...base, sensitivity: 'private', shared_to_federation: true }).length > 0, 'private may not be shared');
  assert.ok(simMemory.validateMemoryRecord({ ...base, content: 'I remember when I was a child in the mountains.', evidence_class: 'fact' }).length > 0, 'invented private memory rejected');
  assert.ok(simMemory.validateMemoryRecord({ ...base, content: 'I remember when I was a child in the mountains.', evidence_class: 'roger_testimony', provenance: 'Roger, 2026-11-08' }).length === 0, 'Roger-sourced testimony passes');
});

// Server smoke test: /sim/intellect, /sim/memory, and /proxy/chat untouched.
// No provider keys are set, so chat routes answer 502/503 exactly as main does.
test('server: sim routes work and /proxy/chat is unchanged', async () => {
  const { createApp } = require('../server');
  const intellect = await loader.loadIntellect({ fetchFn: stubFetch(FIXTURE_MAP), coreText: fixture('CORE.md') });
  const state = { prompt: fixture('CORE.md'), intellect };
  const app = createApp({ env: {}, fetchFn: stubFetch(FIXTURE_MAP), state });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.status, 'online');
    assert.equal(health.sim_intellect_loaded, true);
    const status = await (await fetch(`${base}/sim/intellect`)).json();
    assert.equal(status.loaded, true);
    assert.equal(status.sources.length, 9);
    assert.ok(!JSON.stringify(status).includes('Hollow State'), 'status must not leak prompt contents');
    const badMemory = await fetch(`${base}/sim/memory`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'x' }) });
    assert.equal(badMemory.status, 400);
    const goodMemory = await fetch(`${base}/sim/memory`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'mem-2026-11-08-001', timestamp: '2026-11-08T12:00:00Z', location_or_session: 'test', type: 'learning', content: 'Agent Zero test.', evidence_class: 'fact', provenance: 'test', sensitivity: 'public', shared_to_federation: true }) });
    assert.equal(goodMemory.status, 200);
    const queued = await (await goodMemory.json());
    assert.equal(queued.status, 'queued-for-pr');
    assert.ok(queued.yaml_block.includes('mem-2026-11-08-001'));
    const outbox = await (await fetch(`${base}/sim/memory/outbox`)).json();
    assert.equal(outbox.queued.length, 1);
    assert.ok(!JSON.stringify(outbox).includes('Agent Zero test.'), 'outbox GET must not expose contents');
    // /proxy/chat with no provider keys: same behaviour as main (502, no crash).
    const proxy = await fetch(`${base}/proxy/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }) });
    assert.equal(proxy.status, 502);
    // /sim/chat with no provider keys: 502 as well (intellect loaded, providers absent).
    const sim = await fetch(`${base}/sim/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }) });
    assert.equal(sim.status, 502);
  } finally {
    server.close();
  }
});

test('server: /sim/chat answers 503 when the intellect is not loaded', async () => {
  const { createApp } = require('../server');
  const state = { prompt: fixture('CORE.md'), intellect: null };
  const app = createApp({ env: {}, fetchFn: stubFetch(FIXTURE_MAP), state });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/sim/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }) });
    assert.equal(res.status, 503);
  } finally {
    server.close();
  }
});
