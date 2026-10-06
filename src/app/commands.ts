// State-changing commands (docs/design-doc.md §17.2 `commands`, §17.3, §18). Every
// adapter (the TUI now, MCP later) changes a campaign only through `submitCommand`, so
// they cannot diverge in how a change is checked, applied or recorded.
//
// An envelope carries an idempotent `commandId`, the `expectedRevision` the client read,
// a command `type` and its arguments. Checks run in this order:
// 1. the envelope's own shape;
// 2. a known `commandId`: the same type and arguments return the earlier result and
//    change nothing; anything else is rejected;
// 3. a stale `expectedRevision` is rejected without cost;
// 4. the handler normalizes the arguments and applies them to a whole new state, or
//    rejects with player-visible reasons.
// Only an accepted command increases the revision and appends one journal entry, whose
// sequence is monotonic. A rejection returns the campaign untouched: there is no
// partial change to undo.

import { deepFreeze, snapshotPlainData } from "../data/plain-data.ts";
import { canonicalHash, canonicalJson } from "../manifest/canonical-json.ts";
import type { CampaignState } from "../campaign/initial-state.ts";
import type { Campaign } from "./campaign-app.ts";

/** What a client submits. Untrusted until checked. */
export interface CommandEnvelope {
  readonly commandId: string;
  readonly expectedRevision: number;
  readonly type: string;
  readonly args: unknown;
}

/** One accepted command, as kept in the campaign's journal. Plain JSON data. */
export interface CommandRecord {
  /** 1 for the first accepted command, then +1 for each one after it. */
  readonly sequence: number;
  readonly commandId: string;
  readonly type: string;
  /** The arguments after normalization; the idempotency check compares these. */
  readonly args: unknown;
  readonly result: unknown;
  /** `canonicalHash` of the campaign state after the command. */
  readonly stateHash: string;
}

