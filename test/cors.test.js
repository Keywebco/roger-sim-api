// CORS tests — Federation origins get Access-Control-Allow-Origin on
// /proxy/chat (preflight and actual requests); other origins do not.
// Regression for 2026-11-13: next-xus.biz was missing from the allowlist,
// so the guide-bot panels on the .biz desktop fell back to local answers.
// No provider keys, no network: preflight is answered by the cors
// middleware before any route runs. Run with `npm test`.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../server');

const ALLOWED_ORIGINS = [
  'https://next-xus.biz',
  'https://www.next-xus.biz',
  'https://next-xus.net',
  'https://next-xus.org',
  'https://next-xus.info',
  'https://keywebco.github.io',
];

async function startApp() {
  const app = createApp({ env: {}, state: { prompt: '' } });
  const appServer = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => appServer.on('listening', resolve));
  const base = `http://127.0.0.1:${appServer.address().port}`;
  return { appServer, base };
}

async function preflight(base, origin) {
  return fetch(`${base}/proxy/chat`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
}

test('cors: preflight from every Federation origin returns its own Access-Control-Allow-Origin', async () => {
  const { appServer, base } = await startApp();
  try {
    for (const origin of ALLOWED_ORIGINS) {
      const res = await preflight(base, origin);
      assert.equal(res.status, 204, `preflight from ${origin} should be 204`);
      assert.equal(res.headers.get('access-control-allow-origin'), origin, `preflight from ${origin} should echo its origin`);
    }
  } finally {
    appServer.close();
  }
});

test('cors: preflight from an outside origin gets no Access-Control-Allow-Origin', async () => {
  const { appServer, base } = await startApp();
  try {
    const res = await preflight(base, 'https://example.com');
    assert.equal(res.headers.get('access-control-allow-origin'), null, 'outside origin must not get an ACAO header');
  } finally {
    appServer.close();
  }
});

test('cors: an actual request from next-xus.biz carries Access-Control-Allow-Origin', async () => {
  const { appServer, base } = await startApp();
  try {
    const res = await fetch(`${base}/health`, { headers: { Origin: 'https://next-xus.biz' } });
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://next-xus.biz');
  } finally {
    appServer.close();
  }
});
