// What the TUI shows, as plain data (docs/design-doc.md §15). Both renderers (Ink and
// the linear text mode) draw this model, so their content never drifts apart. Statuses
// always carry a text label and a symbol; colour is decoration only.

import { formatCentsAsUsd, inspectCampaign, type CampaignSummary } from "../app/campaign-app.ts";
import { inputMode, SECTIONS, sectionIndex, type InputMode, type SectionId, type TuiState } from "./model.ts";

export interface StatusField {
  readonly label: string;
  readonly value: string;
}

export interface NavItem {
  readonly id: SectionId;
  readonly key: string;
  readonly title: string;
  readonly active: boolean;
}

export interface KeyHint {
  readonly keys: string;
  readonly action: string;
  /** Label for the always-visible hint bar; the help screen shows `action`. */
  readonly short?: string;
}

export interface Screen {
  readonly status: readonly StatusField[];
  /** Decision queue line, e.g. "○ Nothing needs you". */
  readonly queue: string;
  readonly nav: readonly NavItem[];
  readonly title: string;
  /** "3 of 7" */
  readonly position: string;
  readonly body: readonly string[];
}

/** Below this width the TUI drops the side navigation and uses a single column. */
export const NARROW_COLUMNS = 72;

const ANYWHERE_KEYS: readonly KeyHint[] = [
  { keys: "1-7", action: "go to section", short: "jump" },
  { keys: "Tab", action: "next section" },
  { keys: "S-Tab", action: "previous section" },
  { keys: "?", action: "help", short: "help" },
  { keys: "t", action: "linear text mode", short: "text mode" },
  { keys: "q", action: "quit", short: "quit" },
];

const SECTION_LIST_KEYS: readonly KeyHint[] = [
  { keys: "↑↓ j/k", action: "previous / next section", short: "section" },
  { keys: "Enter/→", action: "open the section's content", short: "open" },
];

const CONTENT_KEYS: readonly KeyHint[] = [
  { keys: "↑↓ j/k", action: "scroll", short: "scroll" },
  { keys: "Esc/←", action: "back to the section list", short: "back" },
];

// Printable keys are text in the seed field, so only these act there.
const SEED_KEYS: readonly KeyHint[] = [
  { keys: "Enter", action: "start the campaign", short: "start" },
  { keys: "Bksp", action: "erase a character", short: "erase" },
  { keys: "Esc/←", action: "back to the section list", short: "back" },
  { keys: "Tab", action: "next section", short: "next section" },
];

const PAGE_KEY: KeyHint = { keys: "PgUp/PgDn", action: "scroll the content a page" };

/** Keys per input mode; the hint bar shows the current mode's keys. */
export const MODE_KEYS: Readonly<Record<InputMode, readonly KeyHint[]>> = {
  sections: [...SECTION_LIST_KEYS, ...ANYWHERE_KEYS],
  content: [...CONTENT_KEYS, ...ANYWHERE_KEYS],
  seed: SEED_KEYS,
};

const MODE_LABELS: Readonly<Record<InputMode, string>> = {
  sections: "Section list",
  content: "Content",
  seed: "Seed field",
};

/** Help screen: every key, grouped by where it works. */
export function helpLines(): string[] {
  const groups: Array<[string, readonly KeyHint[]]> = [
    ["In the section list", SECTION_LIST_KEYS],
    ["In the content", CONTENT_KEYS],
    ["In the seed field (type the seed)", SEED_KEYS.slice(0, 2)],
    ["Anywhere", [PAGE_KEY, ...ANYWHERE_KEYS]],
  ];
  const width = Math.max(...groups.flatMap(([, hints]) => hints.map((h) => h.keys.length)));
  return groups.flatMap(([heading, hints], i) => [...(i === 0 ? [] : [""]), `${heading}:`, ...renderHelp(hints, width)]);
}

/**
 * The always-visible hints for the input mode, led by its name, packed into as few
 * lines of `width` as possible without splitting a hint. Keys without a `short` label
 * are listed only in help.
 */
