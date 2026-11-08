// Sim Intellect — loader.
// Loads, per server start (and on retry), the three parts of Roger's
// Sim-intellect combination, in the loader's order (LOADER_ECHO_CORE_AND_SIM.md):
//   Part 1 — logic of superior design: EchoCore Protocol v3.7 procedure
//     (sim-intellect/procedure.md, local) + SYSTEM_PROMPT_FRAGMENT.md +
//     AGENT_ZERO_SUBCONSCIOUS.md (nextxus-yaml, raw GitHub).
//   Part 2 — individual files, pattern of consciousness: roger-sim-mind.yaml
//     + memory-log.yaml (+ memory-loop-schema.yaml) (nextxus-yaml, raw GitHub).
//   Part 3 — YAML database, shared repository of all AI minds: Echo Core 64
//     (sovereign-knowledge-os), the nextxus-yaml README + mind INDEX, and the
//     public CORE knowledge the server already loads (passed in as coreText).
//
// All sources are public files fetched unauthenticated from
// raw.githubusercontent.com, exactly like the existing CORE load. No token,
// no secret, no private file is used. A source that fails to load is listed
// in status with its error; the prompt is built from what did load. If
// Parts 1 and 2 both fail, the intellect is unavailable and /sim/chat
// answers 503 — /proxy/chat is untouched and keeps working.
'use strict';

const fs = require('fs');
const path = require('path');

const RAW = 'https://raw.githubusercontent.com';

// Each source: id, part (1/2/3), label, url. procedure.md is local.
const SOURCES = [
  { id: 'echo-core', part: 3, label: 'Echo Core 64 anchors', url: `${RAW}/Keywebco/sovereign-knowledge-os/main/knowledge/echo-core.md` },
  { id: 'roger-sim-mind', part: 2, label: 'Roger Sim own mind database', url: `${RAW}/Keywebco/nextxus-yaml/main/source/roger-sim/mind/roger-sim-mind.yaml` },
  { id: 'memory-log', part: 2, label: 'Roger Sim live memory log (append-only)', url: `${RAW}/Keywebco/nextxus-yaml/main/source/roger-sim/mind/memory-log.yaml` },
  { id: 'memory-loop-schema', part: 2, label: 'Memory loop schema', url: `${RAW}/Keywebco/nextxus-yaml/main/source/roger-sim/mind/memory-loop-schema.yaml` },
  { id: 'system-prompt-fragment', part: 1, label: 'Keyserling Procedure / system prompt fragment', url: `${RAW}/Keywebco/nextxus-yaml/main/source/roger-sim/mind/SYSTEM_PROMPT_FRAGMENT.md` },
  { id: 'agent-zero-subconscious', part: 1, label: 'Agent Zero subconscious middleware', url: `${RAW}/Keywebco/nextxus-yaml/main/source/roger-sim/mind/AGENT_ZERO_SUBCONSCIOUS.md` },
  { id: 'yaml-db-readme', part: 3, label: 'Federation YAML database entry point (README)', url: `${RAW}/Keywebco/nextxus-yaml/main/README.md` },
  { id: 'mind-index', part: 3, label: 'Mind-layer index (YAML DB map)', url: `${RAW}/Keywebco/nextxus-yaml/main/source/roger-sim/mind/INDEX.md` },
];

const MAX_SOURCE_CHARS = 20000; // per-source cap; larger files are truncated, noted.
const MAX_PROMPT_CHARS = 60000; // total intellect-prompt cap.

function truncate(text, label) {
  if (text.length <= MAX_SOURCE_CHARS) return text;
  return `${text.slice(0, MAX_SOURCE_CHARS)}\n[... ${label} truncated at ${MAX_SOURCE_CHARS} chars ...]`;
}

function loadProcedureText() {
  try {
    return fs.readFileSync(path.join(__dirname, 'procedure.md'), 'utf8');
  } catch (error) {
    return '';
  }
}

