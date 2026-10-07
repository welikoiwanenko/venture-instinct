// VI-28: one command entry point with idempotent ids, a campaign revision and a journal
// (docs/design-doc.md §17.2, §17.3, §18). The game has no command yet, so these tests
// use a trivial "add-note" type that only exists here.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  canonicalJson,
  initializeCampaign,
  inspectCampaign,
  searchKnownCompanies,
  submitCommand,
  viewAsPlayer,
  type Campaign,
  type SubmitResult,
} from "../src/app/campaign-app.ts";
import { COMMAND_HANDLERS, type CommandHandlers } from "../src/app/commands.ts";
import { viewForDebug } from "../src/app/debug.ts";

const PACK_PATH = "content/scenarios/gamma-three-companies.json";

function campaign(): Campaign {
  const scenario = JSON.parse(readFileSync(new URL(`../${PACK_PATH}`, import.meta.url), "utf8")) as unknown;
  const result = initializeCampaign({ seed: "demo-1", scenario });
  assert.ok(result.ok);
  return result.campaign;
}

/**
 * Test-only command: spends one slot and returns the note. A note of "reject" is a
 * rule violation, so rejections can be tested too.
 */
const TEST_HANDLERS: CommandHandlers = {
  "add-note": {
    normalize: (args) => {
      const note = (args as { note?: unknown } | undefined)?.note;
      return typeof note === "string" && note.trim() !== ""
        ? { ok: true, args: { note: note.trim() } }
        : { ok: false, reasons: ["args.note: must be a non-empty string"] };
    },
    apply: (c, args) => {
      const { note } = args as { note: string };
      if (note === "reject") return { ok: false, reasons: ["this note is not allowed"] };
      if (c.state.slots.remaining === 0) return { ok: false, reasons: ["no slots left"] };
      return {
        ok: true,
        state: Object.freeze({ ...c.state, slots: Object.freeze({ ...c.state.slots, remaining: c.state.slots.remaining - 1 }) }),
        result: { note, slotsLeft: c.state.slots.remaining - 1 },
      };
    },
  },
};

function submit(c: Campaign, envelope: unknown): SubmitResult {
  return submitCommand(c, envelope, TEST_HANDLERS);
}

function accepted(result: SubmitResult): Extract<SubmitResult, { ok: true }> {
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.rejection));
  return result;
}

function rejected(result: SubmitResult): Extract<SubmitResult, { ok: false }> {
  assert.equal(result.ok, false, "expected a rejection");
  return result as Extract<SubmitResult, { ok: false }>;
}

const note = (commandId: string, expectedRevision: number, text = "hello") => ({
  commandId,
  expectedRevision,
  type: "add-note",
  args: { note: text },
});

test("a new campaign is at revision 0 with an empty journal", () => {
  const c = campaign();
  assert.equal(c.revision, 0);
  assert.deepEqual(c.journal, []);
  assert.equal(inspectCampaign(c).revision, 0);
});

test("an accepted command returns a new campaign, increments the revision and journals the command", () => {
  const before = campaign();
  const first = accepted(submit(before, note("c-1", 0, "  hello  ")));
  assert.equal(first.repeated, false);
  assert.equal(first.campaign.revision, 1);
  assert.equal(first.campaign.state.slots.remaining, 4);
  assert.deepEqual(first.campaign.journal, [
    {
      sequence: 1,
      commandId: "c-1",
      type: "add-note",
      args: { note: "hello" },
      result: { note: "hello", slotsLeft: 4 },
      stateHash: inspectCampaign(first.campaign).stateHash,
    },
  ]);
  assert.equal(first.record, first.campaign.journal[0]);
  assert.ok(Object.isFrozen(first.record) && Object.isFrozen(first.campaign.journal));
  // The campaign passed in is untouched.
  assert.equal(before.revision, 0);
  assert.equal(before.state.slots.remaining, 5);
  assert.deepEqual(before.journal, []);

  const second = accepted(submit(first.campaign, note("c-2", 1, "again")));
  assert.deepEqual(
    second.campaign.journal.map((r) => [r.sequence, r.commandId]),
    [
      [1, "c-1"],
      [2, "c-2"],
    ],
  );
  assert.equal(inspectCampaign(second.campaign).revision, 2);
});

test("repeating a command id with the same arguments returns the earlier result and changes nothing", () => {
  const first = accepted(submit(campaign(), note("c-1", 0)));
  // A retry still carries the revision it was first sent with, and normalizes the same.
  const again = accepted(submit(first.campaign, note("c-1", 0, "hello ")));
  assert.equal(again.repeated, true);
  assert.equal(again.campaign, first.campaign);
  assert.equal(again.record, first.record);
  assert.equal(again.campaign.state.slots.remaining, 4, "no second spend");
  assert.equal(again.campaign.journal.length, 1, "no second journal entry");
  assert.equal(again.campaign.revision, 1);
});

