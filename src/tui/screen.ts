// What the TUI shows, as plain data (docs/design-doc.md §15). Both renderers (Ink and
// the linear text mode) draw this model, so their content never drifts apart. Statuses
// always carry a text label and a symbol; colour is decoration only.

import { SECTIONS, sectionIndex, type SectionId, type TuiState } from "./model.ts";

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
  /** "3 of 6" */
  readonly position: string;
  readonly body: readonly string[];
}

/** Below this width the TUI drops the side navigation and uses a single column. */
export const NARROW_COLUMNS = 72;

export const SCREEN_KEYS: readonly KeyHint[] = [
  { keys: "1-6", action: "go to section", short: "section" },
  { keys: "Tab/→", action: "next section", short: "next" },
  { keys: "S-Tab/←", action: "previous section", short: "prev" },
  { keys: "↑↓ j/k", action: "scroll", short: "scroll" },
  { keys: "PgUp/PgDn", action: "scroll a page" },
  { keys: "?", action: "help", short: "help" },
  { keys: "t", action: "linear text mode", short: "text mode" },
  { keys: "q", action: "quit", short: "quit" },
];

/**
 * The always-visible hints, packed into as few lines of `width` as possible without
 * splitting a hint. Keys without a `short` label are listed only in help.
 */
export function hintBar(hints: readonly KeyHint[], width: number): string[] {
  const lines: string[] = [];
  for (const item of hints.flatMap((h) => (h.short === undefined ? [] : [`${h.keys} ${h.short}`]))) {
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
  { keys: "1-6 or a name", action: "go to section, e.g. 3 or companies" },
  { keys: "n / next", action: "next section" },
  { keys: "p / prev", action: "previous section" },
  { keys: "? / help", action: "list commands" },
  { keys: "q / quit", action: "quit" },
];

const PLACEHOLDERS: Readonly<Record<SectionId, readonly string[]>> = {
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

export function buildScreen(state: TuiState): Screen {
  const index = sectionIndex(state.section);
  const section = SECTIONS[index] ?? SECTIONS[0];
  return {
    status: [
      { label: "Week", value: "— no campaign" },
      { label: "Slots", value: "—" },
      { label: "Budget", value: "—" },
    ],
    queue: "○ Nothing needs you",
    nav: SECTIONS.map((s) => ({ id: s.id, key: s.key, title: s.title, active: s.id === state.section })),
    title: section.title,
    position: `${index + 1} of ${SECTIONS.length}`,
    body: PLACEHOLDERS[section.id],
  };
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

export function renderHelp(hints: readonly KeyHint[]): string[] {
  const width = Math.max(...hints.map((h) => h.keys.length));
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
