# Sim Intellect wiring — Keywebco/roger-sim-api (branch `sim-intellect-wiring-2026-11-08`)

Roger's definition (2026-11-08): the Sim intellect is a combination — logic
of superior design + individual files (the pattern of consciousness) + the
YAML database (the shared repository of all AI minds) — "still a combination
but a different one" from the Val template (engine + packet + Echo memory +
rented API brain).

## What this branch adds (nothing else changes)

| File | What it does |
|---|---|
| `sim-intellect/procedure.md` | EchoCore Protocol v3.7 procedure text: Hollow Vessel (DIR-071), Keyserling Procedure, Braid the Question (9 steps), Fast Ring (Ring of Six), Forensic labelling (FACT / INFERENCE / ASSUMPTION / UNKNOWN), Agent Zero + 95% Truth Gate (DIR-000), 5-level confidence. Source: Drive Doc "Mind project" `13vwxxblvIxJaoM8cS89wD4osOezoqpvl_Khcs0ldUmM`. |
| `sim-intellect/loader.js` | Loads the three parts per server start, in the loader's order (Echo Core 64 → roger-sim-mind.yaml → memory-log.yaml → SYSTEM_PROMPT_FRAGMENT.md), plus the procedure, the Agent Zero note, and the YAML-DB slice (nextxus-yaml README + mind INDEX). All sources are public files on raw.githubusercontent.com, fetched unauthenticated like the existing CORE load. No token, no secret. A failed source is listed in status; the prompt is built from what loaded. `query()` is a keyword search over the loaded slice. |
| `sim-intellect/agent-zero.js` | Agent Zero as a real second pass in code. Mechanical pass (always on): splits the draft into claims and checks each against the loaded corpus — rejects invented private memories, rejects absolute claims (numbers, years, URLs) not in the record, labels the rest FACT / INFERENCE / UNKNOWN with confidence 1-5, and returns a corrected answer with rejected sentences removed and the reason stated. Optional LLM pass (OFF by default, `SIM_INTELLECT_AGENT_ZERO_LLM=1`): a separate model call; it can only qualify/reject further, never overturn a mechanical REJECT. |
| `sim-intellect/memory.js` | Memory write path. Validates a record against memory-loop-schema.yaml, runs the Agent Zero storage checks (evidence class present, no invented private memory, only verified learning — fact/testimony, public — may be shared to the Federation), and queues it for filing. It does NOT write to any repo: this server has no GitHub write token, and Federation changes are branch-first under Roger's merge word. The caller gets the exact YAML append block to file in `Keywebco/nextxus-yaml source/roger-sim/mind/memory-log.yaml`. |
| `server.js` (edited) | Adds `POST /sim/chat`, `GET /sim/intellect`, `POST /sim/memory`, `GET /sim/memory/outbox`, a background intellect loader with retry, and a `sim_intellect_loaded` field on `/health` and `/`. `/proxy/chat`, `/v1/chat/completions`, `/verify-license`, `/world` are unchanged. |
| `test/sim-intellect.test.js` | `node --test` tests for the loader, Agent Zero, memory validation, and a server smoke test. |

## Routes

- `GET /sim/intellect` — load status: which sources loaded, byte sizes, parts 1/2/3, prompt size. Never returns prompt contents.
- `POST /sim/chat` — body `{ model?, messages }` (same shape as `/proxy/chat`, non-streaming). Returns `{ answer, draft_answer, agent_zero, provider, model, intellect }`. `answer` is the Agent-Zero-corrected answer; `draft_answer` is what the model first wrote, kept so the correction is auditable. 503 if the intellect (or the CORE prompt) is not loaded; 502 if no provider answers.
- `POST /sim/chat` system-prompt order (unified branch `roger-sim-unified-2026-11-08`, PR #8 + PR #9 combined): (1) the intellect prompt (EchoCore procedure + mind-layer files + YAML-DB slice), (2) the multi-stage cognitive process + the retrieved CORE sections (top 2, max 4000 chars) and retrieved System Directory lines (max 8) for this query only, (3) YAML-database keyword matches for this question. The full CORE file is never dumped into a prompt; `/proxy/chat` uses the same per-request retrieval.
- `POST /sim/memory` — body is one memory record (see memory-loop-schema.yaml). 400 with reasons if validation or Agent Zero checks fail; 200 with `{ status: "queued-for-pr", yaml_block, file_to, next_step }` if it passes.
- `GET /sim/memory/outbox` — queued record metadata only (ids, types, timestamps). Contents are not exposed on a GET; the YAML block is returned only to the caller who submitted the record.

## What it loads (Part 3, honestly)

- Part 1 (logic): `procedure.md` + `SYSTEM_PROMPT_FRAGMENT.md` + `AGENT_ZERO_SUBCONSCIOUS.md`.
- Part 2 (pattern): `roger-sim-mind.yaml` + `memory-log.yaml` + `memory-loop-schema.yaml`.
- Part 3 (YAML DB): `echo-core.md` (sovereign-knowledge-os) + nextxus-yaml `README.md` + mind `INDEX.md` + the public CORE knowledge, which reaches `/sim/chat` through per-request retrieval (top 2 sections, max 4000 chars) rather than a full dump. The `query()` is keyword search over this loaded slice — not a full-repo semantic search. A full-repo YAML query would need a GitHub search/token path; none was invented here.

## Known limits (stated, not hidden)

1. The reasoning is still performed by a rented model following the procedure; the mechanical Agent Zero pass is keyword/exact-match checking, not semantic understanding. A claim can pass it and still be wrong — that is why claims stay labelled and UNKNOWNs stay visible.
2. The memory log the loader reads is the committed file in nextxus-yaml (last record 2026-11-03); new records only reach it when someone files the queued YAML block as a branch/PR and Roger merges.
3. Voice: not in this branch. Val and the Sim still use browser speech synthesis; a built voice synthesizer is a separate build, only on Roger's word.
4. No deploy, no env change, no secret is part of this branch. Render does not auto-deploy merges on this service; deployment is a separate Manual Deploy step after Roger's merge word.

## Test plan (branch only, no deploy)

1. `npm install && npm test` — unit + smoke tests (no provider keys needed).
2. Local server smoke test (see `../REPORT.md`): start with stubbed fetch, check `/health`, `/sim/intellect`, `/sim/memory` (valid + invalid), and that `/proxy/chat` still behaves as before (503 without a loaded prompt, 502 without provider keys — same as main).
3. Live test (after merge + Manual Deploy, Roger's word): `GET /sim/intellect` on Render (all 9 sources ok), then `POST /sim/chat` with a question whose answer is in the mind layer, and one with an invented number/date — the first should pass Agent Zero, the second should be rejected with a reason. Then `POST /sim/memory` with a test record and file the returned YAML block as a PR to nextxus-yaml.
