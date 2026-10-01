'use strict';

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const REPO_API = 'https://api.github.com/repos/Keywebco/roger-sim-brain/contents/';
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
  if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is required to load Roger Sim');
  const githubOptions = { headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'roger-sim-api' } };
  async function privateFile(path) {
    const text = await readText(REPO_API + path, githubOptions, fetchFn);
    const data = JSON.parse(text);
    if (data.encoding !== 'base64' || typeof data.content !== 'string') throw new Error('Invalid private source encoding');
    return Buffer.from(data.content.replace(/\s/g, ''), 'base64').toString('utf8');
  }
  const [systemPrompt, corpus, coreKnowledge] = await Promise.all([
    privateFile('prompts/roger-sim-v1.md'),
    privateFile('corpus/roger-soul-map-v2.md'),
    readText(CORE_URL, { headers: { 'User-Agent': 'roger-sim-api' } }, fetchFn)
  ]);
  if (!systemPrompt.trim() || !corpus.trim() || !coreKnowledge.trim()) throw new Error('One or more prompt sources are empty');
  return [systemPrompt, corpus, coreKnowledge].join('\n\n---\n\n');
}

function createApp({ env = process.env, fetchFn = fetch, state = { prompt: '' } } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(cors({ origin(origin, callback) {
    if (!origin || origin === 'https://keywebco.github.io' || /^http:\/\/localhost(?::\d+)?$/.test(origin)) return callback(null, true);
    return callback(null, false);
  } }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({ status: state.prompt ? 'online' : 'unavailable', mind: 'Roger Sim', corpus_loaded: Boolean(state.prompt), timestamp: new Date().toISOString() }));

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

  app.post('/v1/chat/completions', chatCompletion);

  // Browser-facing proxy: the web chat sends no credentials. The server attaches
  // BRIDGE_TOKEN internally so the token never ships in public HTML/JS.
  // Same CORS policy as the rest of the app (keywebco.github.io + localhost).
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

async function start() {
  const state = { prompt: '' };
  try {
    state.prompt = await loadPrompt();
    console.log('Roger Sim prompt loaded');
  } catch (error) {
    console.error('Roger Sim prompt unavailable:', error.message);
  }
  createApp({ state }).listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('Roger Sim API listening'));
}

if (require.main === module) start();
module.exports = { createApp, loadPrompt, providerOrder };
