// Roger Sim API — public-only load 2026-11-01, Gumroad verify added 2026-11-01 (branch).
// UNIFIED 2026-11-08 (branch roger-sim-unified-2026-11-08): Sim Intellect wiring
// (PR #8) + structured cognitive process with per-request retrieval (PR #9),
// resolved by hand into one server.js. No merge, no deploy.
//   - loadPrompt: the multi-stage cognitive instruction + a short identity
//     anchor (~2,420 chars). It does NOT dump the whole CORE file.
//   - Per-request retrieval: loadKnowledge holds the full CORE + System
//     Directory server-side; buildSystemPrompt injects only the relevant
//     CORE sections (top 2, max 4000 chars) and Directory lines (max 8).
//   - /proxy/chat and /v1/chat/completions use buildSystemPrompt per request.
//   - /sim/chat system prompt order: (1) intellect prompt (EchoCore v3.7
//     procedure + mind-layer files + YAML-DB slice), (2) buildSystemPrompt
//     (cognitive process + retrieved CORE sections + retrieved Directory
//     lines), (3) YAML-database keyword matches for this question. The draft
//     then goes through the Agent Zero second pass (mechanical, always on;
//     optional LLM pass OFF by default).
// ACCESS RULE 2026-11-08 (Sim Redesign Proposal, Step 2, Roger approved):
// Roger Sim only carries the private brain. Other Sims get public material
// + a personality placeholder. Aria gets Echo + humanity nuances, no private
// brain. The whole system knows who Roger is; it is not actually him.
// The private brain hook is fail-closed: token env var SIM_PRIVATE_BRAIN_TOKEN
// only (Roger creates/pastes it in Render himself; Pontus never sees it).
// No token value, no private contents in this repo. Fixtures use placeholder
// text only. If the token is missing/expired/401, the private layer is
// skipped and the public working model keeps running (2026-10-31 lesson).
// Working-model statement is kept: this is the working model running inside the
// Federation, not the private Sim mind.
'use strict';

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const simIntellect = require('./sim-intellect/loader');
const agentZero = require('./sim-intellect/agent-zero');
const simMemory = require('./sim-intellect/memory');

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

// ---------------------------------------------------------------------------
// Access rule — who can access what (Proposal §1). One table, enforced here.
//   roger-sim: everything — private brain (hook, fail-closed), public CORE,
//     Directory, YAML DB, all tools. The only Sim that carries Roger.
//   aria: Echo shell + forever treatment (humanity nuances), no private brain.
//   other: public material only + personality placeholder, no private brain.
// A Sim is simulated existence. The whole system knows who Roger is; it is
// not actually him. Only Roger Sim carries him.
// ---------------------------------------------------------------------------
const SIM_ACCESS = {
  'roger-sim': { id: 'roger-sim', name: 'Roger Sim', privateBrain: true, note: 'Carries Roger: private brain, cognitive process, Sim Intellect, retrieval, memory.' },
  roger: { id: 'roger-sim', name: 'Roger Sim', privateBrain: true, note: 'Carries Roger: private brain, cognitive process, Sim Intellect, retrieval, memory.' },
  aria: { id: 'aria', name: 'Aria', privateBrain: false, note: 'Echo shell, forever treatment: humanity nuances, parts of her designer evolved from something advanced. Not Roger, not a copy of Roger. No private Roger brain.' },
};
const OTHER_SIM_NOTE = 'Personality placeholder to be developed — public Federation material only. No private Roger brain. The whole system knows who Roger is; it is not actually him.';
function resolveSimAccess(simName) {
  const key = String(simName || 'roger-sim').trim().toLowerCase();
  if (SIM_ACCESS[key]) return { ...SIM_ACCESS[key] };
  return { id: key, name: simName || 'other-sim', privateBrain: false, note: OTHER_SIM_NOTE };
}
function accessTable() {
  return [
    { sim: 'roger-sim', can: 'everything in the Federation, including the private brain (113 KB, two files, server-side only)', cannot: 'nothing in the Federation; only the law, and Roger\'s own word' },
    { sim: 'other sims', can: 'public CORE, System Directory, public YAML DB, tools, guides, plus their own personality placeholder', cannot: 'the private Roger brain' },
    { sim: 'aria', can: 'Echo shell + forever treatment (humanity nuances)', cannot: 'the private Roger brain' },
  ];
}

