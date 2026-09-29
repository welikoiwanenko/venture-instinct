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

### Terminal UI

```bash
npm run tui              # full-screen TUI; q or Ctrl+C quits
npm run tui -- --text    # linear text mode for screen readers and pipes
```

The TUI opens on **Overview**. Press `Enter` to go to the seed field, type a seed and press `Enter` again to start a campaign from the baseline scenario (`fixtures/scenarios/technical-empty.json`, or another pack via `--scenario <file.json>`). In text mode, type `start demo-1`. It is the same `initializeCampaign` call as the command below, so the same seed gives the same campaign: the Overview's campaign id, seed, scenario, config and state hash prefix match `npm run campaign` for that seed. If input is invalid, the errors appear under the form and no campaign is created. One campaign runs per session; nothing is saved yet.

The screen has two panes: the section list and the current section's content. The focused pane is named at the start of the hint bar (`[Section list]` or `[Content]`) and its keys are listed there; `?` shows every key. In the section list, `↑`/`↓` (or `j`/`k`) move between sections and `Enter`/`→` opens the content. In the content, `↑`/`↓` scroll and `Esc`/`←` go back. Anywhere, `1`–`7` jump to a section, `Tab`/`Shift+Tab` cycle, `PgUp`/`PgDn` scroll a page and `t` switches to text mode in place. Each section keeps its scroll position. Below 72 columns, or in a short window, the side navigation collapses into one line. Text mode prints plain, append-only text and reads one command per line (`start demo-1`, `4`, `companies`, `next`, `help`, `quit`). It also starts automatically when stdin or stdout is not a terminal.

**Library: [Ink](https://github.com/vadimdemedes/ink) 7 with React 19** (pinned in `package.json`). It is actively maintained, lays out with Flexbox (so the narrow layout is a style change, not a second renderer), handles resize, wide characters and the alternate screen, and `renderToString` lets tests check real frames without a terminal. blessed and neo-blessed are unmaintained; terminal-kit is imperative and harder to test. Node's type stripping has no JSX, so components use `React.createElement`.

### Initialize and inspect a campaign

```bash
npm run --silent campaign -- --seed demo-1 --scenario fixtures/scenarios/technical-empty.json
```

Prints a short summary (week, slots, capital, check size, portfolio, state hash) and then the canonical manifest. `--config <file.json>` replaces the baseline config. `--json` prints `{ summary, manifest }` as one line of canonical JSON, which is handy for `diff`. Identical inputs always give byte-identical output. Invalid input prints every issue to stderr and exits 1 without creating a campaign. To see this, try `--config fixtures/configs/invalid-over-budget.json`. A missing or unknown argument, or an input file that cannot be read or parsed as JSON, exits 2.

## Layout

- `src/` — domain runtime; no UI, persistence, network or Linear dependencies. Exceptions: `src/tui/**` and `src/cli/**` (below) are adapters, and `src/main.ts` prints one runtime line when run directly (`npm start`).
- `src/config/baseline.ts` — campaign balance (design §5). Changing a value means a new `version`; a campaign keeps the frozen config it captured at start (`captureCampaignConfig`).
- `src/campaign/` — time and resource primitives: weeks and the inclusive investment window, weekly slots (no carry-over), money in whole US cents (safe integers, exact; `*Cents` fields), ownership shares in basis points rounded down (`shares.ts`), and the non-negative player investment budget.
- `src/campaign/initial-state.ts` — the authoritative starting state (planning week 1, fresh slots, opening budget, empty portfolio), derived from the config alone.
- `src/data/` — one-shot snapshots of untrusted input: getters are rejected, and validation, metadata and hashes all read the same copy.
- `src/content/` — authored scenario packs (design §5, §10.1–10.3, §14): `scenario-pack.ts` validates `{ id, contentVersion, content: { purpose?, companies } }` and hashes it; `company-profile.ts` is the company schema: public profile (id, name, sector, business model, description, founders with specialization), `initialKnowledge` (`inbound` or `unknown`) and the hidden starting state (cash, weekly price, paying customers and largest-customer share, base weekly leads, product fit 0–100, team lines with cost and productivity, other weekly costs, founder alignment and unresolved conflicts, strategy). Money is whole cents and ratios are basis points. Company and founder ids are unique in a pack. Any field that rates a company or fixes its fate (`qualityScore`, `winner`, `plannedExit`, `guaranteedOutcome`…) is rejected. All issues are reported at once with their paths.
- `src/manifest/` — canonical JSON/SHA-256 hashing and the campaign manifest (design §17.2, §18): seed, scenario id and content hash, simulation/content/config/RNG/math versions, config snapshot, initial state and its hash. `campaignId` is derived from the manifest, never from the clock. Engine versions live in `ENGINE_VERSIONS`; bump one when its behaviour changes.
- `src/app/` — application API (`initializeCampaign`, read-only `inspectCampaign`), shared by all adapters. It also re-exports what adapters need (`formatManifestIssue`, `canonicalJson`, and `formatCentsAsUsd` from `format.ts`).
- `src/tui/` — terminal UI adapter (design §15). `model.ts` (navigation state and actions), `keys.ts` (key and command bindings) and `screen.ts` (what is shown, as plain data) are pure; `ink-app.ts` draws them full screen and `text-mode.ts` prints them linearly. `session.ts` starts a campaign through the application API; screens read it only via `inspectCampaign`. Like the CLI, it imports only from `src/app/`; `test/tui-boundary.test.ts` fails on any import of domain internals or hidden state.
- `src/cli/` — developer command adapter: it may read files, parse arguments and write to stdout/stderr, must not duplicate domain rules, and imports only from `src/app/`.
- `fixtures/configs/invalid-over-budget.json` — deliberately invalid config for error-path checks.
- `fixtures/scenarios/technical-empty.json` — technical reproducibility fixture, not a playable scenario.
- `fixtures/scenarios/minimal-one-company.json` — the smallest valid pack with one company; `fixtures/scenarios/invalid/` holds packs that fail on purpose (missing economics, forbidden outcome fields, duplicate ids). Try one with `npm run --silent campaign -- --seed demo-1 --scenario fixtures/scenarios/invalid/missing-economics.json`.
- `test/` — `*.test.ts` files for the built-in Node test runner.
