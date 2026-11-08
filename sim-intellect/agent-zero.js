// Sim Intellect — Agent Zero, the real second pass.
// Runs AFTER the draft answer is produced, BEFORE anything is returned or
// stored. Two layers:
//   1. Mechanical pass (always on, no extra provider spend). The draft is
//      split into claims; each claim is checked against the loaded corpus
//      (the intellect texts from loader.js) by exact-match / keyword
//      overlap, plus hard rules. Claims the corpus does not support are
//      qualified or rejected, with a stated reason — never silently kept.
//   2. Optional LLM pass (OFF by default; enable only with
//      SIM_INTELLECT_AGENT_ZERO_LLM=1). A separate model call re-reads the
//      draft and returns a JSON verdict. The LLM pass can only qualify or
//      reject further; it can NEVER overturn a mechanical REJECT.
// Agent Zero here is a program that checks, not a section the model is
// told to write. Its limits are stated plainly: keyword/exact matching is
// not semantic understanding, so a claim can pass this pass and still be
// wrong — that is why the verdict labels claims and keeps UNKNOWNs visible.
'use strict';

// Phrases that mean the Sim is claiming a private memory of Roger. The Sim
// must never invent these (roger-sim-mind.yaml: never_invent_private_memories).
const PRIVATE_MEMORY = /\b(I remember|I recall|when I was (a )?(child|kid|young|boy)|my childhood|I grew up|my mother (told|said|used)|my father (told|said|used)|in my (youth|childhood)|back when I was)\b/i;
// Absolute claims: numbers, years, dates, money, URLs, counts.
const ABSOLUTE = /\b(19|20)\d\d\b|\$\s?[\d,]+|\b\d+(\.\d+)?\s*(percent|%|dollars|years|days|songs|repos|seats)\b|https?:\/\/\S+/i;
const STOPWORDS = new Set(('a an the and or of to in on for with is are was were be been it its this that what who when where how why do does did can could should would will shall may might must not no yes if then than so as at by from into about over under between through after before each other some any all more most very just only also i you he she we they my your his her our their me him us them'.split(' ')));

function contentWords(text) {
  return [...new Set(String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w)))];
}

function extractClaims(text) {
  return String(text || '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim())
    .filter((s) => s.length >= 15 && !/^(hi|hello|hey|thanks|thank you)\b/i.test(s))
    .map((s) => ({ text: s }));
}

// Mechanical classification of one claim against the loaded corpus.
function classifyClaim(claimText, corpus) {
  const lower = claimText.toLowerCase();
  const corpusLower = String(corpus || '').toLowerCase();

  if (PRIVATE_MEMORY.test(claimText)) {
    return { label: 'REJECT', confidence: 1, reason: 'Claims a private memory of Roger; the Sim must never invent private memories.' };
  }
  const absolute = claimText.match(ABSOLUTE);
  if (absolute) {
    const token = absolute[0].toLowerCase();
    if (corpusLower.includes(token)) {
      return { label: 'FACT', confidence: 4, reason: `Absolute claim "${token}" appears in the loaded record.` };
    }
    return { label: 'REJECT', confidence: 1, reason: `Absolute claim "${token}" is not in the loaded record; cannot be stated as fact.` };
  }
  const words = contentWords(claimText);
  if (!words.length) return { label: 'UNKNOWN', confidence: 2, reason: 'No checkable content words.' };
  const found = words.filter((w) => corpusLower.includes(w));
  const ratio = found.length / words.length;
  if (ratio >= 0.6) return { label: 'FACT', confidence: 4, reason: `${found.length} of ${words.length} content words found in the loaded record.` };
  if (ratio >= 0.3) return { label: 'INFERENCE', confidence: 3, reason: `Partial support: ${found.length} of ${words.length} content words found; needs validation.` };
  return { label: 'UNKNOWN', confidence: 2, reason: 'No support in the loaded record; must be labelled UNKNOWN, not stated as fact.' };
}

// Full mechanical pass. Returns the verdict and a corrected answer in which
// rejected sentences are removed and replaced with a stated removal note.
function verifyAnswer(draft, corpus) {
  const claims = extractClaims(draft).map((c) => ({ ...c, ...classifyClaim(c.text, corpus) }));
  const rejected = claims.filter((c) => c.label === 'REJECT');
  const qualified = claims.filter((c) => c.label === 'INFERENCE' || c.label === 'UNKNOWN');
  const verdict = rejected.length ? 'rejected' : qualified.length ? 'qualified' : 'pass';
  let corrected = String(draft || '');
  for (const claim of rejected) {
    corrected = corrected.replace(claim.text, `[Agent Zero removed an unsupported claim: ${claim.reason}]`);
  }
  return {
    verdict, claims, rejected: rejected.map((c) => ({ text: c.text, reason: c.reason })),
    qualified: qualified.map((c) => ({ text: c.text, label: c.label, reason: c.reason })),
    corrected_answer: corrected,
    note: 'Mechanical pass only: keyword/exact-match check against the loaded intellect texts. It is not semantic verification; a claim can pass here and still be wrong.',
  };
}

const AGENT_ZERO_VERIFY_PROMPT = `You are Agent Zero, verification middleware for Roger Sim. Read the draft answer and the loaded record excerpt. Return ONLY JSON: {"verdict":"pass"|"qualified"|"rejected","claims":[{"text":"<claim>","label":"FACT"|"INFERENCE"|"ASSUMPTION"|"UNKNOWN"|"REJECT","confidence":1,"reason":"<why>"}]}. Reject any claim of a private memory, and any absolute claim (number, date, URL) not in the record. Qualify anything the record does not support. Do not add new facts.`;

// Optional LLM second pass. callChat must be (messages) => Promise<{ok, text}>.
// Never overturns a mechanical REJECT; on any failure, the mechanical result stands.
async function llmSecondPass(callChat, draft, corpusExcerpt) {
  try {
    const result = await callChat([
      { role: 'system', content: AGENT_ZERO_VERIFY_PROMPT },
      { role: 'user', content: `LOADED RECORD (excerpt):\n${String(corpusExcerpt || '').slice(0, 8000)}\n\nDRAFT ANSWER:\n${draft}` },
    ]);
    if (!result || !result.ok || !result.text) return null;
    const parsed = JSON.parse(result.text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim());
    if (!parsed || !Array.isArray(parsed.claims)) return null;
    return { verdict: parsed.verdict || 'qualified', claims: parsed.claims };
  } catch (_error) {
    return null; // LLM pass unavailable: mechanical result stands.
  }
}

module.exports = { extractClaims, classifyClaim, verifyAnswer, llmSecondPass, AGENT_ZERO_VERIFY_PROMPT, PRIVATE_MEMORY };
