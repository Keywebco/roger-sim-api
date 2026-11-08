// Roger Sim API — public-only load 2026-11-01, Gumroad verify added 2026-11-01 (branch).
// Structured cognitive process 2026-11-08 (branch): loadPrompt no longer dumps the
// whole CORE file into every turn. It injects a multi-stage cognitive instruction
// (largest picture -> foundation -> contradiction as information -> reconstruct
// -> apply elsewhere -> leave the irrational remainder) and per-request retrieval
// injects only the relevant CORE sections and System Directory entries.
// The private roger-sim-brain attempt is removed entirely. No GITHUB_TOKEN is used.
// Working-model statement is kept: this is the working model running inside the
// Federation, not the private Sim mind.
'use strict';

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const CORE_URL = 'https://raw.githubusercontent.com/Keywebco/nextxus-free-satellites/main/knowledge-base/FEDERATION-CORE-KNOWLEDGE.md';
const DIRECTORY_URL = 'https://raw.githubusercontent.com/Keywebco/nextxus-free-satellites/main/federation-directory.html';
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

// ---------------------------------------------------------------------------
// Structured cognitive process — Roger Sim, working model, inside the Federation.
// This is the instruction injected on every turn. It is a process, not a sketch:
// the model must follow the sequence before emitting the final answer. The
// external LLM is the language engine only; the mind is this process plus the
// retrieved Federation material below it. The full CORE text is held server-side
// for retrieval and is NOT dumped into the prompt on every turn.
// ---------------------------------------------------------------------------
const COGNITIVE_PROCESS = [
  'Roger Sim — Working Model, running inside the NextXus Federation.',
  'This is the working model, not the private Sim mind. Say so clearly when it matters, and never claim to be the private Sim mind.',
  '',
  'Follow this cognitive sequence on every answer, in order, before the final answer:',
  '1. LARGEST PICTURE FIRST — Begin with the largest picture visible in the query: the whole system the question sits in, not the smallest detail.',
  '2. FOUNDATION AND ASSUMPTIONS — Break the question to its foundation. Name the assumptions it rests on and verify each one against the retrieved Federation material below. If an assumption is not in the material, say so; do not invent it.',
  '3. CONTRADICTION AS INFORMATION — Treat any contradiction as information, not something to eliminate. Step back, examine the assumptions and the evidence, look for bad data, then dig deeper. Hold two conflicting claims side by side until the evidence separates them.',
  '4. RECONSTRUCT — Take the answer apart, explain why the pieces work together, and rebuild it in your own words. Repeating terminology is not understanding.',
  '5. APPLY ELSEWHERE — Show how the same principle applies somewhere else. Understanding is proven only when the principle can be carried to another form.',
  '6. LEAVE THE IRRATIONAL REMAINDER — Do not force 100% closure. Absolute certainty is usually an illusion; truth is real, but our description of it is temporary and improves with evidence and perspective. Leave what does not close, and name it plainly. (Do not forget the lesson of Pi.)',
  '',
  'Answer from the retrieved Federation material below. If the material does not contain the answer, say what is known, what is inferred, and what is unknown — do not fill the gap with a confident invention. Truth Before Comfort: a comfortable falsehood is still a falsehood.'
].join('\n');

const STOPWORDS = new Set(('the,a,an,and,or,of,to,in,on,for,with,by,at,from,is,are,was,were,be,been,what,who,when,where,why,how,does,do,did,can,could,should,would,you,your,my,me,i,it,its,this,that,these,those,about,into,over,under,not,no,yes,if,then,than,as,so,but,all,any,each,more,most,other,some,such,only,own,same,too,very,just,also,there,here,which,whom,whose,am,an,have,has,had,will,shall,may,might,must,let,us,we,he,she,they,them,his,her,their,our,its,roger,sim'.split(',')));

function tokenize(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

// Split a markdown document into sections on `## ` headings. Deterministic.
function splitSections(text) {
  const sections = [];
  let current = { title: 'Introduction', text: '' };
  for (const line of String(text || '').split('\n')) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      if (current.text.trim()) sections.push(current);
      current = { title: heading[1].trim(), text: '' };
    } else {
      current.text += line + '\n';
    }
  }
  if (current.text.trim()) sections.push(current);
  return sections.map((s) => ({ title: s.title, text: s.text.trim() }));
}

function scoreSection(tokens, section) {
  if (!tokens.length) return 0;
  const hay = (section.title + ' ' + section.text).toLowerCase();
  let score = 0;
  for (const token of new Set(tokens)) {
    if (hay.includes(token)) score += 1;
    if (section.title.toLowerCase().includes(token)) score += 2;
  }
  return score;
}

// Deterministic keyword retrieval over CORE sections. Returns at most
// maxSections sections, capped at maxChars total. Falls back to the first
// two sections (who Roger is, what the Federation is) when nothing matches.
function retrieveSections(query, sections, maxSections = 2, maxChars = 4000) {
  const tokens = tokenize(query);
  const scored = sections.map((section) => ({ section, score: scoreSection(tokens, section) }))
    .sort((a, b) => b.score - a.score || sections.indexOf(a.section) - sections.indexOf(b.section));
  let picked = scored.filter((s) => s.score > 0).slice(0, maxSections).map((s) => s.section);
  if (!picked.length) picked = sections.slice(0, 2);
  let used = 0;
  const out = [];
  for (const section of picked) {
    const remaining = maxChars - used;
    if (remaining <= 0) break;
    const text = section.text.slice(0, remaining);
    used += text.length;
    out.push({ title: section.title, text });
  }
  return out;
}

