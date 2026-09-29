import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { renderToString } from "ink";
import { createElement } from "react";

import { ScreenView } from "../src/tui/ink-app.ts";
import { screenKeyIntent, textCommand } from "../src/tui/keys.ts";
import { findSection, initialTuiState, SECTIONS, update, type TuiState } from "../src/tui/model.ts";
import { buildScreen, renderLinear } from "../src/tui/screen.ts";
import { runTextMode } from "../src/tui/text-mode.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function frame(state: TuiState, columns: number, rows = 24): string {
  return renderToString(createElement(ScreenView, { state, columns, rows }), { columns });
}

test("every section is reachable by number, name and by cycling in both directions", () => {
  let state = initialTuiState();
  const forward: string[] = [];
  for (let i = 0; i < SECTIONS.length; i++) {
    forward.push(state.section);
    state = update(state, { type: "next" });
  }
  assert.deepEqual(forward, SECTIONS.map((s) => s.id));
  assert.equal(state.section, "inbox", "next wraps around");
  assert.equal(update(state, { type: "previous" }).section, "plan", "previous wraps around");
  for (const s of SECTIONS) {
    assert.equal(findSection(s.key), s.id);
    assert.equal(findSection(s.title.toUpperCase()), s.id);
  }
  assert.equal(findSection("7"), undefined);
});

test("reading position is kept per section when the player returns", () => {
  let state = update(initialTuiState(), { type: "scroll", delta: 3, max: 10 });
  state = update(state, { type: "select", section: "companies" });
  assert.equal(state.scroll.companies, 0);
  state = update(state, { type: "scroll", delta: 1, max: 10 });
  state = update(state, { type: "select", section: "inbox" });
  assert.equal(state.scroll.inbox, 3);
  assert.equal(state.scroll.companies, 1);
  assert.equal(update(state, { type: "scroll", delta: 99, max: 4 }).scroll.inbox, 4, "clamped to the viewport");
  assert.equal(update(state, { type: "scroll", delta: -99, max: 4 }).scroll.inbox, 0);
});

test("help keeps the reading position and closes on navigation", () => {
  let state = update(initialTuiState(), { type: "scroll", delta: 2, max: 5 });
  state = update(state, { type: "toggle-help" });
  assert.equal(update(state, { type: "scroll", delta: 1, max: 5 }), state, "scrolling is ignored while help is open");
  assert.equal(update(state, { type: "select", section: "inbox" }).helpOpen, false, "choosing the current section closes help");
  const moved = update(state, { type: "next" });
  assert.equal(moved.helpOpen, false);
  assert.equal(update(moved, { type: "previous" }).scroll.inbox, 2);
});

test("key bindings", () => {
  assert.deepEqual(screenKeyIntent("3", {}), { type: "select", section: "companies" });
  assert.deepEqual(screenKeyIntent("", { tab: true }), { type: "next" });
  assert.deepEqual(screenKeyIntent("", { tab: true, shift: true }), { type: "previous" });
  assert.deepEqual(screenKeyIntent("", { rightArrow: true }), { type: "next" });
  assert.deepEqual(screenKeyIntent("", { leftArrow: true }), { type: "previous" });
  assert.deepEqual(screenKeyIntent("j", {}), { type: "scroll", lines: 1 });
  assert.deepEqual(screenKeyIntent("", { pageUp: true }), { type: "scroll", lines: -1, pages: true });
  assert.deepEqual(screenKeyIntent("?", {}), { type: "toggle-help" });
  assert.deepEqual(screenKeyIntent("t", {}), { type: "text-mode" });
  assert.deepEqual(screenKeyIntent("q", {}), { type: "quit" });
  assert.deepEqual(screenKeyIntent("", { escape: true }), { type: "quit" });
  assert.equal(screenKeyIntent("9", {}), undefined);
  assert.equal(screenKeyIntent("q", { ctrl: true }), undefined);

  assert.deepEqual(textCommand(" Portfolio "), { type: "select", section: "portfolio" });
  assert.deepEqual(textCommand("n"), { type: "next" });
  assert.deepEqual(textCommand("help"), { type: "toggle-help" });
  assert.deepEqual(textCommand("quit"), { type: "quit" });
  assert.deepEqual(textCommand("fly"), { unknown: "fly" });
  assert.equal(textCommand("   "), undefined);
});

