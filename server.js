// Roger Sim API — public-only load 2026-11-01, Gumroad verify added 2026-11-01 (branch).
// Sim Intellect wiring 2026-11-08 (branch sim-intellect-wiring-2026-11-08):
//   /sim/chat loads the three-part Sim-intellect combination per call
//   (EchoCore v3.7 procedure + Keyserling Procedure + Agent Zero, the
//   Roger Sim mind-layer files, and the YAML-database slice), runs Agent
//   Zero as a real second pass, and queues memory for a branch/PR filing.
//   /proxy/chat is unchanged. No token, no secret, no new service.
// Change: loadPrompt uses only the public FEDERATION-CORE-KNOWLEDGE.md.
// The private roger-sim-brain attempt is removed entirely. No GITHUB_TOKEN is used.
// Working-model header is kept.
'use strict';

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const simIntellect = require('./sim-intellect/loader');
const agentZero = require('./sim-intellect/agent-zero');
const simMemory = require('./sim-intellect/memory');

const CORE_URL = 'https://raw.githubusercontent.com/Keywebco/nextxus-free-satellites/main/knowledge-base/FEDERATION-CORE-KNOWLEDGE.md';
const NEWS_URL = 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent('https://feeds.bbci.co.uk/news/world/rss.xml');
const CRYPTO_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd';
const KRAKEN_URL = 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD,SOLUSD';
const PROVIDERS = {
  deepseek: { url: 'https://api.deepseek.com/v1/chat/completions', env: 'DEEPSEEK_GENERIC_API_KEY', model: 'deepseek-chat' },
  mimo: { url: 'https://api.xiaomimimo.com/v1/chat/completions', env: 'MIMO_API_KEY', model: 'mimo-v2.6-flash' },
  gemini: { url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', env: 'GEMINI_API_KEY', model: 'gemini-2.5-pro' },
  emergent: { url: 'https://integrations.emergentagent.com/llm/v1/chat/completions', env: 'EMERGENT_LLM_KEY', model: 'gpt-4o-mini' }
};

function providerOrder(model) {
  const first = model === 'deepseek-chat' || model === 'deepseek' ? 'deepseek'
    : model === 'mimo' || model === 'mimo-code' ? 'mimo'
      : model === 'gemini' || model === 'gemini-pro' ? 'gemini' : 'emergent';
  return [first, ...['deepseek', 'mimo', 'emergent'].filter(name => name !== first)];
}

async function request(url, options = {}, timeoutMs = 15000, fetchFn = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readText(url, options, fetchFn) {
  const response = await request(url, options, 20000, fetchFn);
  if (!response.ok) throw new Error(`source unavailable (${response.status})`);
  return response.text();
}

async function loadPrompt(env = process.env, fetchFn = fetch) {
  const coreKnowledge = await readText(CORE_URL, { headers: { 'User-Agent': 'roger-sim-api' } }, fetchFn);
  if (!coreKnowledge.trim()) throw new Error('Public CORE knowledge is empty');
  // Working-model header, kept. This is NOT the private Sim prompt or corpus.
  const workingHeader = 'Roger Sim — Working Model. You are Roger Sim in working-model form. Answer from the Federation CORE knowledge below, about pillars, tools, directory, music, library, and working pages. State clearly when you are giving a working-model answer, not the private Sim mind.';
  // Public only: no private roger-sim-brain attempt, no GITHUB_TOKEN.
  return [workingHeader, coreKnowledge].join('\n\n---\n\n');
}

function createApp({ env = process.env, fetchFn = fetch, state = { prompt: '' } } = {}) {
  if (!state.outbox) state.outbox = simMemory.createOutbox();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(cors({ origin(origin, callback) {
    if (!origin || origin === 'https://keywebco.github.io' || origin === 'https://next-xus.net' || origin === 'https://next-xus.info' || origin === 'https://next-xus.org' || /^http:\/\/localhost(?::\d+)?$/.test(origin)) return callback(null, true);
    return callback(null, false);
  } }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({ status: state.prompt ? 'online' : 'unavailable', mind: 'Roger Sim', corpus_loaded: Boolean(state.prompt), sim_intellect_loaded: Boolean(state.intellect && state.intellect.loaded), timestamp: new Date().toISOString() }));

  // Root route: previously unimplemented (Express returned 'Cannot GET /').
  // Working model only: public CORE knowledge, no private Sim brain claim.
  app.get('/', (_req, res) => res.json({ service: 'roger-sim-api', mind: 'Roger Sim', status: state.prompt ? 'online' : 'unavailable', corpus_loaded: Boolean(state.prompt), sim_intellect_loaded: Boolean(state.intellect && state.intellect.loaded), health: '/health', sim_intellect: '/sim/intellect', note: 'working model, public CORE only; /sim/chat is the Sim-intellect route (branch, not live)' }));

  app.get('/world', async (_req, res) => {
    const [newsResult, cryptoResult] = await Promise.allSettled([request(NEWS_URL, {}, 10000, fetchFn), request(CRYPTO_URL, { headers: { Accept: 'application/json', 'User-Agent': 'Roger-Sim/1.0 (public-world-monitor)' } }, 10000, fetchFn)]);
    let news = [];
    let crypto = {};
    if (newsResult.status === 'fulfilled' && newsResult.value.ok) {
      try {
        const data = await newsResult.value.json();
        if (Array.isArray(data.items)) news = data.items.slice(0, 5);
      } catch (_error) { /* Unavailable news is an empty list. */ }
    }
    if (cryptoResult.status === 'fulfilled' && cryptoResult.value.ok) {
      try {
        const data = await cryptoResult.value.json();
        if (data && typeof data === 'object' && !Array.isArray(data)) crypto = data;
      } catch (_error) { /* Unavailable prices are an empty object. */ }
    }
    if (!Object.keys(crypto).length) {
      try {
        const backup = await request(KRAKEN_URL, {}, 8000, fetchFn);
        if (backup.ok) {
          const data = await backup.json();
          if (Array.isArray(data.error) && !data.error.length && data.result) {
            for (const [coin, pair] of [['bitcoin', 'XXBTZUSD'], ['ethereum', 'XETHZUSD'], ['solana', 'SOLUSD']]) {
              const price = Number(data.result[pair]?.c?.[0]);
              if (Number.isFinite(price) && price > 0) crypto[coin] = { usd: price };
            }
          }
        }
      } catch (_error) { /* Both feeds unavailable: return empty prices. */ }
    }
    res.json({ news, crypto, fetched_at: new Date().toISOString() });
  });

  // Non-streaming provider call, for /sim/chat and the optional Agent Zero
  // LLM pass. Same provider chain as chatCompletion; returns the full text
  // instead of piping a stream, so Agent Zero can check it before reply.
  async function completeChat({ model = 'deepseek-chat', messages }) {
    for (const name of providerOrder(model)) {
      const provider = PROVIDERS[name];
      const key = env[provider.env];
      if (!key) continue;
      try {
        const upstream = await request(provider.url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: provider.model, messages, stream: false }),
        }, 90000, fetchFn);
        if (!upstream.ok) { upstream.body?.resume(); continue; }
        const data = await upstream.json();
        const text = data?.choices?.[0]?.message?.content;
        if (typeof text !== 'string' || !text.trim()) continue;
        return { ok: true, provider: name, model: provider.model, text };
      } catch (_error) { /* Try the next configured provider. */ }
    }
    return { ok: false, error: 'All configured model providers are unavailable' };
  }

  // ---- Sim Intellect routes (branch only; /proxy/chat above is unchanged) ----
  // GET /sim/intellect — what the loader loaded, sizes and status only.
  // Never returns prompt contents.
  app.get('/sim/intellect', (_req, res) => res.json({ service: 'sim-intellect', ...simIntellect.statusOf(state.intellect || null), core_loaded: Boolean(state.prompt) }));

  // POST /sim/chat — draft answer from the intellect prompt, then the real
  // Agent Zero second pass. Body: { model?, messages } (same shape as /proxy/chat).
  app.post('/sim/chat', async (req, res) => {
    if (!state.intellect || !state.intellect.loaded) return res.status(503).json({ error: 'Sim intellect is not loaded yet' });
    if (!state.prompt) return res.status(503).json({ error: 'Roger Sim knowledge is not loaded' });
    const { model = 'deepseek-chat', messages } = req.body || {};
    if (!Array.isArray(messages) || !messages.length || messages.some((message) => !message || typeof message !== 'object' || !['system', 'developer', 'user', 'assistant', 'tool'].includes(message.role))) {
      return res.status(400).json({ error: 'A nonempty messages array with valid roles is required' });
    }
    // The user's question, for the YAML-DB keyword query (loaded slice only).
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const dbQuery = lastUser ? state.intellect.query(lastUser.content || '') : { question: '', matches: [] };
    const systemPrompt = [
      state.intellect.prompt,
      '---\n\nFederation CORE knowledge (public):',
      state.prompt,
      dbQuery.matches.length ? `---\n\nYAML-database matches for this question (keyword search over the loaded slice):\n${JSON.stringify(dbQuery.matches, null, 2)}` : '',
    ].filter(Boolean).join('\n\n');
    const draft = await completeChat({ model, messages: [{ role: 'system', content: systemPrompt }, ...messages] });
    if (!draft.ok) return res.status(502).json({ error: draft.error });
    // Agent Zero, mechanical pass: always on, the floor.
    const mechanical = agentZero.verifyAnswer(draft.text, state.intellect.corpus);
    let agentZeroResult = { ...mechanical, llm_pass: 'off' };
    // Optional LLM pass: only with SIM_INTELLECT_AGENT_ZERO_LLM=1. It can
    // only qualify/reject further; it never overturns a mechanical REJECT.
    if (env.SIM_INTELLECT_AGENT_ZERO_LLM === '1') {
      const llm = await agentZero.llmSecondPass(
        (llmMessages) => completeChat({ model, messages: llmMessages }),
        draft.text, state.intellect.corpus.slice(0, 8000),
      );
      if (llm) {
        const llmRejected = llm.claims.filter((c) => c.label === 'REJECT');
        agentZeroResult = { ...mechanical, llm_pass: 'on', llm_verdict: llm.verdict, llm_claims: llm.claims };
        if (llmRejected.length && mechanical.verdict !== 'rejected') {
          agentZeroResult.verdict = 'rejected';
          agentZeroResult.rejected = [...agentZeroResult.rejected, ...llmRejected.map((c) => ({ text: c.text, reason: c.reason || 'Rejected by the Agent Zero LLM pass.' }))];
        }
      } else {
        agentZeroResult.llm_pass = 'attempted-unavailable';
      }
    }
    return res.json({
      answer: mechanical.corrected_answer,
      draft_answer: draft.text,
      agent_zero: agentZeroResult,
      provider: draft.provider, model: draft.model,
      intellect: { loaded_at: state.intellect.loadedAt, db_query: dbQuery },
    });
  });

  // POST /sim/memory — validate a memory record, run the Agent Zero storage
  // checks, and queue it for filing as a branch/PR proposal in
  // Keywebco/nextxus-yaml source/roger-sim/mind/memory-log.yaml.
  // Nothing is written to any repo from this server.
  app.post('/sim/memory', (req, res) => {
    const record = req.body || {};
    const errors = simMemory.validateMemoryRecord(record);
    if (errors.length) return res.status(400).json({ status: 'rejected', errors });
    const queued = state.outbox.add(record);
    return res.json({
      status: 'queued-for-pr', record_id: record.id, queued,
      yaml_block: simMemory.buildYamlBlock(record),
      file_to: 'Keywebco/nextxus-yaml source/roger-sim/mind/memory-log.yaml (append-only)',
      next_step: 'File as a branch + PR; Roger merges. Nothing is written to main from this server.',
    });
  });

  // GET /sim/memory/outbox — queued record metadata only (no contents).
  app.get('/sim/memory/outbox', (_req, res) => res.json({ queued: state.outbox.list() }));

  async function chatCompletion(req, res) {
    if (env.BRIDGE_TOKEN && req.get('authorization') !== `Bearer ${env.BRIDGE_TOKEN}`) return res.status(401).json({ error: 'Unauthorized' });
    if (!state.prompt) return res.status(503).json({ error: 'Roger Sim knowledge is not loaded' });
    const { model = 'deepseek-chat', messages, stream = false } = req.body || {};
    if (!Array.isArray(messages) || !messages.length || messages.some(message => !message || typeof message !== 'object' || !['system', 'developer', 'user', 'assistant', 'tool'].includes(message.role))) {
      return res.status(400).json({ error: 'A nonempty messages array with valid roles is required' });
    }
    if (typeof model !== 'string' || typeof stream !== 'boolean') return res.status(400).json({ error: 'Invalid model or stream' });
    const preparedMessages = [{ role: 'system', content: state.prompt }, ...messages];
    for (const name of providerOrder(model)) {
      const provider = PROVIDERS[name];
      const key = env[provider.env];
      if (!key) continue;
      try {
        const upstream = await request(provider.url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: provider.model, messages: preparedMessages, stream })
        }, 90000, fetchFn);
        if (!upstream.ok) {
          upstream.body?.resume();
          continue;
        }
        res.status(upstream.status);
        res.set('Content-Type', upstream.headers.get('content-type') || (stream ? 'text/event-stream' : 'application/json'));
        res.set('Cache-Control', 'no-store');
        upstream.body.on('error', () => res.destroy());
        upstream.body.pipe(res);
        return;
      } catch (_error) { /* Try the next configured provider. */ }
    }
    return res.status(502).json({ error: 'All configured model providers are unavailable' });
  }


  // Gumroad license verification, no secret required.
  // POST { product_id, license_key } -> { valid, reason }
  // Calls https://api.gumroad.com/v2/licenses/verify, increment_uses_count=false.
  // Valid only if success is true AND purchase is not refunded, disputed, or charged back.
  // No card, no charge, no sale, no stored value. Product ID and license key come from the caller.
  app.post('/verify-license', async (req, res) => {
    const product_id = typeof req.body?.product_id === 'string' ? req.body.product_id.trim() : '';
    const license_key = typeof req.body?.license_key === 'string' ? req.body.license_key.trim() : '';
    if (!product_id || !license_key) return res.status(400).json({ valid: false, reason: 'product_id and license_key are required' });
    try {
      const form = new URLSearchParams({ product_id, license_key, increment_uses_count: 'false' });
      const upstream = await request('https://api.gumroad.com/v2/licenses/verify', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() }, 20000, fetchFn);
      const data = await upstream.json();
      if (!data.success) return res.json({ valid: false, reason: data.message || 'license key not found' });
      const purchase = data.purchase || {};
      if (purchase.refunded) return res.json({ valid: false, reason: 'purchase was refunded' });
      if (purchase.disputed) return res.json({ valid: false, reason: 'purchase was disputed' });
      if (purchase.chargebacked) return res.json({ valid: false, reason: 'purchase was charged back' });
      if (purchase.subscription_cancelled_at) return res.json({ valid: false, reason: 'subscription was cancelled' });
      return res.json({ valid: true, reason: 'valid', uses: data.uses, email: purchase.email || null });
    } catch (error) {
      return res.status(502).json({ valid: false, reason: 'Gumroad verification unavailable' });
    }
  });

  app.post('/v1/chat/completions', chatCompletion);

  // Browser-facing proxy: the web chat sends no credentials. The server attaches
  // BRIDGE_TOKEN internally so the token never ships in public HTML/JS.
  // Same CORS policy as the rest of the app (keywebco.github.io + next-xus.net/.info/.org + localhost).
  // A light per-IP limit protects the provider budget, since this route is open.
  const proxyHits = new Map();
  const PROXY_WINDOW_MS = 60000;
  const PROXY_MAX_PER_WINDOW = Number(env.PROXY_RATE_LIMIT) || 20;
  app.post('/proxy/chat', (req, res) => {
    const now = Date.now();
    const ip = req.ip || 'unknown';
    const recent = (proxyHits.get(ip) || []).filter(t => now - t < PROXY_WINDOW_MS);
    if (recent.length >= PROXY_MAX_PER_WINDOW) return res.status(429).json({ error: 'Too many requests, please wait a moment' });
    recent.push(now);
    proxyHits.set(ip, recent);
    if (proxyHits.size > 5000) for (const [key, hits] of proxyHits) if (!hits.some(t => now - t < PROXY_WINDOW_MS)) proxyHits.delete(key);
    if (env.BRIDGE_TOKEN) req.headers.authorization = `Bearer ${env.BRIDGE_TOKEN}`;
    else delete req.headers.authorization;
    const body = req.body || {};
    req.body = { model: body.model || 'deepseek-chat', messages: body.messages, stream: body.stream === true };
    return chatCompletion(req, res);
  });
  return app;
}

