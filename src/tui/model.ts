// TUI navigation state (docs/design-doc.md §15). Pure: every key press becomes an
// action, and `update` returns a new state. Two panes: the section list and the
// current section's content; the focused one receives ↑/↓. The Ink renderer and the linear text mode
// share this model, so both reach the same sections in the same way.

import type { Campaign } from "../app/campaign-app.ts";
import type { StartResult } from "./session.ts";

export const SECTIONS = [
  { id: "overview", title: "Overview", key: "1" },
  { id: "inbox", title: "Inbox", key: "2" },
  { id: "discovery", title: "Discovery", key: "3" },
  { id: "companies", title: "Companies", key: "4" },
  { id: "portfolio", title: "Portfolio", key: "5" },
  { id: "history", title: "History", key: "6" },
  { id: "plan", title: "Plan", key: "7" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

/** Which pane receives ↑/↓: the section list, or the current section's content. */
export type Pane = "sections" | "content";

/**
 * What key presses mean right now: the two panes, typing into the seed field (the
 * Overview content before a campaign exists), where printable keys are text, or the
 * Companies content once a campaign exists: a list to choose from, or an open card.
 */
export type InputMode = Pane | "seed" | "company-list" | "company-card";

export interface TuiState {
  readonly section: SectionId;
  readonly focus: Pane;
  /** Reading position per section, kept while the player visits other sections. */
  readonly scroll: Readonly<Record<SectionId, number>>;
  readonly helpOpen: boolean;
  /** Opaque handle from the application API; screens read it only via inspectCampaign. */
  readonly campaign: Campaign | undefined;
  readonly seedDraft: string;
  /** Why the last start attempt failed; cleared by the next attempt. */
  readonly startErrors: readonly string[];
  /** Position in the Companies list (0-based), kept while the player visits other sections. */
  readonly companyCursor: number;
  /** Whether the card of the company under the cursor is open. */
  readonly companyOpen: boolean;
  /** Messages on a card in full (true) or in their one-line short form (false). */
  readonly messagesExpanded: boolean;
}

export type TuiAction =
  | { readonly type: "select"; readonly section: SectionId }
  | { readonly type: "next" }
  | { readonly type: "previous" }
  /** `max` is the last valid offset for the current viewport; the renderer knows it. */
  | { readonly type: "scroll"; readonly delta: number; readonly max: number }
  | { readonly type: "focus"; readonly pane: Pane }
  | { readonly type: "type-seed"; readonly text: string }
  | { readonly type: "erase-seed" }
  | { readonly type: "start-result"; readonly result: StartResult }
  | { readonly type: "toggle-help" }
  /** `count` is the number of known companies; the renderer knows it. */
  | { readonly type: "move-company"; readonly delta: number; readonly count: number }
  /** Opens the card under the cursor, or at `index` when given (text mode `open 2`). */
  | { readonly type: "open-company"; readonly count: number; readonly index?: number }
  | { readonly type: "close-company" }
  /** Sets the message form, or toggles it when `expanded` is absent. */
  | { readonly type: "expand"; readonly expanded?: boolean };

export function initialTuiState(): TuiState {
  return Object.freeze({
    section: SECTIONS[0].id,
    focus: "sections",
    scroll: Object.freeze(Object.fromEntries(SECTIONS.map((s) => [s.id, 0])) as Record<SectionId, number>),
    helpOpen: false,
    campaign: undefined,
    seedDraft: "",
    startErrors: Object.freeze([]),
    companyCursor: 0,
    companyOpen: false,
    messagesExpanded: false,
  });
}

export function inputMode(state: TuiState): InputMode {
  if (state.focus !== "content" || state.helpOpen) return state.focus;
  if (state.section === "overview" && state.campaign === undefined) return "seed";
  if (state.section === "companies" && state.campaign !== undefined) return state.companyOpen ? "company-card" : "company-list";
  return "content";
}

export function update(state: TuiState, action: TuiAction): TuiState {
  switch (action.type) {
    case "select":
      // Navigating closes help, so the player always lands on the section they chose.
      if (action.section === state.section && !state.helpOpen) return state;
      return Object.freeze({ ...state, section: action.section, helpOpen: false });
    case "next":
    case "previous": {
      const index = sectionIndex(state.section);
      const step = action.type === "next" ? 1 : -1;
      const next = SECTIONS[(index + step + SECTIONS.length) % SECTIONS.length];
      return next === undefined ? state : update(state, { type: "select", section: next.id });
    }
    case "scroll": {
      // Help fits on screen; scrolling it must not move the section's reading position.
      if (state.helpOpen) return state;
      const current = state.scroll[state.section];
      const target = Math.min(Math.max(current + action.delta, 0), Math.max(action.max, 0));
      if (target === current) return state;
      return Object.freeze({ ...state, scroll: Object.freeze({ ...state.scroll, [state.section]: target }) });
    }
    case "focus":
      if (action.pane === state.focus && !state.helpOpen) return state;
      return Object.freeze({ ...state, focus: action.pane, helpOpen: false });
    case "type-seed":
      return state.campaign !== undefined ? state : Object.freeze({ ...state, seedDraft: state.seedDraft + action.text });
    case "erase-seed":
      if (state.campaign !== undefined || state.seedDraft === "") return state;
      return Object.freeze({ ...state, seedDraft: [...state.seedDraft].slice(0, -1).join("") });
    case "start-result":
      // PoC 0.1 runs one campaign per session; a failed attempt changes only the errors.
      if (state.campaign !== undefined) return state;
      return action.result.ok
        ? Object.freeze({ ...state, campaign: action.result.campaign, startErrors: Object.freeze([]) })
        : Object.freeze({ ...state, startErrors: Object.freeze([...action.result.errors]) });
    case "toggle-help":
      return Object.freeze({ ...state, helpOpen: !state.helpOpen });
    case "move-company": {
      if (state.companyOpen) return state;
      const target = Math.min(Math.max(state.companyCursor + action.delta, 0), Math.max(action.count - 1, 0));
      return target === state.companyCursor ? state : Object.freeze({ ...state, companyCursor: target });
    }
    case "open-company": {
      const index = action.index ?? state.companyCursor;
      if (index < 0 || index >= action.count) return state;
      // A card opens at its top, with messages in their short form.
      return Object.freeze({
        ...state,
        companyCursor: index,
        companyOpen: true,
        messagesExpanded: false,
        scroll: Object.freeze({ ...state.scroll, companies: 0 }),
      });
    }
    case "close-company":
      if (!state.companyOpen) return state;
      return Object.freeze({ ...state, companyOpen: false, scroll: Object.freeze({ ...state.scroll, companies: 0 }) });
    case "expand": {
      const expanded = action.expanded ?? !state.messagesExpanded;
      if (!state.companyOpen || expanded === state.messagesExpanded) return state;
      return Object.freeze({ ...state, messagesExpanded: expanded });
    }
  }
}

export function sectionIndex(id: SectionId): number {
  return SECTIONS.findIndex((s) => s.id === id);
}

/** Accepts a section number ("3") or a case-insensitive name ("companies"). */
export function findSection(text: string): SectionId | undefined {
  const needle = text.trim().toLowerCase();
  return SECTIONS.find((s) => s.key === needle || s.id === needle)?.id;
}