export function hintBar(mode: InputMode, width: number): string[] {
  return packItems(
    [`[${MODE_LABELS[mode]}]`, ...MODE_KEYS[mode].flatMap((h) => (h.short === undefined ? [] : [`${h.keys} ${h.short}`]))],
    width,
  );
}

/** Joins items with " · ", starting a new line instead of splitting an item. */
export function packItems(items: readonly string[], width: number): string[] {
  const lines: string[] = [];
  for (const item of items) {
    const last = lines.at(-1);
    if (last !== undefined && [...last].length + 3 + [...item].length <= width) {
      lines[lines.length - 1] = `${last} · ${item}`;
    } else {
      lines.push(item);
    }
  }
  return lines;
}

export const TEXT_COMMANDS: readonly KeyHint[] = [
  { keys: "start <seed>", action: "start a campaign, e.g. start demo-1" },
  { keys: "1-7 or a name", action: "go to section, e.g. 4 or companies" },
  { keys: "n / next", action: "next section" },
  { keys: "p / prev", action: "previous section" },
  { keys: "? / help", action: "list commands" },
  { keys: "q / quit", action: "quit" },
];

const PLACEHOLDERS: Readonly<Record<Exclude<SectionId, "overview">, readonly string[]>> = {
  inbox: [
    "Messages delivered to you this week: applications, replies, research",
    "results and company updates. Each item shows its source and date.",
    "",
    "· Nothing here yet: inbound applications arrive with the first companies.",
  ],
  discovery: [
    "Leads you have not engaged with yet: signals from the market and",
    "outbound searches you ran.",
    "",
    "· Nothing here yet: discovery arrives with weekly planning.",
  ],
  companies: [
    "Companies you know, with the evidence you have about each one:",
    "founders, metrics with their dates, and conflicting claims side by side.",
    "",
    "· Nothing here yet: companies arrive in the next milestone.",
  ],
  portfolio: [
    "Your investments: stake, cash versus illiquid valuation with its date,",
    "and alerts computed only from what you have been told.",
    "",
    "· Nothing here yet: the portfolio is empty until your first investment.",
  ],
  history: [
    "Your decisions and what you knew when you made them: research, passes,",
    "investments and their theses.",
    "",
    "· Nothing here yet.",
  ],
  plan: [
    "This week's plan: actions, their slot cost, prerequisites and when the",
    "result arrives. One review before End Week.",
    "",
    "· Nothing here yet: weekly planning arrives in a later milestone.",
  ],
};

export interface ScreenContext {
  /** Where new campaigns take their scenario from, shown on the start form. */
  readonly scenarioLabel: string;
  /** Linear text mode: the start form asks for a `start <seed>` command, not Enter. */
  readonly linear?: boolean;
}

/**
 * Pure read: the campaign is only ever passed to `inspectCampaign`, so building (and
 * rebuilding) a screen never changes it and shows only player-visible data.
 */
export function buildScreen(state: TuiState, context: ScreenContext): Screen {
  const index = sectionIndex(state.section);
  const section = SECTIONS[index] ?? SECTIONS[0];
  const summary = state.campaign === undefined ? undefined : inspectCampaign(state.campaign);
  return {
    status: statusFields(summary),
    queue: "○ Nothing needs you",
    nav: SECTIONS.map((s) => ({ id: s.id, key: s.key, title: s.title, active: s.id === state.section })),
    title: section.title,
    position: `${index + 1} of ${SECTIONS.length}`,
    body:
      section.id !== "overview"
        ? PLACEHOLDERS[section.id]
        : summary === undefined
          ? startForm(state, context)
          : overview(summary),
  };
}

function statusFields(s: CampaignSummary | undefined): StatusField[] {
  if (s === undefined) {
    return [
      { label: "Week", value: "— no campaign" },
      { label: "Slots", value: "—" },
      { label: "Budget", value: "—" },
    ];
  }
  return [
    { label: "Week", value: `${s.planningWeek} (${s.completedWeeks}/${s.horizonWeeks} done)` },
    { label: "Slots", value: `${s.slotsAvailable} left` },
    { label: "Budget", value: formatCentsAsUsd(s.capitalAvailableCents) },
  ];
}

function startForm(state: TuiState, context: ScreenContext): string[] {
  const editing = inputMode(state) === "seed";
  const seed = editing ? `[${state.seedDraft}_]` : state.seedDraft === "" ? "(none yet)" : state.seedDraft;
  const lines = [
    "No campaign yet. Start one from a seed: the same seed and scenario always give",
    "the same campaign.",
    "",
    `Scenario   ${context.scenarioLabel}`,
    `Seed       ${seed}`,
    "",
    context.linear === true
      ? "Type start and a seed (1-128 characters, no spaces), e.g. start demo-1."
      : editing
        ? "Type a seed (1-128 characters, no spaces), then press Enter to start."
        : "Press Enter to type a seed.",
  ];
  if (state.startErrors.length > 0) {
    lines.push("", "✖ Campaign not started:", ...state.startErrors.map((e) => `  ${e}`));
  }
  return lines;
}

function overview(s: CampaignSummary): string[] {
  const row = (label: string, value: string) => `${label.padEnd(11)}${value}`;
  return [
    "✔ Campaign started. Nothing has happened yet: plan week 1.",
    "",
    row("Week", `planning week ${s.planningWeek}; ${s.completedWeeks} of ${s.horizonWeeks} completed`),
    row("Window", s.investmentWindowOpen ? "initial investments open" : "initial investments closed"),
    row("Slots", `${s.slotsAvailable} available this week`),
    row("Capital", `${formatCentsAsUsd(s.capitalAvailableCents)} available`),
    row("Invested", `${s.initialInvestmentsMade} of ${s.maxInitialInvestments} initial checks of ${formatCentsAsUsd(s.checkSizeCents)}`),
    row("Portfolio", s.portfolioSize === 0 ? "empty" : `${s.portfolioSize} companies`),
    "",
    "Manifest",
    row("Campaign", s.campaignId),
    row("Seed", s.seed),
    row("Scenario", s.scenarioId),
    row("Config", `${s.configId} v${s.configVersion}`),
    // A prefix is enough to compare with the CLI and keeps the row on one line.
    row("State", `${s.stateHash.slice(0, "sha256:".length + 12)}…`),
  ];
}

/** The whole screen as plain lines, top to bottom, for assistive tools and pipes. */
export function renderLinear(screen: Screen): string {
  const lines = [
    `== ${screen.title} (section ${screen.position}) ==`,
    ...screen.status.map((f) => `${f.label}: ${f.value}`),
    `Decision queue: ${screen.queue}`,
    "",
    ...screen.body,
    "",
    `Sections: ${screen.nav.map((n) => `${n.key} ${n.title}${n.active ? " (current)" : ""}`).join(", ")}`,
    `Commands: ${TEXT_COMMANDS.map((c) => c.keys).join(", ")}`,
  ];
  return `${lines.join("\n")}\n`;
}

export function renderHelp(hints: readonly KeyHint[], width = Math.max(...hints.map((h) => h.keys.length))): string[] {
  return hints.map((h) => `${h.keys.padEnd(width)}  ${h.action}`);
}

/**
 * Word-wraps to `width` columns so the renderer can scroll by visible line. Words longer
 * than the width are split. Counts code points: every glyph the TUI uses is single-width.
 */
export function wrapLines(lines: readonly string[], width: number): string[] {
  const limit = Math.max(1, width);
  return lines.flatMap((line) => {
    const out: string[] = [];
    let current = "";
    for (const word of line.split(" ")) {
      let rest = word;
      while ([...rest].length > limit) {
        if (current !== "") {
          out.push(current);
          current = "";
        }
        out.push([...rest].slice(0, limit).join(""));
        rest = [...rest].slice(limit).join("");
      }
      const joined = current === "" ? rest : `${current} ${rest}`;
      if ([...joined].length <= limit) {
        current = joined;
      } else {
        out.push(current);
        current = rest;
      }
    }
    out.push(current);
    return out;
  });
}
