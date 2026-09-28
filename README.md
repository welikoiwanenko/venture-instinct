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

### Initialize and inspect a campaign

```bash
npm run --silent campaign -- --seed demo-1 --scenario fixtures/scenarios/technical-empty.json
```

Prints a short summary (week, slots, capital, check size, portfolio, state hash) and then the canonical manifest. `--config <file.json>` replaces the baseline config. `--json` prints `{ summary, manifest }` as one line of canonical JSON, which is handy for `diff`. Identical inputs always give byte-identical output. Invalid input prints every issue to stderr and exits 1 without creating a campaign. To see this, try `--config fixtures/configs/invalid-over-budget.json`. A missing or unknown argument, or an input file that cannot be read or parsed as JSON, exits 2.

## Layout

- `src/` — domain runtime; no UI, persistence, network or Linear dependencies. Exceptions: `src/cli/**` (below) is a developer adapter, and `src/main.ts` prints one runtime line when run directly (`npm start`).
- `src/config/baseline.ts` — campaign balance (design §5). Changing a value means a new `version`; a campaign keeps the frozen config it captured at start (`captureCampaignConfig`).
- `src/campaign/` — time and resource primitives: weeks and the inclusive investment window, weekly slots (no carry-over), money in whole US cents (safe integers, exact; `*Cents` fields), ownership shares in basis points rounded down (`shares.ts`), and the non-negative player investment budget.
- `src/campaign/initial-state.ts` — the authoritative starting state (planning week 1, fresh slots, opening budget, empty portfolio), derived from the config alone.
- `src/data/` — one-shot snapshots of untrusted input: getters are rejected, and validation, metadata and hashes all read the same copy.
- `src/manifest/` — canonical JSON/SHA-256 hashing and the campaign manifest (design §17.2, §18): seed, scenario id and content hash, simulation/content/config/RNG/math versions, config snapshot, initial state and its hash. `campaignId` is derived from the manifest, never from the clock. Engine versions live in `ENGINE_VERSIONS`; bump one when its behaviour changes.
- `src/app/` — application API (`initializeCampaign`, read-only `inspectCampaign`), shared by all adapters. It also re-exports what adapters need (`formatManifestIssue`, `canonicalJson`).
- `src/cli/` — developer command adapter: it may read files, parse arguments and write to stdout/stderr, must not duplicate domain rules, and imports only from `src/app/`. Formats cents as dollars for display.
- `fixtures/configs/invalid-over-budget.json` — deliberately invalid config for error-path checks.
- `fixtures/scenarios/technical-empty.json` — technical reproducibility fixture, not a playable scenario.
- `test/` — `*.test.ts` files for the built-in Node test runner.