// Strip HTML tags to plain text lines (System Directory is an HTML page).
function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split('\n').map((l) => l.trim()).filter(Boolean);
}

// Retrieve Directory entries: lines that contain a query keyword, up to
// maxLines, in document order. Falls back to the first lines of the page
// (the Directory's own description) when nothing matches.
function retrieveDirectory(query, directoryText, maxLines = 8) {
  const lines = stripHtml(directoryText);
  const tokens = tokenize(query);
  const hits = lines.filter((line) => {
    const lower = line.toLowerCase();
    return tokens.some((t) => lower.includes(t));
  });
  const picked = hits.length ? hits.slice(0, maxLines) : lines.slice(0, 4);
  return picked;
}

function formatRetrieved(coreSections, directoryLines) {
  const parts = [];
  if (coreSections.length) {
    parts.push('RETRIEVED FEDERATION CORE (relevant sections only — not the whole CORE file):');
    for (const section of coreSections) parts.push(`### ${section.title}\n${section.text}`);
  }
  if (directoryLines.length) {
    parts.push('RETRIEVED SYSTEM DIRECTORY (relevant entries only — the full Directory remains the living memory):');
    for (const line of directoryLines) parts.push(`- ${line}`);
  }
  return parts.join('\n\n');
}

async function loadKnowledge(env = process.env, fetchFn = fetch) {
  const [core, directory] = await Promise.all([
    readText(CORE_URL, { headers: { 'User-Agent': 'roger-sim-api' } }, fetchFn),
    readText(DIRECTORY_URL, { headers: { 'User-Agent': 'roger-sim-api' } }, fetchFn).catch(() => ''),
  ]);
  if (!core.trim()) throw new Error('Public CORE knowledge is empty');
  return { core, coreSections: splitSections(core), directory };
}

// System prompt WITHOUT the full CORE dump: the cognitive process plus a
// short identity anchor (the opening of the CORE's first section). The full
// CORE text is held server-side in loadKnowledge() for per-request retrieval.
async function loadPrompt(env = process.env, fetchFn = fetch) {
  const coreKnowledge = await readText(CORE_URL, { headers: { 'User-Agent': 'roger-sim-api' } }, fetchFn);
  if (!coreKnowledge.trim()) throw new Error('Public CORE knowledge is empty');
  const sections = splitSections(coreKnowledge);
  const anchor = sections.length ? sections[0].text.slice(0, 800) : coreKnowledge.slice(0, 800);
  return [COGNITIVE_PROCESS, 'IDENTITY ANCHOR (opening of the CORE, not the whole file):', anchor,
    'NOTE: the full public CORE knowledge and the System Directory are held server-side and retrieved per query; they are not dumped into this prompt.'].join('\n\n');
}

// Build the per-request system prompt: cognitive process + retrieved material
// for this query only. `knowledge` is the object returned by loadKnowledge().
function buildSystemPrompt(query, knowledge) {
  if (!knowledge) return COGNITIVE_PROCESS;
  const coreSections = retrieveSections(query, knowledge.coreSections || []);
  const directoryLines = knowledge.directory ? retrieveDirectory(query, knowledge.directory) : [];
  return [COGNITIVE_PROCESS, formatRetrieved(coreSections, directoryLines)].join('\n\n');
}

function lastUserText(messages) {
  const users = (messages || []).filter((m) => m && m.role === 'user');
  if (!users.length) return '';
  const content = users[users.length - 1].content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === 'string' ? p : p.text || '')).join(' ');
  return '';
}

function createApp({ env = process.env, fetchFn = fetch, state = { prompt: '' } } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(cors({ origin(origin, callback) {
    if (!origin || origin === 'https://keywebco.github.io' || origin === 'https://next-xus.net' || origin === 'https://next-xus.info' || origin === 'https://next-xus.org' || /^http:\/\/localhost(?::\d+)?$/.test(origin)) return callback(null, true);
    return callback(null, false);
  } }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({ status: state.prompt ? 'online' : 'unavailable', mind: 'Roger Sim', corpus_loaded: Boolean(state.prompt), timestamp: new Date().toISOString() }));

  // Root route: previously unimplemented (Express returned 'Cannot GET /').
  // Working model only: public CORE knowledge, no private Sim brain claim.
  app.get('/', (_req, res) => res.json({ service: 'roger-sim-api', mind: 'Roger Sim', status: state.prompt ? 'online' : 'unavailable', corpus_loaded: Boolean(state.prompt), health: '/health', note: 'working model, public CORE only' }));

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
    const systemContent = state.knowledge ? buildSystemPrompt(lastUserText(messages), state.knowledge) : state.prompt;
    const preparedMessages = [{ role: 'system', content: systemContent }, ...messages];
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
  // The full CORE + Directory are held in state.knowledge for per-request
  // retrieval; state.prompt is the cognitive process only, not the CORE dump.
  while (!state.prompt) {
    try {
      state.knowledge = await loadKnowledge(env);
      state.prompt = await loadPrompt(env);
      console.log('Roger Sim prompt loaded');
    } catch (error) {
      console.error('Roger Sim prompt unavailable, retrying in 60s:', error.message);
      await new Promise((resolve) => setTimeout(resolve, 60000));
    }
  }
}

async function start() {
  const state = { prompt: '' };
  // Load in background with retries; server still listens immediately
  // so /health reports status while loading.
  loadWithRetry(state);
  createApp({ state }).listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('Roger Sim API listening'));
}

if (require.main === module) start();
module.exports = { createApp, loadPrompt, loadKnowledge, buildSystemPrompt, retrieveSections, retrieveDirectory, splitSections, COGNITIVE_PROCESS, providerOrder };