export const REJECTION_CODES = [
  "invalid-envelope",
  "unknown-command",
  "conflicting-command-id",
  "stale-revision",
  "invalid-arguments",
  "rejected",
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

export interface CommandRejection {
  readonly code: RejectionCode;
  /** Player-visible reasons; never derived from hidden state. */
  readonly reasons: readonly string[];
}

export type SubmitResult =
  | {
      readonly ok: true;
      readonly campaign: Campaign;
      readonly record: CommandRecord;
      /** True when `commandId` was already accepted: `campaign` is the one passed in. */
      readonly repeated: boolean;
    }
  | { readonly ok: false; readonly rejection: CommandRejection };

export type HandlerOutcome =
  | { readonly ok: true; readonly state: CampaignState; readonly result: unknown }
  | { readonly ok: false; readonly reasons: readonly string[] };

/**
 * One command type. Both functions are pure: `normalize` turns untrusted arguments into
 * plain data (or reasons), and `apply` derives a whole new state from the campaign as
 * it is, or rejects.
 */
export interface CommandHandler {
  readonly normalize: (args: unknown) => { readonly ok: true; readonly args: unknown } | { readonly ok: false; readonly reasons: readonly string[] };
  readonly apply: (campaign: Campaign, args: unknown) => HandlerOutcome;
}

export type CommandHandlers = Readonly<Record<string, CommandHandler>>;

/** The game's command types. End Week arrives in VI-32. */
export const COMMAND_HANDLERS: CommandHandlers = Object.freeze({});

const COMMAND_ID_PATTERN = /^[\x21-\x7e]{1,128}$/;
const ENVELOPE_KEYS = ["commandId", "expectedRevision", "type", "args"];

/**
 * Submits one command. `handlers` defaults to the game's command types; tests pass
 * their own. Pure: the campaign passed in is never changed.
 */
export function submitCommand(campaign: Campaign, envelope: unknown, handlers: CommandHandlers = COMMAND_HANDLERS): SubmitResult {
  const checked = checkEnvelope(envelope, handlers);
  if (!checked.ok) return checked;
  const { commandId, expectedRevision, type, handler, args } = checked;

  const normalized = handler.normalize(args);
  const earlier = campaign.journal.find((r) => r.commandId === commandId);
  if (earlier !== undefined) {
    const same = earlier.type === type && normalized.ok && canonicalJson(normalized.args) === canonicalJson(earlier.args);
    return same
      ? { ok: true, campaign, record: earlier, repeated: true }
      : reject("conflicting-command-id", `command ${commandId} was already accepted with different arguments; use a new command id`);
  }
  if (expectedRevision !== campaign.revision) {
    return reject(
      "stale-revision",
      `the campaign is at revision ${campaign.revision}, not ${expectedRevision}; read the campaign again and resubmit`,
    );
  }
  if (!normalized.ok) return { ok: false, rejection: { code: "invalid-arguments", reasons: normalized.reasons } };

  const outcome = handler.apply(campaign, normalized.args);
  if (!outcome.ok) return { ok: false, rejection: { code: "rejected", reasons: outcome.reasons } };

  const record: CommandRecord = deepFreeze(
    JSON.parse(
      canonicalJson({
        sequence: campaign.journal.length + 1,
        commandId,
        type,
        args: normalized.args,
        result: outcome.result,
        stateHash: canonicalHash(outcome.state),
      }),
    ) as CommandRecord,
  );
  const next: Campaign = Object.freeze({
    ...campaign,
    state: outcome.state,
    revision: campaign.revision + 1,
    journal: Object.freeze([...campaign.journal, record]),
  });
  return { ok: true, campaign: next, record, repeated: false };
}

type CheckedEnvelope =
  | {
      readonly ok: true;
      readonly commandId: string;
      readonly expectedRevision: number;
      readonly type: string;
      readonly handler: CommandHandler;
      readonly args: unknown;
    }
  | { readonly ok: false; readonly rejection: CommandRejection };

function checkEnvelope(envelope: unknown, handlers: CommandHandlers): CheckedEnvelope {
  // Read once into a private copy, so a getter cannot answer differently later.
  const snapshot = snapshotPlainData(envelope, "command");
  if (snapshot.issues.length > 0) {
    return { ok: false, rejection: { code: "invalid-envelope", reasons: snapshot.issues.map((i) => `${i.path}: ${i.message}`) } };
  }
  const value = snapshot.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return reject("invalid-envelope", "command: must be an object with commandId, expectedRevision, type and args");
  }
  const record = value as Record<string, unknown>;
  const reasons: string[] = [];
  for (const key of Object.keys(record)) {
    if (!ENVELOPE_KEYS.includes(key)) reasons.push(`command.${key}: is not a known field`);
  }
  const { commandId, expectedRevision, type } = record;
  if (typeof commandId !== "string" || !COMMAND_ID_PATTERN.test(commandId)) {
    reasons.push("command.commandId: must be 1-128 printable ASCII characters without spaces");
  }
  if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    reasons.push("command.expectedRevision: must be a non-negative integer");
  }
  if (typeof type !== "string") reasons.push("command.type: must be a command type");
  if (reasons.length > 0) return { ok: false, rejection: { code: "invalid-envelope", reasons } };

  const handler = Object.hasOwn(handlers, type as string) ? handlers[type as string] : undefined;
  if (handler === undefined) {
    const known = Object.keys(handlers);
    return reject("unknown-command", `unknown command type ${JSON.stringify(type)}${known.length === 0 ? "" : `; known: ${known.join(", ")}`}`);
  }
  return {
    ok: true,
    commandId: commandId as string,
    expectedRevision: expectedRevision as number,
    type: type as string,
    handler,
    args: record["args"],
  };
}

function reject(code: RejectionCode, reason: string): { readonly ok: false; readonly rejection: CommandRejection } {
  return { ok: false, rejection: { code, reasons: [reason] } };
}
