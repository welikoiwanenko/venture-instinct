// Maps raw input to intents, separately from any renderer so bindings are testable.
// Screen mode reads single key presses; text mode reads whole command lines.

import { findSection, type InputMode, type SectionId } from "./model.ts";

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
  readonly backspace?: boolean;
  readonly delete?: boolean;
  readonly meta?: boolean;
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
  | { readonly type: "focus"; readonly pane: "sections" | "content" }
  | { readonly type: "type-seed"; readonly text: string }
  | { readonly type: "erase-seed" }
  /** Start with the current seed draft (screen) or the given seed (text mode). */
  | { readonly type: "start"; readonly seed?: string }
  | { readonly type: "toggle-help" }
  | { readonly type: "text-mode" }
  | { readonly type: "quit" };

/**
 * Keys that work in both panes: 1-7, Tab/Shift+Tab, PgUp/PgDn, ?, t and q. ↑/↓ (j/k)
 * move through the section list or scroll the content, depending on focus; Enter/→
 * (l) opens the content and Esc/← (h) goes back to the section list. In the seed field
 * printable keys are text, so only Tab, Enter, Backspace, Esc/← and Ctrl+C act.
 */
export function screenKeyIntent(input: string, key: KeyFlags, mode: InputMode): Intent | undefined {
  if (key.tab) return key.shift ? { type: "previous" } : { type: "next" };
  if (mode === "seed") return seedKeyIntent(input, key);
  const focus = mode;
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
  if (key.escape || key.return || key.leftArrow || key.rightArrow || key.upArrow || key.downArrow || key.meta) return undefined;
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

function seedKeyIntent(input: string, key: KeyFlags): Intent | undefined {
  if (key.return) return { type: "start" };
  if (key.escape || key.leftArrow) return { type: "focus", pane: "sections" };
  // Many terminals send DEL for Backspace, which Ink reports as `delete`.
  if (key.backspace || key.delete) return { type: "erase-seed" };
  // Ink turns known keys into flags with empty input; an unparsed escape sequence
  // (a key Ink does not know) is dropped whole rather than typed as "[A" and the like.
  if (key.ctrl || key.meta || input.includes("\x1b")) return undefined;
  // Keep printable text only.
  const text = [...input].filter((c) => c >= " " && c !== "\x7f").join("");
  return text === "" ? undefined : { type: "type-seed", text };
}

export type TextCommand =
  | Extract<Intent, { type: "select" | "next" | "previous" | "toggle-help" | "quit" }>
  | { readonly type: "start"; readonly seed: string };

/** `undefined` for an empty line; `{ unknown }` when the command is not recognised. */
export function textCommand(line: string): TextCommand | { readonly unknown: string } | undefined {
  const word = line.trim().toLowerCase();
  if (word === "") return undefined;
  // The seed keeps its case; it is everything after "start ", validated by the app.
  const start = /^start(?:\s+(.*))?$/i.exec(line.trim());
  if (start !== null) return { type: "start", seed: start[1]?.trim() ?? "" };
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
