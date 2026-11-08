// Sim Intellect — memory write path.
// Validates a memory record against memory-loop-schema.yaml, runs the
// Agent Zero checks for storage (evidence class present, no invented
// private memory, only verified learning may be shared to the Federation),
// and queues the record for filing as a branch/PR proposal.
//
// It does NOT write to nextxus-yaml directly: this server has no GitHub
// token for writes, and Federation changes are branch-first under Roger's
// merge word. The caller gets back the exact YAML append block to file;
// the server keeps only an in-memory outbox of record metadata (ids, types,
// timestamps) so the queue can be listed without exposing record contents
// on a GET. Filing is Pontus's step: branch in Keywebco/nextxus-yaml,
// append the block to source/roger-sim/mind/memory-log.yaml, open a PR.
'use strict';

const TYPES = ['interaction', 'correction', 'new_observation', 'learning', 'user_analysis', 'procedure', 'experience', 'observation', 'checkpoint', 'voice_example'];
const EVIDENCE = ['fact', 'testimony', 'inference', 'assumption', 'hypothesis', 'interpretation', 'unresolved', 'roger_testimony', 'implementation_claim'];
const SENSITIVITY = ['public', 'private', 'restricted'];
const SHAREABLE_EVIDENCE = ['fact', 'testimony']; // only verified learning may be shared
const PRIVATE_MEMORY = /\b(I remember|I recall|when I was (a )?(child|kid|young|boy)|my childhood|I grew up|my mother (told|said|used)|my father (told|said|used)|in my (youth|childhood))\b/i;

function validateMemoryRecord(record) {
  const errors = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) return ['record must be an object'];
  if (typeof record.id !== 'string' || !record.id.trim()) errors.push('id is required');
  if (typeof record.timestamp !== 'string' || Number.isNaN(Date.parse(record.timestamp))) errors.push('timestamp must be an ISO-8601 string');
  if (typeof record.location_or_session !== 'string' || !record.location_or_session.trim()) errors.push('location_or_session is required');
  if (!TYPES.includes(record.type)) errors.push(`type must be one of: ${TYPES.join(', ')}`);
  if (typeof record.content !== 'string' || !record.content.trim()) errors.push('content is required');
  if (!EVIDENCE.includes(record.evidence_class)) errors.push(`evidence_class must be one of: ${EVIDENCE.join(', ')}`);
  if (typeof record.provenance !== 'string' || !record.provenance.trim()) errors.push('provenance is required');
  if (!SENSITIVITY.includes(record.sensitivity)) errors.push(`sensitivity must be one of: ${SENSITIVITY.join(', ')}`);
  if (typeof record.shared_to_federation !== 'boolean') errors.push('shared_to_federation must be true or false');

  // Agent Zero checks for storage.
  if (record.content && PRIVATE_MEMORY.test(record.content)
    && !(String(record.provenance || '').toLowerCase().includes('roger') || record.evidence_class === 'roger_testimony')) {
    errors.push('Agent Zero: content claims a private memory without Roger as provenance; the Sim must never invent private memories.');
  }
  if (record.shared_to_federation === true && !SHAREABLE_EVIDENCE.includes(record.evidence_class)) {
    errors.push(`Agent Zero: only verified learning (evidence_class fact or testimony) may be shared to the Federation; got ${record.evidence_class}.`);
  }
  if (record.shared_to_federation === true && record.sensitivity !== 'public') {
    errors.push('Agent Zero: only public material may be shared to the Federation.');
  }
  return errors;
}

function yamlEscape(value) {
  return JSON.stringify(String(value));
}

// The exact YAML append block to file in memory-log.yaml (append-only).
function buildYamlBlock(record) {
  const lines = [
    `  - id: ${yamlEscape(record.id)}`,
    `    timestamp: ${yamlEscape(record.timestamp)}`,
    `    location_or_session: ${yamlEscape(record.location_or_session)}`,
    `    type: ${yamlEscape(record.type)}`,
    '    content: >',
    ...String(record.content).trim().split('\n').map((line) => `      ${line}`),
    `    evidence_class: ${yamlEscape(record.evidence_class)}`,
    `    provenance: ${yamlEscape(record.provenance)}`,
    `    sensitivity: ${yamlEscape(record.sensitivity)}`,
    `    shared_to_federation: ${record.shared_to_federation}`,
  ];
  if (record.notes) lines.push(`    notes: ${yamlEscape(record.notes)}`);
  return lines.join('\n');
}

function createOutbox(limit = 50) {
  const queue = [];
  return {
    add(record) {
      const entry = { id: record.id, timestamp: record.timestamp, location_or_session: record.location_or_session, type: record.type, evidence_class: record.evidence_class, sensitivity: record.sensitivity, shared_to_federation: record.shared_to_federation, queued_at: new Date().toISOString() };
      queue.push(entry);
      while (queue.length > limit) queue.shift();
      return entry;
    },
    list() { return [...queue]; },
    size() { return queue.length; },
  };
}

module.exports = { TYPES, EVIDENCE, SENSITIVITY, validateMemoryRecord, buildYamlBlock, createOutbox };
