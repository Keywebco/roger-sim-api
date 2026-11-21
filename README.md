# roger-sim-api

The backend API for the Roger Sim — a Node.js/Express service that routes chat requests across LLM providers with failover, feeds in live world context, and writes the Sim's hash-chained memory log.

When a provider fails, the next one answers: MiMo, DeepSeek, and Gemini are wired in, with the requested model chosen first. The service also pulls the Federation core knowledge base, BBC world news, and crypto prices, and exposes bridge endpoints for the Sim front end. Deploys to Render's free tier via `render.yaml`. For the Roger Sim front end and anyone integrating with the Sim's brain.

## Live

No static site — this is a service. Deployed on Render from `render.yaml` (service name: `roger-sim-api`).

## What's inside

- `server.js` — the Express server: provider routing with failover, news and crypto feeds, memory-log writes, bridge endpoints
- `package.json` — dependencies: express, node-fetch, cors
- `render.yaml` — Render deployment: free plan, `npm install` build, `node server.js` start, environment keys for GitHub, the three LLM providers, and the bridge token

## Providers

MiMo (`mimo-v2.6-flash`), DeepSeek (`deepseek-chat`), Gemini (`gemini-2.5-pro`) — first requested, then failover across the rest. Emergent is not used.

## Neutral Sim relay (`/proxy/sim`) for Career Sims

Added 2026-11-20 on Roger Keyserling's spoken yes (6:34 PM CT). Additive: `/proxy/chat`, `/sim/chat` and `/v1/chat/completions` behave exactly as before.

- `GET /proxy/sim` returns `{ route: "proxy/sim", available: true, limits }` so pages can feature-detect it.
- `POST /proxy/sim` with `{ brain_id?, persona, messages: [{ role: "user" | "assistant", content }] }`. The caller's brain persona **replaces** Roger Sim's prompt; Roger Sim's own prompt, public mind and secrets file are never used on this route. A short fixed safety header (simulation, not Roger, defer to licensed humans, emergencies) is placed above the persona.
- Limits: 10 requests per minute per IP (`SIM_PROXY_RATE_LIMIT`), 300 requests per day for the whole route (`SIM_PROXY_DAILY_CAP`), 32 KB body, 8,000-character persona, at most 20 messages of 4,000 characters and 12,000 characters in all; no system messages from the caller; non-streaming; 600 max tokens.
- No new keys: it uses the same provider keys and failover order as the rest of the service.
- Used by https://next-xus.net/career-sims/ (Keywebco/keywebco.github.io `career-sims/`). Needs a manual Render deploy to go live; until then the Career Sims page shows the relay as "coming soon".

---

Part of the [NextXus Federation](https://keywebco.github.io).
