// Full-screen renderer on Ink (React for terminals). It draws `buildScreen` and turns
// key presses into model actions; it holds no game rules of its own. Written with
// React.createElement because Node's type stripping does not support JSX.

import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import { createElement as h, useState, type ReactElement } from "react";

import { SECTIONS, update, type Pane, type TuiState } from "./model.ts";
import { screenKeyIntent } from "./keys.ts";
import { buildScreen, helpLines, hintBar, NARROW_COLUMNS, wrapLines, type Screen } from "./screen.ts";

/** How the full-screen session ended; the launcher decides what happens next. */
export type ScreenExit = { readonly next: "quit" } | { readonly next: "text-mode"; readonly state: TuiState };

export interface AppProps {
  readonly initial: TuiState;
}

export function App({ initial }: AppProps): ReactElement {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const [state, setState] = useState(initial);
  const layout = layoutFor(columns, rows, state);

  useInput((input, key) => {
    const intent = screenKeyIntent(input, key, state.focus);
    if (intent === undefined) return;
    switch (intent.type) {
      case "quit":
        exit({ next: "quit" } satisfies ScreenExit);
        return;
      case "text-mode":
        exit({ next: "text-mode", state } satisfies ScreenExit);
        return;
      case "scroll":
        setState((s) => update(s, { type: "scroll", delta: intent.pages ? intent.lines * layout.viewport : intent.lines, max: layout.maxScroll }));
        return;
      default:
        setState((s) => update(s, intent));
    }
  });

  return h(ScreenView, { state, columns, rows });
}

interface ScreenViewProps {
  readonly state: TuiState;
  readonly columns: number;
  readonly rows: number;
}

/** Stateless frame; also used directly by tests through Ink's renderToString. */
export function ScreenView({ state, columns, rows }: ScreenViewProps): ReactElement {
  const screen = buildScreen(state);
  const layout = layoutFor(columns, rows, state);
  const offset = state.helpOpen ? 0 : Math.min(state.scroll[state.section], layout.maxScroll);
  const body = layout.lines.slice(offset, offset + layout.viewport);
  const contentFocused = state.focus === "content" && !state.helpOpen;
  const title = state.helpOpen
    ? "Help — ? to close"
    : `${contentFocused ? "▸ " : ""}${screen.title} (${screen.position})`;
  const more = layout.lines.length > layout.viewport ? `  lines ${offset + 1}–${offset + body.length} of ${layout.lines.length}` : "";
  const main = h(
    Box,
    { flexDirection: "column", flexGrow: 1, paddingX: layout.narrow ? 0 : 1 },
    h(Text, null, h(Text, { bold: true, inverse: contentFocused }, title), h(Text, { dimColor: true }, more)),
    ...body.map((line, i) => h(Text, { key: i }, line === "" ? " " : line)),
  );

  return h(
    Box,
    { flexDirection: "column", width: columns },
    h(StatusBar, { screen, narrow: layout.narrow }),
    h(Text, null, `Decision queue: ${screen.queue}`),
    layout.narrow
      ? h(Box, { flexDirection: "column", marginTop: 1 }, h(NavLine, { screen, focus: state.focus }), main)
      : h(
          Box,
          { borderStyle: "round", flexDirection: "row" },
          h(NavColumn, { screen, focus: state.focus }),
          h(Box, { borderStyle: "single", borderTop: false, borderBottom: false, borderRight: false }),
          main,
        ),
    ...hintBar(state.focus, columns).map((line, i) => h(Text, { key: `hint-${i}`, dimColor: true }, line)),
  );
}

function StatusBar({ screen, narrow }: { readonly screen: Screen; readonly narrow: boolean }): ReactElement {
  const fields = screen.status.map((f) => `${f.label}: ${f.value}`);
  return narrow
    ? h(Box, { flexDirection: "column" }, h(Text, { bold: true }, "Venture Instinct"), h(Text, { wrap: "wrap" }, fields.join(" · ")))
    : h(Text, { wrap: "truncate-end" }, h(Text, { bold: true }, "Venture Instinct"), `   ${fields.join("  │  ")}`);
}

interface NavProps {
  readonly screen: Screen;
  readonly focus: Pane;
}

// The current section is always marked with ▸; it is also inverted while the section
// list has focus, and the content title is inverted instead when the content does.
function NavColumn({ screen, focus }: NavProps): ReactElement {
  return h(
    Box,
    { flexDirection: "column", paddingX: 1, flexShrink: 0 },
    ...screen.nav.map((n) =>
      h(Text, { key: n.id, bold: n.active, inverse: n.active && focus === "sections" }, `${n.active ? "▸" : " "} ${n.key} ${n.title}`),
    ),
  );
}

/** Narrow windows show one line: every section key with the current one marked. */
function NavLine({ screen, focus }: NavProps): ReactElement {
  return h(
    Text,
    { wrap: "wrap" },
    ...screen.nav.flatMap((n, i) => [
      i === 0 ? "" : " ",
      h(Text, { key: n.id, bold: n.active, inverse: n.active && focus === "sections" }, n.active ? `▸${n.key} ${n.title}` : `${n.key}`),
    ]),
  );
}

interface Layout {
  readonly narrow: boolean;
  readonly lines: readonly string[];
  readonly viewport: number;
  readonly maxScroll: number;
}

// Wide layout columns outside the body: outer borders 2, nav padding 2, the widest nav
// entry ("▸ 3 Companies") 13, separator 1, body padding 2.
const WIDE_CHROME_COLUMNS = 20;

function layoutFor(columns: number, rows: number, state: TuiState): Layout {
  const hints = hintBar(state.focus, columns).length;
  // Rows outside the body. Wide: status, queue, two borders, title. Compact: title and
  // status, queue, blank, nav, title. Both: the hint lines.
  const wideChrome = 5 + hints;
  // The side navigation needs one row per section beside the title and body, so a short
  // window gets the compact layout too.
  const narrow = columns < NARROW_COLUMNS || rows - wideChrome < SECTIONS.length - 1;
  const source = state.helpOpen ? helpLines() : buildScreen(state).body;
  const lines = wrapLines(source, narrow ? columns : columns - WIDE_CHROME_COLUMNS);
  const viewport = Math.max(1, rows - (narrow ? 6 + hints : wideChrome));
  return { narrow, lines, viewport, maxScroll: Math.max(0, lines.length - viewport) };
}
