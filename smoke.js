'use strict';
// Unified smoke test: Sim Intellect wiring (PR #8) + structured cognitive
// process with per-request retrieval (PR #9), real public GitHub fetches,
// no provider keys needed.
const assert = require('node:assert/strict');
const {
  loadPrompt, loadKnowledge, buildSystemPrompt, retrieveSections,
  retrieveDirectory, splitSections, COGNITIVE_PROCESS, createApp,
} = require('./server.js');
const { loadIntellect } = require('./sim-intellect/loader');
const nodeFetch = require('node-fetch');

(async () => {
  // 1. Cognitive process contains all six required steps, in order.
  const steps = ['LARGEST PICTURE', 'FOUNDATION AND ASSUMPTIONS', 'CONTRADICTION AS INFORMATION',
    'RECONSTRUCT', 'APPLY ELSEWHERE', 'IRRATIONAL REMAINDER'];
  let last = -1;
  for (const s of steps) {
    const i = COGNITIVE_PROCESS.indexOf(s);
    assert.ok(i > last, `step ${s} present and in order`);
    last = i;
  }
  assert.ok(COGNITIVE_PROCESS.includes('working model, not the private Sim mind'));

  // 2. loadPrompt: no full CORE dump (CORE is 32,850 bytes; prompt must be far smaller).
  const prompt = await loadPrompt();
  console.log('loadPrompt length:', prompt.length);
  assert.ok(prompt.length < 5000, 'loadPrompt must not dump the whole CORE file');
  assert.ok(prompt.includes('LARGEST PICTURE'));

  // 3. loadKnowledge: real public fetches, CORE split into sections.
  const knowledge = await loadKnowledge();
  console.log('CORE sections:', knowledge.coreSections.map((s) => s.title).join(' | '));
  assert.ok(knowledge.coreSections.length >= 8, 'CORE has 8+ sections');
  assert.ok(knowledge.directory.length > 10000, 'Directory loaded');
  assert.ok(knowledge.core.length > 30000);

  // 4. Retrieval is query-dependent and deterministic.
  const lib = buildSystemPrompt('library books librarian', knowledge);
  const music = buildSystemPrompt('music player songs playlist', knowledge);
  assert.notEqual(lib, music, 'different queries retrieve different material');
  assert.equal(lib, buildSystemPrompt('library books librarian', knowledge), 'deterministic');
  assert.ok(lib.includes('LARGEST PICTURE'));
  assert.ok(lib.length < prompt.length + 6000, 'retrieved material is capped');
  console.log('library prompt length:', lib.length, '| music prompt length:', music.length);
  const noMatch = retrieveSections('zzzzqqqq', knowledge.coreSections);
  assert.equal(noMatch.length, 2, 'no-match falls back to first two sections');
  const dirHits = retrieveDirectory('Ring of Twelve', knowledge.directory);
  assert.ok(dirHits.length > 0 && dirHits.length <= 8);
  console.log('directory hits for "Ring of Twelve":', dirHits.slice(0, 3));

  // 5. Sim Intellect: real public fetches, all 9 sources.
  const intellect = await loadIntellect({ fetchFn: nodeFetch, coreText: knowledge.core });
  const okCount = intellect.sources.filter((s) => s.ok).length;
  console.log(`intellect: ${okCount}/${intellect.sources.length} sources, prompt ${intellect.promptChars} chars, parts 1/2/3 = ${intellect.parts[1]}/${intellect.parts[2]}/${intellect.parts[3]}`);
  assert.equal(intellect.loaded, true);
  assert.equal(okCount, 9, 'all 9 intellect sources loaded');
  assert.ok(intellect.prompt.includes('Hollow State'), 'procedure in intellect prompt');
  assert.ok(intellect.parts[1] && intellect.parts[2] && intellect.parts[3]);

  // 6. /sim/chat system-prompt order: intellect procedure first, then the
  // cognitive process, then retrieved material. Verified by construction:
  // build the prompt the route builds and check the order of its parts.
  const query = 'What is the Keyserling Procedure?';
  const combined = [intellect.prompt, buildSystemPrompt(query, knowledge)].join('\n\n');
  const procAt = combined.indexOf('Hollow State');
  const cogAt = combined.indexOf('LARGEST PICTURE');
  assert.ok(procAt >= 0 && cogAt > procAt, 'intellect procedure precedes cognitive process');
  // Retrieval is capped (top 2 CORE sections max 4000 chars + process +
  // directory lines), so the combined prompt stays well under the intellect
  // prompt + ~9,000 chars — no full 32,850-byte CORE dump in it.
  assert.ok(combined.length < intellect.promptChars + 9000, 'no full CORE dump in combined prompt');
  console.log('combined /sim/chat system prompt length:', combined.length);

  // 7. App smoke: /health online with intellect loaded; /sim/intellect 9/9;
  // /proxy/chat and /sim/chat 502 with no keys (same as main).
  const app = createApp({ state: { prompt, knowledge, intellect } });
  const server = app.listen(0, '127.0.0.1', async () => {
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;
    try {
      const health = await (await fetch(`${base}/health`)).json();
      console.log('health:', JSON.stringify(health));
      assert.equal(health.status, 'online');
      assert.equal(health.corpus_loaded, true);
      assert.equal(health.sim_intellect_loaded, true);
      const status = await (await fetch(`${base}/sim/intellect`)).json();
      console.log('sim/intellect loaded:', status.loaded, 'sources ok:', status.sources.filter((s) => s.ok).length, '/', status.sources.length);
      assert.equal(status.loaded, true);
      assert.equal(status.sources.filter((s) => s.ok).length, 9);
      const proxy = await fetch(`${base}/proxy/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'What is the library?' }] }),
      });
      console.log('proxy/chat status (no provider keys):', proxy.status);
      assert.equal(proxy.status, 502, 'same as main with no keys configured');
      const sim = await fetch(`${base}/sim/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'What is the Keyserling Procedure?' }] }),
      });
      console.log('sim/chat status (no provider keys):', sim.status);
      assert.equal(sim.status, 502, 'same as main with no keys configured');
      const outbox = await (await fetch(`${base}/sim/memory/outbox`)).json();
      assert.deepEqual(outbox.queued, []);
      console.log('ALL UNIFIED SMOKE TESTS PASSED');
      server.close(() => process.exit(0));
    } catch (e) {
      server.close(() => { console.error('FAIL:', e); process.exit(1); });
    }
  });
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });
