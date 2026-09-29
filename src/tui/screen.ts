// What the TUI shows, as plain data (docs/design-doc.md §15). Both renderers (Ink and
// the linear text mode) draw this model, so their content never drifts apart. Statuses
// always carry a text label and a symbol; colour is decoration only.

import {
  compareObservations,
  formatCentsAsUsd,
  formatMetricValue,
  formatSource,
  inspectCampaign,
  METRIC_LABELS,
  STATUS_LABELS,
  viewAsPlayer,
  type CampaignSummary,
  type Metric,
  type PlayerCompany,
  type PlayerObservation,
  type PlayerView,
} from "../app/campaign-app.ts";
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
  /** Known companies, for the Companies cursor; 0 without a campaign. */
  readonly companyCount: number;
  /**
   * Body lines [start, end) of the selected company in the Companies list. The renderer
   * keeps them in the viewport, whatever the scroll position or window size.
   */
  readonly selected?: { readonly start: number; readonly end: number };
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

const COMPANY_LIST_KEYS: readonly KeyHint[] = [
  { keys: "↑↓ j/k", action: "choose a company", short: "choose" },
  { keys: "Enter/→", action: "open the company's card", short: "open" },
  { keys: "Esc/←", action: "back to the section list", short: "back" },
];

const COMPANY_CARD_KEYS: readonly KeyHint[] = [
  { keys: "↑↓ j/k", action: "scroll", short: "scroll" },
  { keys: "e", action: "messages in short or full form", short: "short/full" },
  { keys: "Esc/←", action: "back to the company list", short: "back" },
];

const PAGE_KEY: KeyHint = { keys: "PgUp/PgDn", action: "scroll the content a page" };

/** Keys per input mode; the hint bar shows the current mode's keys. */
export const MODE_KEYS: Readonly<Record<InputMode, readonly KeyHint[]>> = {
  sections: [...SECTION_LIST_KEYS, ...ANYWHERE_KEYS],
  content: [...CONTENT_KEYS, ...ANYWHERE_KEYS],
  seed: SEED_KEYS,
  "company-list": [...COMPANY_LIST_KEYS, ...ANYWHERE_KEYS],
  "company-card": [...COMPANY_CARD_KEYS, ...ANYWHERE_KEYS],
};

const MODE_LABELS: Readonly<Record<InputMode, string>> = {
  sections: "Section list",
  content: "Content",
  seed: "Seed field",
  "company-list": "Company list",
  "company-card": "Company card",
};

/** Help screen: every key, grouped by where it works. */
export function helpLines(): string[] {
  const groups: Array<[string, readonly KeyHint[]]> = [
    ["In the section list", SECTION_LIST_KEYS],
    ["In the content", CONTENT_KEYS],
    ["In the seed field (type the seed)", SEED_KEYS.slice(0, 2)],
    ["In Companies", [COMPANY_LIST_KEYS[0]!, COMPANY_LIST_KEYS[1]!, COMPANY_CARD_KEYS[1]!, { keys: "Esc/←", action: "from a card, back to the company list" }]],
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
  { keys: "open <n>", action: "open a company's card, e.g. open 1" },
  { keys: "expand / short", action: "messages on a card in full or short form" },
  { keys: "back", action: "from a card, back to the company list" },
  { keys: "? / help", action: "list commands" },
  { keys: "q / quit", action: "quit" },
];

const PLACEHOLDERS: Readonly<Record<Exclude<SectionId, "overview">, readonly string[]>> = {
  inbox: [
    "Messages delivered to you this week: applications, replies, research",
    "results and company updates. Each item shows its source and date.",
    "",
    "· The inbox arrives with weekly planning. Until then, this week's",
    "  applications are on each company's card: 4 Companies.",
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
    "· No campaign yet: start one on the Overview.",
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
  const view = state.campaign === undefined ? undefined : viewAsPlayer(state.campaign);
  const open = view !== undefined && state.companyOpen ? view.companies[state.companyCursor] : undefined;
  const list = section.id === "companies" && view !== undefined && open === undefined ? companyList(view, state.companyCursor, context) : undefined;
  return {
    status: statusFields(summary),
    queue: "○ Nothing needs you",
    nav: SECTIONS.map((s) => ({ id: s.id, key: s.key, title: s.title, active: s.id === state.section })),
    title: section.id === "companies" && open !== undefined ? `${section.title} › ${companyName(open)}` : section.title,
    position: `${index + 1} of ${SECTIONS.length}`,
    body:
      section.id === "overview"
        ? summary === undefined
          ? startForm(state, context)
          : overview(summary)
        : section.id === "companies" && view !== undefined
          ? open !== undefined
            ? companyCard(open, state.messagesExpanded, context)
            : (list?.lines ?? [])
          : PLACEHOLDERS[section.id],
    companyCount: view?.companies.length ?? 0,
    ...(list?.selected === undefined ? {} : { selected: list.selected }),
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
    row("Companies", s.knownCompanies === 0 ? "none known yet" : `${s.knownCompanies} known: see 4 Companies`),
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

function companyName(company: PlayerCompany): string {
  return company.profile?.name ?? company.companyId;
}

/** Known companies only: the player view has no unknown ones, so nothing else can be listed or counted. */
function companyList(
  view: PlayerView,
  cursor: number,
  context: ScreenContext,
): { lines: string[]; selected?: { start: number; end: number } } {
  if (view.companies.length === 0) {
    return { lines: ["You do not know any companies yet."] };
  }
  const count = view.companies.length;
  const lines = [
    `${count} ${count === 1 ? "company" : "companies"} you know, in no particular order.`,
    context.linear === true ? "Type open and a number to read a card, e.g. open 1." : "Choose one with ↑/↓ and press Enter to open its card.",
    "",
  ];
  let selected: { start: number; end: number } | undefined;
  view.companies.forEach((company, i) => {
    const start = lines.length;
    const marker = context.linear !== true && i === cursor ? "▸" : " ";
    const sector = company.profile?.sector ?? "sector unknown";
    lines.push(`${marker} ${i + 1}  ${companyName(company)} · ${sector}`);
    if (company.profile !== undefined) lines.push(`     ${company.profile.description}`);
    if (i === cursor) selected = { start, end: lines.length };
  });
  return selected === undefined ? { lines } : { lines, selected };
}

/**
 * Evidence only (§9.1, §15): the public profile, the player's own status, messages and
 * figures, each with source, week received, period and status. Figures of the same
 * metric are shown side by side with their difference. There is no score or ranking.
 */
function companyCard(company: PlayerCompany, expanded: boolean, context: ScreenContext): string[] {
  const profile = company.profile;
  const names = new Map(profile?.founders.map((f) => [f.founderId, f.name]));
  const lines: string[] = [];
  if (profile !== undefined) {
    lines.push(`${profile.name} · ${profile.sector} · ${profile.businessModel}`, profile.description, "", "Founders");
    for (const f of profile.founders) lines.push(`  ${f.name} · ${f.specialization}`);
    lines.push("");
  }
  lines.push(`You: decision ${company.decision} · contact ${company.contact} · opportunity ${company.opportunity}`);
  if (company.observations.some((o) => o.period.toWeek <= 0)) {
    lines.push("", "Each item: the period it describes · who said it · when you got it · status.", "Week 0 and earlier are before the campaign started.");
  }

  const messages = company.observations.filter((o) => o.content.kind === "text");
  if (messages.length > 0) {
    const how = context.linear === true ? (expanded ? "type short for the short form" : "type expand to read in full") : expanded ? "e: short form" : "e: read in full";
    lines.push("", `Messages (${expanded ? "full" : "short form"}; ${how})`);
    messages.forEach((o, i) => {
      if (o.content.kind !== "text") return;
      if (expanded && i > 0) lines.push("");
      lines.push(`  ✉ ${o.content.title}`, `    ${evidenceLine(o, names)}`);
      if (expanded) lines.push("", `    ${o.content.text}`);
    });
  }

  const byMetric = new Map<Metric, PlayerObservation[]>();
  for (const o of company.observations) {
    if (o.content.kind !== "metric") continue;
    byMetric.set(o.content.metric, [...(byMetric.get(o.content.metric) ?? []), o]);
  }
  if (byMetric.size > 0) {
    lines.push("", "Figures");
    for (const [metric, figures] of byMetric) {
      if (figures.length === 1) {
        const [only] = figures as [PlayerObservation];
        lines.push(`  ${METRIC_LABELS[metric]}: ${valueOf(only)}`, `    ${evidenceLine(only, names)}`);
        continue;
      }
      lines.push(`  ${METRIC_LABELS[metric]}: ${figures.length} figures side by side`);
      for (const o of figures) lines.push(`    ${valueOf(o)} · ${evidenceLine(o, names)}`);
      // First against last figure; every figure is listed above with its own period.
      const diff = compareObservations(figures[0]!, figures.at(-1)!);
      if (diff.samePeriod) {
        lines.push(`    They differ by ${formatMetricValue(metric, Math.abs(diff.difference))} for overlapping periods.`);
      } else {
        const sign = diff.difference > 0 ? "+" : "";
        lines.push(`    Change: ${sign}${formatMetricValue(metric, diff.difference)} from the earlier period to the later.`);
      }
    }
  }
  if (company.observations.length === 0) lines.push("", "Nothing delivered about this company yet.");
  return lines;
}

function valueOf(o: PlayerObservation): string {
  return o.content.kind === "metric" ? formatMetricValue(o.content.metric, o.content.value) : "";
}

/** Period, source, week received and status: every figure and message carries all four. */
function evidenceLine(o: PlayerObservation, names: ReadonlyMap<string, string>): string {
  const { fromWeek, toWeek } = o.period;
  const period = fromWeek === toWeek ? `week ${toWeek}` : `weeks ${fromWeek} to ${toWeek}`;
  return `${period} · ${formatSource(o.source, names)} · received week ${o.receivedWeek} · ${STATUS_LABELS[o.status]}`;
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
 * than the width are split. A line's leading spaces are kept on every line it wraps
 * into, so indented entries stay indented. Counts code points: every glyph the TUI uses
 * is single-width.
 */
export function wrapLines(lines: readonly string[], width: number): string[] {
  return lines.flatMap((line) => {
    const indent = /^ */.exec(line)?.[0] ?? "";
    // Keep the indent only while it leaves room for text.
    if (indent === "" || indent.length * 2 > width) return wrapLine(line, width);
    return wrapLine(line.slice(indent.length), width - indent.length).map((part) => indent + part);
  });
}

function wrapLine(line: string, width: number): string[] {
  const limit = Math.max(1, width);
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
}
