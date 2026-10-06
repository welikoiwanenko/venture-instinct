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

The TUI opens on **Overview**. Press `Enter` to go to the seed field, type a seed and press `Enter` again to start a campaign from the Gamma pack (`content/scenarios/gamma-three-companies.json`, or another pack via `--scenario <file.json>`). In text mode, type `start demo-1`. It is the same `initializeCampaign` call as the command below, so the same seed gives the same campaign: the Overview's campaign id, seed, scenario, config and state hash prefix match `npm run campaign` for that seed.

**Companies** (`4`) lists the companies you know, with sector and description. The list is built only from the player knowledge view, so a company you have not heard of does not appear anywhere, not even in a count. In the content pane, `↑`/`↓` choose a company and `Enter` opens its card. The card shows the founders, your own status, the messages (the week 1 application) and every figure, each with its period, who said it, the week you got it and its status. Several figures for the same metric are shown side by side with their difference. `e` switches messages between the short form and the full text, and `Esc` goes back to the list. The card has no score, ranking or hidden value. In text mode: `open 1`, `expand`, `short`, `back`. If input is invalid, the errors appear under the form and no campaign is created. One campaign runs per session; nothing is saved yet.

The screen has two panes: the section list and the current section's content. The focused pane is named at the start of the hint bar (`[Section list]` or `[Content]`) and its keys are listed there; `?` shows every key. In the section list, `↑`/`↓` (or `j`/`k`) move between sections and `Enter`/`→` opens the content. In the content, `↑`/`↓` scroll and `Esc`/`←` go back. Anywhere, `1`–`7` jump to a section, `Tab`/`Shift+Tab` cycle, `PgUp`/`PgDn` scroll a page and `t` switches to text mode in place. Each section keeps its scroll position. Below 72 columns, or in a short window, the side navigation collapses into one line. Text mode prints plain, append-only text and reads one command per line (`start demo-1`, `4`, `companies`, `open 1`, `next`, `help`, `quit`). It also starts automatically when stdin or stdout is not a terminal.