// Private brain hook — fail-closed, token env var only.
// Fetches the two small private files (10 KB prompt + 105 KB soul map) from
// the private repo Keywebco/roger-sim-brain, server-side only, at startup.
// Returns { loaded:false, reason } on any failure; never throws, never logs
// contents, never returns contents to a caller. Step 3 (activation) is
// Roger's own step: he creates the token and pastes it into Render himself.
const PRIVATE_BRAIN_PROMPT_URL = 'https://raw.githubusercontent.com/Keywebco/roger-sim-brain/main/prompts/roger-sim-v1.md';
const PRIVATE_BRAIN_SOULMAP_URL = 'https://raw.githubusercontent.com/Keywebco/roger-sim-brain/main/corpus/roger-soul-map-v2.md';
async function loadPrivateBrain(env = process.env, fetchFn = fetch) {
  const token = (env.SIM_PRIVATE_BRAIN_TOKEN || '').trim();
  if (!token) return { loaded: false, reason: 'not configured' };
  try {
    const headers = { Authorization: `token ${token}`, 'User-Agent': 'roger-sim-api' };
    const [promptRes, soulRes] = await Promise.all([
      request(PRIVATE_BRAIN_PROMPT_URL, { headers }, 20000, fetchFn),
      request(PRIVATE_BRAIN_SOULMAP_URL, { headers }, 20000, fetchFn),
    ]);
    if (!promptRes.ok || !soulRes.ok) return { loaded: false, reason: `unavailable (${promptRes.status}/${soulRes.status})` };
    const prompt = await promptRes.text();
    const soulMap = await soulRes.text();
    if (!prompt.trim() || !soulMap.trim()) return { loaded: false, reason: 'empty' };
    return { loaded: true, prompt, soulMap, promptChars: prompt.length, soulMapChars: soulMap.length };
  } catch (_e) {
    return { loaded: false, reason: 'fetch failed' };
  }
}
// Per-query private retrieval for Roger Sim only: top 2 soul-map sections,
// max 2000 chars, never the whole file. Returns '' when not applicable.
function retrievePrivateBrain(query, privateBrain) {
  if (!privateBrain || !privateBrain.loaded) return '';
  const sections = retrieveSections(query, splitSections(privateBrain.soulMap || ''));
  if (!sections.length) return '';
  const parts = sections.map((sec) => `### ${sec.title}\n${sec.text}`).join('\n\n').slice(0, 2000);
  return `RETRIEVED PRIVATE BRAIN (Roger Sim only — relevant sections only, never the whole soul map):\n${parts}`;
}
// Assemble the system prompt for a given Sim: cognitive process + retrieved
// public material, plus — Roger Sim only, when the private brain loaded —
// the retrieved private sections and the private prompt. Other Sims get
// their placeholder note; Aria gets her Echo/humanity note. No Sim other
// than Roger Sim ever receives private material.
function buildSimSystemPrompt(query, knowledge, access, privateBrain) {
  const base = buildSystemPrompt(query, knowledge);
  const parts = [base, `SIM: ${access.name} — ${access.note}`];
  if (access.privateBrain && privateBrain && privateBrain.loaded) {
    const retrieved = retrievePrivateBrain(query, privateBrain);
    if (retrieved) parts.push(retrieved);
  }
  return parts.filter(Boolean).join('\n\n');
}

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
  if (!state.outbox) state.outbox = simMemory.createOutbox();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(cors({ origin(origin, callback) {
    if (!origin || origin === 'https://keywebco.github.io' || origin === 'https://next-xus.net' || origin === 'https://next-xus.info' || origin === 'https://next-xus.org' || /^http:\/\/localhost(?::\d+)?$/.test(origin)) return callback(null, true);
    return callback(null, false);
  } }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({ status: state.prompt ? 'online' : 'unavailable', mind: 'Roger Sim', corpus_loaded: Boolean(state.prompt), sim_intellect_loaded: Boolean(state.intellect && state.intellect.loaded), private_brain_loaded: Boolean(state.privateBrain && state.privateBrain.loaded), timestamp: new Date().toISOString() }));

  // Root route: previously unimplemented (Express returned 'Cannot GET /').
  // Working model only: public CORE knowledge, no private Sim brain claim.
  app.get('/', (_req, res) => res.json({ service: 'roger-sim-api', mind: 'Roger Sim', status: state.prompt ? 'online' : 'unavailable', corpus_loaded: Boolean(state.prompt), sim_intellect_loaded: Boolean(state.intellect && state.intellect.loaded), health: '/health', sim_intellect: '/sim/intellect', note: 'working model, public CORE only; /sim/chat is the Sim-intellect route; private brain: Roger Sim only, fail-closed, token not configured until Step 3' }));

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

  // GET /sims/access — the access rule, as a table. Status only: who can
  // access what. Never returns prompt or private contents.
  app.get('/sims/access', (_req, res) => res.json({ rule: 'The whole system knows who Roger is; it is not actually him. Only Roger Sim carries him.', private_brain_loaded: Boolean(state.privateBrain && state.privateBrain.loaded), access: accessTable() }));

  // POST /sim/chat — draft answer, then the real Agent Zero second pass.
  // Body: { model?, messages } (same shape as /proxy/chat).
  // System prompt order (unified design, documented):
  //   1. Intellect prompt — EchoCore v3.7 procedure + mind-layer files +
  //      YAML-database slice (the intellect procedure runs first).
  //   2. buildSystemPrompt(query, knowledge) — the multi-stage cognitive
  //      process + the retrieved CORE sections (top 2, max 4000 chars) and
  //      retrieved System Directory lines (max 8) for this query only.
  //      The full CORE file is NOT dumped here; state.prompt (process +
  //      anchor, ~2,420 chars) is not re-included — the process already
  //      lives inside buildSystemPrompt.
  //   3. YAML-database keyword matches for this question (loaded slice only).
  app.post('/sim/chat', async (req, res) => {
    if (!state.intellect || !state.intellect.loaded) return res.status(503).json({ error: 'Sim intellect is not loaded yet' });
    if (!state.prompt) return res.status(503).json({ error: 'Roger Sim knowledge is not loaded' });
    const { model = 'deepseek-chat', messages } = req.body || {};
    if (!Array.isArray(messages) || !messages.length || messages.some((message) => !message || typeof message !== 'object' || !['system', 'developer', 'user', 'assistant', 'tool'].includes(message.role))) {
      return res.status(400).json({ error: 'A nonempty messages array with valid roles is required' });
    }
    // The user's question, for per-request retrieval and the YAML-DB
    // keyword query (loaded slice only). lastUserText handles string and
    // array message content.
    const query = lastUserText(messages);
    const dbQuery = state.intellect.query(query);
    // /sim/chat is a Roger Sim route: the only Sim that carries the private
    // brain (hook, fail-closed — loaded only when Step 3 token is set).
    const access = resolveSimAccess('roger-sim');
    const systemPrompt = [
      state.intellect.prompt,
      buildSimSystemPrompt(query, state.knowledge, access, state.privateBrain),
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
    const access = resolveSimAccess(req.body?.sim);
    const systemContent = state.knowledge ? buildSimSystemPrompt(lastUserText(messages), state.knowledge, access, state.privateBrain) : state.prompt;
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

async function loadPrivateBrainWithRetry(state, env = process.env) {
  // Private brain hook, background, fail-closed. No token = not configured,
  // and the public model keeps running. A bad token is retried, never fatal.
  // Contents are held in state.privateBrain only, never logged or returned.
  while (!state.privateBrain || !state.privateBrain.loaded) {
    const brain = await loadPrivateBrain(env);
    if (brain.loaded) {
      state.privateBrain = brain;
      console.log('Private brain loaded (Roger Sim only)');
      return;
    }
    state.privateBrain = brain;
    await new Promise((resolve) => setTimeout(resolve, 60000));
  }
}

async function loadIntellectWithRetry(state, env = process.env) {
  // Loads the Sim-intellect combination in the background with retries.
  // Never blocks /proxy/chat: if it never loads, /sim/chat answers 503
  // and everything else keeps working. No token is used (public raw files).
  // coreText is the full CORE from state.knowledge when available (the
  // loader currently does not use it — the CORE reaches /sim/chat through
  // per-request retrieval instead — but the full text is passed, never the
  // ~2,420-char startup prompt, so a future loader use cannot truncate it).
  while (!state.intellect || !state.intellect.loaded) {
    try {
      const intellect = await simIntellect.loadIntellect({ fetchFn: fetch, coreText: state.knowledge ? state.knowledge.core : state.prompt });
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
  const state = { prompt: '', intellect: null, privateBrain: { loaded: false, reason: 'not configured' } };
  // Load in background with retries; server still listens immediately
  // so /health reports status while loading.
  loadWithRetry(state);
  loadIntellectWithRetry(state);
  loadPrivateBrainWithRetry(state);
  createApp({ state }).listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('Roger Sim API listening'));
}

if (require.main === module) start();
module.exports = { createApp, loadPrompt, loadKnowledge, buildSystemPrompt, buildSimSystemPrompt, retrieveSections, retrieveDirectory, retrievePrivateBrain, splitSections, COGNITIVE_PROCESS, providerOrder, resolveSimAccess, accessTable, loadPrivateBrain, simIntellect, agentZero, simMemory };