test("wide layout shows status, decision queue, all sections, the body and key hints", () => {
  const out = frame(update(initialTuiState(), { type: "select", section: "discovery" }), 100);
  for (const text of ["Venture Instinct", "Week: — no campaign", "Slots: —", "Budget: —", "Decision queue: ○ Nothing needs you", "Discovery (2 of 6)", "? help", "q quit"]) {
    assert.ok(out.includes(text), `missing ${text}\n${out}`);
  }
  for (const s of SECTIONS) assert.ok(out.includes(`${s.key} ${s.title}`), s.title);
  assert.match(out, /▸ 2 Discovery/, "the current section is marked with a symbol, not only colour");
  assertFits(out, 100);
  assert.ok(out.split("\n").length <= 24);
});

test("narrow layout keeps every line within the window", () => {
  for (const columns of [40, 50, 71]) {
    const out = frame(update(initialTuiState(), { type: "select", section: "plan" }), columns, 20);
    assertFits(out, columns);
    assert.ok(out.split("\n").length <= 20, `taller than the window at ${columns} columns\n${out}`);
    assert.match(out, /▸6 Plan/);
    assert.ok(out.includes("Plan (6 of 6)"));
    assert.ok(out.includes("q quit"));
  }
});

test("a short window scrolls the body and reports the visible lines", () => {
  const state = update(initialTuiState(), { type: "scroll", delta: 1, max: 1 });
  const out = frame(state, 100, 10);
  assert.match(out, /lines 2–4 of 4/);
  assert.match(out, /▸1 Inbox/, "too short for the side navigation, so the compact layout is used");
  assert.ok(out.split("\n").length <= 10, out);
});

test("linear rendering is plain text in reading order", () => {
  const text = renderLinear(buildScreen(update(initialTuiState(), { type: "select", section: "history" })));
  assert.doesNotMatch(text, /\x1b\[/, "no escape sequences");
  const lines = text.split("\n");
  assert.equal(lines[0], "== History (section 5 of 6) ==");
  assert.ok(lines.includes("Decision queue: ○ Nothing needs you"));
  assert.ok(lines.some((l) => l.startsWith("Sections: ") && l.includes("5 History (current)")));
});

test("text mode navigates by command and exits on quit", async () => {
  const input = new PassThrough();
  let output = "";
  const done = runTextMode(initialTuiState(), { input, write: (t) => (output += t) });
  input.end("3\nbogus\n\nnext\nhelp\nquit\n6\n");
  await done;
  assert.match(output, /== Inbox \(section 1 of 6\) ==/);
  assert.match(output, /== Companies \(section 3 of 6\) ==/);
  assert.match(output, /Unknown command: bogus/);
  assert.match(output, /== Portfolio \(section 4 of 6\) ==/);
  assert.match(output, /Commands:\n1-6 or a name +go to section/);
  assert.doesNotMatch(output, /== Plan/, "input after quit is ignored");
  assert.match(output, /Bye\.\n$/);
});

test("the launch command starts and exits cleanly without a terminal", () => {
  const run = spawnSync(process.execPath, ["src/tui/main.ts"], { cwd: ROOT, input: "2\nq\n", encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stderr, "");
  assert.match(run.stdout, /linear text mode/);
  assert.match(run.stdout, /== Discovery \(section 2 of 6\) ==/);

  const bad = spawnSync(process.execPath, ["src/tui/main.ts", "--bogus"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /usage: tui/);
});

function assertFits(out: string, columns: number): void {
  for (const line of out.split("\n")) {
    // Strip ANSI and count code points: every glyph the TUI uses is single-width.
    const visible = [...line.replace(/\x1b\[[0-9;]*m/g, "")].length;
    assert.ok(visible <= columns, `line wider than ${columns}: ${JSON.stringify(line)}`);
  }
}