async function loadWithRetry(state, env = process.env) {
  // Retries knowledge load until it succeeds, so a one-time startup failure no
  // longer leaves the Sim stuck until a manual restart.
  // NOTE: public CORE only since 2026-11-01 — no GITHUB_TOKEN is involved.
  while (!state.prompt) {
    try {
      state.prompt = await loadPrompt(env);
      console.log('Roger Sim prompt loaded');
    } catch (error) {
      console.error('Roger Sim prompt unavailable, retrying in 60s:', error.message);
      await new Promise((resolve) => setTimeout(resolve, 60000));
    }
  }
}

async function loadIntellectWithRetry(state, env = process.env) {
  // Loads the Sim-intellect combination in the background with retries.
  // Never blocks /proxy/chat: if it never loads, /sim/chat answers 503
  // and everything else keeps working. No token is used (public raw files).
  while (!state.intellect || !state.intellect.loaded) {
    try {
      const intellect = await simIntellect.loadIntellect({ fetchFn: fetch, coreText: state.prompt });
      state.intellect = intellect;
      if (intellect.loaded) {
        console.log(`Sim intellect loaded: ${intellect.sources.filter((s) => s.ok).length}/${intellect.sources.length} sources`);
      } else {
        console.error('Sim intellect incomplete, retrying in 60s:', JSON.stringify(intellect.sources.filter((s) => !s.ok).map((s) => s.id)));
        await new Promise((resolve) => setTimeout(resolve, 60000));
      }
    } catch (error) {
      console.error('Sim intellect load failed, retrying in 60s:', error.message);
      await new Promise((resolve) => setTimeout(resolve, 60000));
    }
  }
}

async function start() {
  const state = { prompt: '', intellect: null };
  // Load in background with retries; server still listens immediately
  // so /health reports status while loading.
  loadWithRetry(state);
  loadIntellectWithRetry(state);
  createApp({ state }).listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('Roger Sim API listening'));
}

if (require.main === module) start();
module.exports = { createApp, loadPrompt, providerOrder, simIntellect, agentZero, simMemory };

