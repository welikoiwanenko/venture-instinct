// Maps raw input to intents, separately from any renderer so bindings are testable.
// Screen mode reads single key presses; text mode reads whole command lines.

import { findSection, type Pane, type SectionId } from "./model.ts";

/** The subset of Ink's `Key` the bindings read. */
export interface KeyFlags {
  readonly upArrow?: boolean;
  readonly downArrow?: boolean;
  readonly leftArrow?: boolean;
  readonly rightArrow?: boolean;
  readonly pageUp?: boolean;
  readonly pageDown?: boolean;
  readonly tab?: boolean;
  readonly return?: boolean;
  readonly shift?: boolean;
  readonly escape?: boolean;
  readonly ctrl?: boolean;
}

export type Intent =
  | { readonly type: "select"; readonly section: SectionId }
  | { readonly type: "next" }
  | { readonly type: "previous" }
  /** Lines, or pages when `pages` is set; the renderer converts pages to lines. */
  | { readonly type: "scroll"; readonly lines: number; readonly pages?: boolean }
  | { readonly type: "focus"; readonly pane: Pane }
  | { readonly type: "toggle-help" }
  | { readonly type: "text-mode" }
  | { readonly type: "quit" };

/**
 * Keys that work in both panes: 1-6, Tab/Shift+Tab, PgUp/PgDn, ?, t and q. ↑/↓ (j/k)
 * move through the section list or scroll the content, depending on focus; Enter/→
 * (l) opens the content and Esc/← (h) goes back to the section list.
 */
export function screenKeyIntent(input: string, key: KeyFlags, focus: Pane): Intent | undefined {
  if (key.tab) return key.shift ? { type: "previous" } : { type: "next" };
  if (key.pageDown) return { type: "scroll", lines: 1, pages: true };
  if (key.pageUp) return { type: "scroll", lines: -1, pages: true };
  if (key.ctrl) return undefined;
  const up = key.upArrow || input === "k";
  const down = key.downArrow || input === "j";
  if (focus === "sections") {
    if (up) return { type: "previous" };
    if (down) return { type: "next" };
    if (key.return || key.rightArrow || input === "l") return { type: "focus", pane: "content" };
  } else {
    if (up) return { type: "scroll", lines: -1 };
    if (down) return { type: "scroll", lines: 1 };
    if (key.escape || key.leftArrow || input === "h") return { type: "focus", pane: "sections" };
  }
  if (key.escape || key.return || key.leftArrow || key.rightArrow || key.upArrow || key.downArrow) return undefined;
  switch (input) {
    case "?":
      return { type: "toggle-help" };
    case "t":
      return { type: "text-mode" };
    case "q":
      return { type: "quit" };
  }
  const section = /^[1-9]$/.test(input) ? findSection(input) : undefined;
  return section === undefined ? undefined : { type: "select", section };
}

export type TextCommand = Exclude<Intent, { type: "scroll" } | { type: "focus" } | { type: "text-mode" }>;

/** `undefined` for an empty line; `{ unknown }` when the command is not recognised. */
export function textCommand(line: string): TextCommand | { readonly unknown: string } | undefined {
  const word = line.trim().toLowerCase();
  if (word === "") return undefined;
  switch (word) {
    case "n":
    case "next":
      return { type: "next" };
    case "p":
    case "prev":
    case "previous":
      return { type: "previous" };
    case "?":
    case "help":
      return { type: "toggle-help" };
    case "q":
    case "quit":
    case "exit":
      return { type: "quit" };
  }
  const section = findSection(word);
  return section === undefined ? { unknown: line.trim() } : { type: "select", section };
}