test("reusing a command id with different arguments or another type is rejected", () => {
  const first = accepted(submit(campaign(), note("c-1", 0)));
  const other = rejected(submit(first.campaign, note("c-1", 1, "different")));
  assert.equal(other.rejection.code, "conflicting-command-id");
  assert.match(other.rejection.reasons[0] ?? "", /already accepted with different arguments/);
  const handlers: CommandHandlers = { ...TEST_HANDLERS, "other-note": TEST_HANDLERS["add-note"]! };
  const otherType = submitCommand(first.campaign, { ...note("c-1", 1), type: "other-note" }, handlers);
  assert.equal(rejected(otherType).rejection.code, "conflicting-command-id");
});

test("a stale expected revision is rejected with no cost and no state change", () => {
  const first = accepted(submit(campaign(), note("c-1", 0)));
  for (const revision of [0, 2]) {
    const stale = rejected(submit(first.campaign, note("c-2", revision)));
    assert.equal(stale.rejection.code, "stale-revision");
    assert.match(stale.rejection.reasons[0] ?? "", new RegExp(`revision 1, not ${revision}`));
  }
  assert.equal(first.campaign.state.slots.remaining, 4);
  assert.equal(first.campaign.journal.length, 1);
});

test("a rejected command never increments the revision or the sequence", () => {
  const start = accepted(submit(campaign(), note("c-1", 0))).campaign;
  const hash = inspectCampaign(start).stateHash;
  const attempts: Array<[unknown, string]> = [
    [note("c-2", 1, "reject"), "rejected"],
    [{ ...note("c-2", 1), args: { note: "" } }, "invalid-arguments"],
    [{ ...note("c-2", 1), type: "teleport" }, "unknown-command"],
    [{ ...note("c-2", 1), extra: true }, "invalid-envelope"],
    [{ ...note("c 2", 1) }, "invalid-envelope"],
    [{ ...note("c-2", -1) }, "invalid-envelope"],
    [{ ...note("c-2", 1.5) }, "invalid-envelope"],
    ["end week", "invalid-envelope"],
    [null, "invalid-envelope"],
  ];
  for (const [envelope, code] of attempts) {
    const result = rejected(submit(start, envelope));
    assert.equal(result.rejection.code, code, JSON.stringify(envelope));
    assert.ok(result.rejection.reasons.length > 0);
  }
  // A command id from a rejected attempt is still free.
  const next = accepted(submit(start, note("c-2", 1)));
  assert.equal(next.record.sequence, 2);
  assert.equal(next.campaign.revision, 2);
  assert.equal(inspectCampaign(start).stateHash, hash);
});

test("an envelope with a getter is rejected without calling it", () => {
  let calls = 0;
  const envelope = {
    commandId: "c-1",
    expectedRevision: 0,
    type: "add-note",
    get args() {
      calls += 1;
      return { note: "hello" };
    },
  };
  assert.equal(rejected(submit(campaign(), envelope)).rejection.code, "invalid-envelope");
  assert.equal(calls, 0);
});

test("an envelope with another prototype is rejected without calling its inherited getters", () => {
  let calls = 0;
  const envelope = Object.create({
    get commandId() {
      calls += 1;
      throw new Error("getter executed");
    },
  }) as Record<string, unknown>;
  Object.assign(envelope, { expectedRevision: 0, type: "add-note", args: { note: "hello" } });
  const result = rejected(submit(campaign(), envelope));
  assert.equal(result.rejection.code, "invalid-envelope");
  assert.match(result.rejection.reasons[0] ?? "", /must be a plain object/);
  assert.equal(calls, 0);
  assert.equal(rejected(submit(campaign(), new Date())).rejection.code, "invalid-envelope");
});

test("an accepted state is frozen whole, even when the handler returned a mutable one", () => {
  const handlers: CommandHandlers = {
    "add-note": {
      normalize: (args) => ({ ok: true, args }),
      apply: (c) => ({ ok: true, state: { ...c.state, slots: { ...c.state.slots, remaining: 3 } }, result: null }),
    },
  };
  const next = accepted(submitCommand(campaign(), note("c-1", 0), handlers)).campaign;
  assert.ok(Object.isFrozen(next.state) && Object.isFrozen(next.state.slots));
  assert.throws(() => {
    (next.state.slots as { remaining: number }).remaining = 5;
  }, TypeError);
});

test("read-only API calls never change the revision or the state hash", () => {
  const c = accepted(submit(campaign(), note("c-1", 0))).campaign;
  const before = canonicalJson({ state: c.state, revision: c.revision, journal: c.journal });
  inspectCampaign(c);
  viewAsPlayer(c);
  viewForDebug(c);
  searchKnownCompanies(c, "CI");
  assert.equal(canonicalJson({ state: c.state, revision: c.revision, journal: c.journal }), before);
  assert.equal(inspectCampaign(c).revision, 1);
});

test("the game has no command types until End Week", () => {
  const result = rejected(submitCommand(campaign(), note("c-1", 0)));
  assert.equal(result.rejection.code, "unknown-command");
  assert.deepEqual(Object.keys(COMMAND_HANDLERS), []);
});