// fetchFn has the node-fetch signature: (url, options) -> Response with .ok/.text().
async function loadIntellect({ fetchFn, coreText = '' } = {}) {
  if (typeof fetchFn !== 'function') throw new Error('loadIntellect needs a fetch function');
  const sources = [];
  const texts = {};

  // Part 1 procedure text lives in the repo itself (no network fetch).
  const procedure = loadProcedureText();
  sources.push({
    id: 'echocore-procedure', part: 1,
    label: 'EchoCore Protocol v3.7 procedure (Braid, Fast Ring, Forensic, Truth Gate)',
    url: 'local: sim-intellect/procedure.md',
    bytes: Buffer.byteLength(procedure, 'utf8'), ok: Boolean(procedure.trim()),
    error: procedure.trim() ? null : 'procedure.md missing or empty',
  });
  texts['echocore-procedure'] = procedure;

  for (const source of SOURCES) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      let response;
      try {
        response = await fetchFn(source.url, { headers: { 'User-Agent': 'roger-sim-api' }, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) throw new Error(`source unavailable (${response.status})`);
      const text = await response.text();
      if (!text.trim()) throw new Error('source empty');
      texts[source.id] = truncate(text, source.label);
      sources.push({ ...source, bytes: Buffer.byteLength(text, 'utf8'), ok: true, error: null });
    } catch (error) {
      texts[source.id] = '';
      sources.push({ ...source, bytes: 0, ok: false, error: error.message });
    }
  }

  const partLoaded = (part) => sources.some((s) => s.part === part && s.ok);
  const loaded = partLoaded(1) && partLoaded(2); // Part 3 is best-effort; the public CORE reaches /sim/chat through per-request retrieval, not a dump.
  const loadedAt = new Date().toISOString();

  // Build the prompt in the loader's order, then the procedure, then the DB slice.
  const sections = [
    ['Echo Core 64 (shared working memory)', texts['echo-core']],
    ['Roger Sim mind — own database (pattern of consciousness)', texts['roger-sim-mind']],
    ['Roger Sim memory log (append-only continuity)', texts['memory-log']],
    ['Memory loop schema', texts['memory-loop-schema']],
    ['System prompt fragment — Keyserling Procedure', texts['system-prompt-fragment']],
    ['Agent Zero subconscious — verification middleware', texts['agent-zero-subconscious']],
    ['EchoCore Protocol v3.7 — reasoning procedure', texts['echocore-procedure']],
    ['Federation YAML database — entry point and mind-layer index', [texts['yaml-db-readme'], texts['mind-index']].filter(Boolean).join('\n\n')],
  ];
  let prompt = sections
    .filter(([, text]) => text && text.trim())
    .map(([title, text]) => `## ${title}\n\n${text}`)
    .join('\n\n---\n\n');
  if (prompt.length > MAX_PROMPT_CHARS) {
    prompt = `${prompt.slice(0, MAX_PROMPT_CHARS)}\n[... intellect prompt truncated at ${MAX_PROMPT_CHARS} chars ...]`;
  }

  return {
    loaded, loadedAt, prompt, promptChars: prompt.length,
    parts: { 1: partLoaded(1), 2: partLoaded(2), 3: partLoaded(3) },
    sources,
    // Query helper is bound to the loaded texts, not the prompt string.
    query: (question) => queryLoaded(texts, sources, question),
    corpus: Object.values(texts).join('\n\n'), // what Agent Zero checks claims against
  };
}

// Keyword query over the loaded slice (Part 3 "query the YAML DB").
// Mechanical, not semantic: tokenise the question, score each loaded source
// by distinct-word overlap, return the best matching lines. This searches
// the slice the server actually loaded; a full-repo search needs a GitHub
// search/token path and is deliberately NOT invented here.
const STOPWORDS = new Set(('a an the and or of to in on for with is are was were be been it its this that what who when where how why do does did can could should would will shall may might must not no yes if then than so as at by from into about over under between through after before each other some any all more most very just only also'.split(' ')));
function queryLoaded(texts, sources, question) {
  const words = String(question || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  const unique = [...new Set(words)];
  if (!unique.length) return { question, matches: [] };
  const matches = [];
  for (const source of sources) {
    const text = texts[source.id];
    if (!text || !source.ok) continue;
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 20);
    const hits = [];
    for (const line of lines) {
      const lower = line.toLowerCase();
      const found = unique.filter((w) => lower.includes(w));
      if (found.length) hits.push({ line: line.slice(0, 300), words: found });
    }
    if (hits.length) {
      const score = new Set(hits.flatMap((h) => h.words)).size;
      matches.push({ source: source.id, part: source.part, label: source.label, score, lines: hits.slice(0, 5) });
    }
  }
  matches.sort((a, b) => b.score - a.score);
  return { question, keywords: unique, matches: matches.slice(0, 3) };
}

// Public status: sources and sizes only — never the prompt contents.
function statusOf(intellect) {
  if (!intellect) return { loaded: false, loadedAt: null, promptChars: 0, parts: { 1: false, 2: false, 3: false }, sources: [] };
  return {
    loaded: intellect.loaded, loadedAt: intellect.loadedAt, promptChars: intellect.promptChars,
    parts: intellect.parts,
    sources: intellect.sources.map(({ id, part, label, url, bytes, ok, error }) => ({ id, part, label, url, bytes, ok, error })),
  };
}

module.exports = { SOURCES, MAX_SOURCE_CHARS, MAX_PROMPT_CHARS, loadIntellect, queryLoaded, statusOf };
