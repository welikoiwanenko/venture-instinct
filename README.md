# Venture Instinct

Design: [docs/design-doc.md](docs/design-doc.md).

## Requirements

Node.js 24.12+ (24.x LTS; see `.nvmrc`). Node runs TypeScript directly, so there is no build step.

## Commands

```bash
npm ci             # install pinned dependencies from package-lock.json
npm start          # run the domain entry point (src/main.ts)
npm run typecheck  # tsc, no emit
npm test           # node:test runner over test/
```

## Layout

- `src/` — domain runtime; no UI, persistence, network or Linear dependencies.
- `src/config/baseline.ts` — campaign balance (design §5). Changing a value means a new `version`; a campaign keeps the frozen config it captured at start (`captureCampaignConfig`).
- `src/campaign/` — time and resource primitives: weeks and the inclusive investment window, weekly slots (no carry-over), money in whole US dollars (safe integers, exact), and the non-negative player investment budget.
- `src/campaign/initial-state.ts` — the authoritative starting state (planning week 1, fresh slots, opening budget, empty portfolio), derived from the config alone.
- `src/manifest/` — canonical JSON/SHA-256 hashing and the campaign manifest (design §17.2, §18): seed, scenario id and content hash, simulation/content/config/RNG/math versions, config snapshot, initial state and its hash. `campaignId` is derived from the manifest, never from the clock. Engine versions live in `ENGINE_VERSIONS`; bump one when its behaviour changes.
- `fixtures/scenarios/technical-empty.json` — technical reproducibility fixture, not a playable scenario.
- `test/` — `*.test.ts` files for the built-in Node test runner.
