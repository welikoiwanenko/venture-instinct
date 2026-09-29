// TUI navigation state (docs/design-doc.md §15). Pure: every key press becomes an
// action, and `update` returns a new state. Two panes: the section list and the
// current section's content; the focused one receives ↑/↓. The Ink renderer and the linear text mode
// share this model, so both reach the same sections in the same way.

export const SECTIONS = [
  { id: "inbox", title: "Inbox", key: "1" },
  { id: "discovery", title: "Discovery", key: "2" },
  { id: "companies", title: "Companies", key: "3" },
  { id: "portfolio", title: "Portfolio", key: "4" },
  { id: "history", title: "History", key: "5" },
  { id: "plan", title: "Plan", key: "6" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

/** Which pane receives ↑/↓: the section list, or the current section's content. */
export type Pane = "sections" | "content";

export interface TuiState {
  readonly section: SectionId;
  readonly focus: Pane;
  /** Reading position per section, kept while the player visits other sections. */
  readonly scroll: Readonly<Record<SectionId, number>>;
  readonly helpOpen: boolean;
}

export type TuiAction =
  | { readonly type: "select"; readonly section: SectionId }
  | { readonly type: "next" }
  | { readonly type: "previous" }
  /** `max` is the last valid offset for the current viewport; the renderer knows it. */
  | { readonly type: "scroll"; readonly delta: number; readonly max: number }
  | { readonly type: "focus"; readonly pane: Pane }
  | { readonly type: "toggle-help" };

export function initialTuiState(): TuiState {
  return Object.freeze({
    section: SECTIONS[0].id,
    focus: "sections",
    scroll: Object.freeze(Object.fromEntries(SECTIONS.map((s) => [s.id, 0])) as Record<SectionId, number>),
    helpOpen: false,
  });
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
    case "toggle-help":
      return Object.freeze({ ...state, helpOpen: !state.helpOpen });
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