**Library: [Ink](https://github.com/vadimdemedes/ink) 7 with React 19** (pinned in `package.json`). It is actively maintained, lays out with Flexbox (so the narrow layout is a style change, not a second renderer), handles resize, wide characters and the alternate screen, and `renderToString` lets tests check real frames without a terminal. blessed and neo-blessed are unmaintained; terminal-kit is imperative and harder to test. Node's type stripping has no JSX, so components use `React.createElement`.

### Initialize and inspect a campaign

```bash
npm run --silent campaign -- --seed demo-1 --scenario fixtures/scenarios/technical-empty.json
```

Prints a short summary (week, slots, capital, check size, portfolio, state hash) and then the canonical manifest. `--config <file.json>` replaces the baseline config. `--json` prints `{ summary, manifest }` as one line of canonical JSON, which is handy for `diff`. Identical inputs always give byte-identical output. Invalid input prints every issue to stderr and exits 1 without creating a campaign. To see this, try `--config fixtures/configs/invalid-over-budget.json`. A missing or unknown argument, or an input file that cannot be read or parsed as JSON, exits 2.

### A campaign with companies: player view and debug view

```bash
npm run --silent campaign -- --seed demo-1 --scenario content/scenarios/gamma-three-companies.json --view player
npm run --silent campaign -- --seed demo-1 --scenario content/scenarios/gamma-three-companies.json --view debug
```

This starts from the Gamma pack. The week 1 inbound applications of Tracebench and Papirflow are delivered as observations before the first plan. `--view player` prints what the player knows: the two companies, their public profile, and every delivered observation with its source, week received, period and status. Rampa is absent, and so is anything hidden. `--view debug` is for developers only (design §17.4). It prints every company, including Rampa, with its hidden starting state, the true value behind each claim and its distortion reason, and all five dimensions. `--json` prints either view as canonical JSON. The default `--view summary` is the output above, which now also shows the number of known companies.

## Layout

- `src/` — domain runtime; no UI, persistence, network or Linear dependencies. Exceptions: `src/tui/**` and `src/cli/**` (below) are adapters, and `src/main.ts` prints one runtime line when run directly (`npm start`).
- `src/config/baseline.ts` — campaign balance (design §5). Changing a value means a new `version`; a campaign keeps the frozen config it captured at start (`captureCampaignConfig`).
- `src/campaign/` — time and resource primitives: weeks and the inclusive investment window, weekly slots (no carry-over), money in whole US cents (safe integers, exact; `*Cents` fields), ownership shares in basis points rounded down (`shares.ts`), and the non-negative player investment budget.
- `src/campaign/initial-state.ts` — the authoritative starting state (planning week 1, fresh slots, opening budget, empty portfolio, and every company of the pack), derived from the config and the pack's companies.
- `src/campaign/company-dimensions.ts` — the five independent per-company dimensions of design §8.3: knowledge (`unknown`/`signal`/`identified`), player decision, contact, opportunity and lifecycle. Inbound companies start `identified`, the others `unknown`. Everything else starts at its first value (`undecided`, `none`, `unavailable`, `operating`), so a company can be operating while the player has never heard of it. `setCompanyDimension` is the only way to change a value, it changes exactly one, and it rejects values outside the lists.
- `src/data/` — one-shot snapshots of untrusted input: getters are rejected, and validation, metadata and hashes all read the same copy.
- `src/content/` — authored scenario packs (design §5, §10.1–10.3, §14): `scenario-pack.ts` validates `{ id, contentVersion, content: { purpose?, companies } }` and hashes it; `company-profile.ts` is the company schema: public profile (id, name, sector, business model, description, founders with specialization), `initialKnowledge` (`inbound` or `unknown`), an inbound `application` (week 1; author founder; short `summary` and full `text`; claims with metric, value, period and, for a gap, a distortion reason), and the hidden starting state (cash, weekly price, paying customers and largest-customer share, base weekly leads, product fit 0–100, team lines with cost and productivity, other weekly costs, founder alignment and unresolved conflicts, strategy). Money is whole cents and ratios are basis points. Each company may list `researchChecks` (`research-check.ts`, design §9.2): a stable check id, a direction (`growth-quality`, `customers`, `team`, `product`), the question in player-facing language, the evidence it reads (a player-facing `source` and the `period` it covers, week 0 or earlier) and the result: a `metric` figure for that period, a `text` finding with a title, or `unavailable` with a reason. A figure must equal the hidden state or carry a distortion reason, like a claim. Text and reasons are at most 120 words (§5), and a question may not contain words that reveal hidden truth or a verdict (`lying`, `quality`, `бреше`, `прихован…`). Checks are internal until research delivers them. Company, founder and research check ids are unique in a pack. Any field that rates a company or fixes its fate (`qualityScore`, `winner`, `plannedExit`, `guaranteedOutcome`…) is rejected. All issues are reported at once with their paths.
- `src/knowledge/` — what the player learns (design §9.1, §14.1). `observation.ts`: an append-only log of observations: id, company, source (`founder`, `public` or `check`) and author, week received, the period the fact refers to (week 0 and earlier are before the campaign), a metric value or a text, and references to earlier observations. Stored entries are deeply frozen, and a new figure is a new entry. Each entry has a separate internal provenance record with the true value and, when the claim differs, a structured distortion reason such as `counts-pilots-as-paying`. Provenance is never part of the player-facing record. `verification.ts`: the player-visible status (founder claim, public source, confirmed by this check, conflicting evidence, stale period), computed on read from the player's own log, and `compareObservations` (both values, periods, sources and the difference). `player-view.ts` is the player knowledge view (design §9.1, §17.4), the one read that player-facing adapters use. It lists only companies the player knows, with their public profile, the player's dimensions (knowledge, decision, contact, opportunity) and the player-facing half of their observations with a status. It has no hidden state, provenance, authoring notes or lifecycle, and no trace of unknown companies, not even a count. `debug-view.ts` shows the full world: every company, its whole profile, true metric values, provenance and all five dimensions.
- `src/manifest/` — canonical JSON/SHA-256 hashing and the campaign manifest (design §17.2, §18): seed, scenario id and content hash, simulation/content/config/RNG/math versions, config snapshot, initial state and its hash. `campaignId` is derived from the manifest, never from the clock. Engine versions live in `ENGINE_VERSIONS`; bump one when its behaviour changes.
- `src/app/` — application API (`initializeCampaign`, read-only `inspectCampaign`, `viewAsPlayer` and `searchKnownCompanies`), shared by all adapters. `src/app/debug.ts` (`viewForDebug`) is developer-only; the TUI may not import it. It also re-exports what adapters need (`formatManifestIssue`, `canonicalJson`, and `formatCentsAsUsd` from `format.ts`).
- `src/app/commands.ts` — the one way to change a campaign (design §17.2, §17.3, §18): `submitCommand(campaign, { commandId, expectedRevision, type, args })` returns either a whole new campaign with the journal entry, or a rejection with a code and player-visible reasons, never a partial change. Repeating a `commandId` with the same (normalized) arguments returns the earlier result without spending again; the same id with other arguments is rejected; a stale `expectedRevision` is rejected without cost. Each accepted command adds 1 to `campaign.revision` and appends a journal entry with a monotonic `sequence`, normalized arguments, result and the state hash after it. Reads never change the revision. The game's command types live in `COMMAND_HANDLERS`.
- `src/tui/` — terminal UI adapter (design §15). `model.ts` (navigation state and actions), `keys.ts` (key and command bindings) and `screen.ts` (what is shown, as plain data) are pure; `ink-app.ts` draws them full screen and `text-mode.ts` prints them linearly. `session.ts` starts a campaign through the application API; screens read it only via `inspectCampaign` and `viewAsPlayer`. Like the CLI, it imports only from `src/app/`; `test/tui-boundary.test.ts` fails on any import of domain internals or hidden state.
- `src/cli/` — developer command adapter: it may read files, parse arguments and write to stdout/stderr, must not duplicate domain rules, and imports only from `src/app/`.
- `content/scenarios/gamma-three-companies.json` — the Gamma baseline pack (authored content, design §5, §8.1, §14.1). It has three companies, one per sector. Tracebench (developer tools) and Papirflow (business process automation) apply in the week 1 inbound wave. Rampa (logistics software) exists in the world but starts unknown. Player-facing text is in Ukrainian; ids, internal notes and distortion reasons are in English. Each application states figures with a period. Where a figure differs from the hidden state, the claim carries a structured distortion reason, and the schema rejects an unexplained gap. `authoringNote` states each company's trade-off, for authors and debug only.
- `fixtures/configs/invalid-over-budget.json` — deliberately invalid config for error-path checks.
- `fixtures/scenarios/technical-empty.json` — technical reproducibility fixture, not a playable scenario.
- `fixtures/scenarios/minimal-one-company.json` — the smallest valid pack with one company; `fixtures/scenarios/invalid/` holds packs that fail on purpose (missing economics, forbidden outcome fields, duplicate ids, and research checks with a duplicate id, an unexplained gap, an unknown direction or a forbidden word in the question). Try one with `npm run --silent campaign -- --seed demo-1 --scenario fixtures/scenarios/invalid/missing-economics.json`.
- `test/` — `*.test.ts` files for the built-in Node test runner.
