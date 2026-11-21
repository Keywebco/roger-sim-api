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

---

Part of the [NextXus Federation](https://keywebco.github.io).
