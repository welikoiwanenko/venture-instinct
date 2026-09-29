// Maps raw input to intents, separately from any renderer so bindings are testable.
// Screen mode reads single key presses; text mode reads whole command lines.

import { findSection, type SectionId } from "./model.ts";

/** The subset of Ink's `Key` the bindings read. */
export interface KeyFlags {
  readonly upArrow?: boolean;
  readonly downArrow?: boolean;
  readonly leftArrow?: boolean;
  readonly rightArrow?: boolean;
  readonly pageUp?: boolean;
  readonly pageDown?: boolean;
  readonly tab?: boolean;
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
  | { readonly type: "toggle-help" }
  | { readonly type: "text-mode" }
  | { readonly type: "quit" };

export function screenKeyIntent(input: string, key: KeyFlags): Intent | undefined {
  if (key.tab) return key.shift ? { type: "previous" } : { type: "next" };
  if (key.rightArrow) return { type: "next" };
  if (key.leftArrow) return { type: "previous" };
  if (key.downArrow) return { type: "scroll", lines: 1 };
  if (key.upArrow) return { type: "scroll", lines: -1 };
  if (key.pageDown) return { type: "scroll", lines: 1, pages: true };
  if (key.pageUp) return { type: "scroll", lines: -1, pages: true };
  if (key.escape) return { type: "quit" };
  if (key.ctrl) return undefined;
  switch (input) {
    case "l":
      return { type: "next" };
    case "h":
      return { type: "previous" };
    case "j":
      return { type: "scroll", lines: 1 };
    case "k":
      return { type: "scroll", lines: -1 };
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

export type TextCommand = Exclude<Intent, { type: "scroll" } | { type: "text-mode" }>;

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
