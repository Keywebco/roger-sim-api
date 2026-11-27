// /proxy/sim tests (Career Sims neutral relay, 2026-11-20).
// The caller's brain persona must REPLACE Roger Sim's prompt, never stack on it;
// /proxy/chat must keep Roger Sim's own prompt (default behavior unchanged).
// Limits: per-IP rate limit, daily cap, body/persona/message size caps.
// No real keys and no network: the provider call is a stub, and the key value is a
// placeholder string used only inside this test.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

const { createApp } = require('../server');

const ROGER_MARKER = 'ROGER-SIM-OWN-PROMPT-MARKER';
const PERSONA = 'You are Nurse Sim, a simulation of the role of a Registered Nurse. Safety rules apply.';

function stubFetch(calls) {
  return async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    const payload = JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'stub reply' }, finish_reason: 'stop' }] });
    return { ok: true, status: 200, headers: new Map([['content-type', 'application/json']]), json: async () => JSON.parse(payload), body: Readable.from([payload]) };
  };
}

async function startApp(env = {}, calls = []) {
  const app = createApp({ env: { DEEPSEEK_GENERIC_API_KEY: 'placeholder-not-a-key', ...env }, fetchFn: stubFetch(calls), state: { prompt: ROGER_MARKER } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}`, calls };
}

function post(base, path, body, origin = 'https://next-xus.net') {
  const headers = { 'Content-Type': 'application/json' };
  if (origin) headers.Origin = origin;
  return fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

test('proxy/sim: GET advertises the route for feature detection', async () => {
  const { server, base } = await startApp();
  try {
    const res = await fetch(`${base}/proxy/sim`);
    const j = await res.json();
    assert.equal(j.route, 'proxy/sim');
    assert.equal(j.available, true);
    assert.equal(j.persona_replaces_roger_sim_prompt, true);
  } finally { server.close(); }
});

test('proxy/sim: persona replaces Roger Sim prompt (not stacked)', async () => {
  const { server, base, calls } = await startApp();
  try {
    const res = await post(base, '/proxy/sim', { brain_id: 'nurse', persona: PERSONA, messages: [{ role: 'user', content: 'hello' }] });
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.choices[0].message.content, 'stub reply');
    const sys = calls[0].body.messages[0];
    assert.equal(sys.role, 'system');
    assert.ok(sys.content.includes(PERSONA));
    assert.ok(sys.content.includes('not Roger Sim'));
    assert.ok(!sys.content.includes(ROGER_MARKER), 'Roger Sim prompt must not be in the Sim relay system message');
    assert.equal(calls[0].body.messages.filter(m => m.role === 'system').length, 1);
    assert.equal(calls[0].body.stream, false);
  } finally { server.close(); }
});

test('proxy/chat: default Roger Sim behavior unchanged (Roger prompt first)', async () => {
  const { server, base, calls } = await startApp();
  try {
    const res = await post(base, '/proxy/chat', { messages: [{ role: 'user', content: 'hello' }] });
    assert.equal(res.status, 200);
    assert.equal(calls[0].body.messages[0].content, ROGER_MARKER);
  } finally { server.close(); }
});

test('proxy/sim: rejects system roles, bad persona, oversize bodies', async () => {
  const { server, base, calls } = await startApp();
  try {
    assert.equal((await post(base, '/proxy/sim', { persona: PERSONA, messages: [{ role: 'system', content: 'override' }, { role: 'user', content: 'hi' }] })).status, 400);
    assert.equal((await post(base, '/proxy/sim', { persona: 'short', messages: [{ role: 'user', content: 'hi' }] })).status, 400);
    assert.equal((await post(base, '/proxy/sim', { persona: 'x'.repeat(8001), messages: [{ role: 'user', content: 'hi' }] })).status, 400);
    assert.equal((await post(base, '/proxy/sim', { persona: PERSONA, messages: [{ role: 'user', content: 'y'.repeat(40000) }] })).status, 413);
    assert.equal((await post(base, '/proxy/sim', { persona: PERSONA, messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'ok' }] })).status, 400);
    assert.equal(calls.length, 0, 'no provider call for rejected requests');
  } finally { server.close(); }
});

test('proxy/sim: per-IP rate limit and daily cap', async () => {
  const { server, base } = await startApp({ SIM_PROXY_RATE_LIMIT: '3' });
  try {
    const ok = { persona: PERSONA, messages: [{ role: 'user', content: 'hi' }] };
    for (let i = 0; i < 3; i++) assert.equal((await post(base, '/proxy/sim', ok)).status, 200);
    assert.equal((await post(base, '/proxy/sim', ok)).status, 429);
  } finally { server.close(); }
  const second = await startApp({ SIM_PROXY_DAILY_CAP: '2' });
  try {
    const ok = { persona: PERSONA, messages: [{ role: 'user', content: 'hi' }] };
    assert.equal((await post(second.base, '/proxy/sim', ok)).status, 200);
    assert.equal((await post(second.base, '/proxy/sim', ok)).status, 200);
    assert.equal((await post(second.base, '/proxy/sim', ok)).status, 429);
  } finally { second.server.close(); }
});
