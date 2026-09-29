// Full-screen renderer on Ink (React for terminals). It draws `buildScreen` and turns
// key presses into model actions; it holds no game rules of its own. Written with
// React.createElement because Node's type stripping does not support JSX.

import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import { createElement as h, useState, type ReactElement } from "react";

import { inputMode, SECTIONS, update, type Pane, type TuiState } from "./model.ts";
import { screenKeyIntent } from "./keys.ts";
import { buildScreen, helpLines, hintBar, NARROW_COLUMNS, packItems, wrapLines, type Screen, type ScreenContext } from "./screen.ts";
import { startCampaign, type ScenarioSource } from "./session.ts";

/** How the full-screen session ended; the launcher decides what happens next. */
export type ScreenExit = { readonly next: "quit" } | { readonly next: "text-mode"; readonly state: TuiState };

export interface AppProps {
  readonly initial: TuiState;
  readonly source: ScenarioSource;
}

export function App({ initial, source }: AppProps): ReactElement {
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const [state, setState] = useState(initial);
  const context: ScreenContext = { scenarioLabel: source.label };
  const layout = layoutFor(columns, rows, state, context);

  useInput((input, key) => {
    const intent = screenKeyIntent(input, key, inputMode(state));
    if (intent === undefined) return;
    switch (intent.type) {
      case "quit":
        exit({ next: "quit" } satisfies ScreenExit);
        return;
      case "text-mode":
        exit({ next: "text-mode", state } satisfies ScreenExit);
        return;
      case "start": {
        const result = startCampaign(state.seedDraft, source);
        setState((s) => update(s, { type: "start-result", result }));
        return;
      }
      case "scroll":
        setState((s) => update(s, { type: "scroll", delta: intent.pages ? intent.lines * layout.viewport : intent.lines, max: layout.maxScroll }));
        return;
      default:
        setState((s) => update(s, intent));
    }
  });

  return h(ScreenView, { state, context, columns, rows });
}

interface ScreenViewProps {
  readonly state: TuiState;
  readonly context: ScreenContext;
  readonly columns: number;
  readonly rows: number;
}

/** Stateless frame; also used directly by tests through Ink's renderToString. */
export function ScreenView({ state, context, columns, rows }: ScreenViewProps): ReactElement {
  const screen = buildScreen(state, context);
  const layout = layoutFor(columns, rows, state, context);
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
    h(StatusBar, { screen, narrow: layout.narrow, columns }),
    ...wrapLines([`Decision queue: ${screen.queue}`], columns).map((line, i) => h(Text, { key: `queue-${i}` }, line)),
    layout.narrow
      ? h(Box, { flexDirection: "column", marginTop: 1 }, h(NavLine, { screen, focus: state.focus }), main)
      : h(
          Box,
          { borderStyle: "round", flexDirection: "row" },
          h(NavColumn, { screen, focus: state.focus }),
          h(Box, { borderStyle: "single", borderTop: false, borderBottom: false, borderRight: false }),
          main,
        ),
    ...hintBar(inputMode(state), columns).map((line, i) => h(Text, { key: `hint-${i}`, dimColor: true }, line)),
  );
}

const APP_TITLE = "Venture Instinct";

function statusItems(screen: Screen): string[] {
  return screen.status.map((f) => `${f.label}: ${f.value}`);
}

/** The one-line wide status bar, without the bold title. */
function wideStatus(screen: Screen): string {
  return `  ${statusItems(screen).join(" · ")}`;
}

function StatusBar({ screen, narrow, columns }: { readonly screen: Screen; readonly narrow: boolean; readonly columns: number }): ReactElement {
  return narrow
    ? h(
        Box,
        { flexDirection: "column" },
        h(Text, { bold: true }, APP_TITLE),
        ...packItems(statusItems(screen), columns).map((line, i) => h(Text, { key: i }, line)),
      )
    : h(Text, null, h(Text, { bold: true }, APP_TITLE), wideStatus(screen));
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
// entry ("▸ 4 Companies") 13, separator 1, body padding 2.
const WIDE_CHROME_COLUMNS = 20;

function layoutFor(columns: number, rows: number, state: TuiState, context: ScreenContext): Layout {
  const screen = buildScreen(state, context);
  const hints = hintBar(inputMode(state), columns).length;
  // Rows outside the body. Wide: status, queue, two borders, title. Compact: app title,
  // status lines, queue, blank, nav, title. Both: the hint lines.
  const wideChrome = 5 + hints;
  // The side navigation needs one row per section beside the title and body, and the
  // wide status bar must fit on one line; otherwise the compact layout is used.
  const narrow =
    columns < NARROW_COLUMNS ||
    [...APP_TITLE, ...wideStatus(screen)].length > columns ||
    rows - wideChrome < SECTIONS.length - 1;
  const source = state.helpOpen ? helpLines() : screen.body;
  const lines = wrapLines(source, narrow ? columns : columns - WIDE_CHROME_COLUMNS);
  const queueLines = wrapLines([`Decision queue: ${screen.queue}`], columns).length;
  const narrowChrome = 4 + queueLines + packItems(statusItems(screen), columns).length + hints;
  const viewport = Math.max(1, rows - (narrow ? narrowChrome : wideChrome));
  return { narrow, lines, viewport, maxScroll: Math.max(0, lines.length - viewport) };
}
