// Developer command: initialize a campaign, optionally submit commands, and print a
// read-only inspection. This is an adapter, not domain code: it reads input files and
// writes to the terminal, then delegates everything else to the application API.
//
//   node src/cli/campaign-init.ts --seed <seed> --scenario <file> [--config <file>]
//                                 [--commands <file>] [--view summary|player|debug] [--json]
//
// `--commands` reads a JSON list of command envelopes (e.g. End Week with a plan) and
// submits them in order, printing each plan review and the result or rejection reasons
// before the view. Nothing persists between runs beyond that file.
// `--view player` prints what the player knows (the same view the TUI reads);
// `--view debug` prints the full world, hidden state included (design §17.4).

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import {
  canonicalJson,
  formatBasisPoints,
  formatCentsAsUsd,
  formatManifestIssue,
  formatMetricValue,
  formatPeriod,
  formatSource,
  initializeCampaign,
  inspectCampaign,
  METRIC_LABELS,
  STATUS_LABELS,
  submitCommand,
  validateWeeklyPlan,
  viewAsPlayer,
  type Campaign,
  type CampaignSummary,
  type PlanReview,
  type SubmitResult,
  type PlayerObservation,
  type PlayerView,
} from "../app/campaign-app.ts";
import { viewForDebug, type DebugView } from "../app/debug.ts";

export const USAGE =
  "usage: campaign-init --seed <seed> --scenario <file.json> [--config <file.json>] [--commands <file.json>] [--view summary|player|debug] [--json]";

const VIEWS = ["summary", "player", "debug"] as const;
type View = (typeof VIEWS)[number];

export interface CliIo {
  readonly readFile: (path: string) => string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

/**
 * Returns the process exit code: 0, 1 when initialization fails or any command is
 * rejected, 2 for usage and file errors. Nothing is written to stdout unless
 * initialization succeeds.
 */
export function runCampaignInit(argv: readonly string[], io: CliIo): number {
  let values: { seed?: string; scenario?: string; config?: string; commands?: string; view?: string; json?: boolean };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        seed: { type: "string" },
        scenario: { type: "string" },
        config: { type: "string" },
        commands: { type: "string" },
        view: { type: "string" },
        json: { type: "boolean" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    io.stderr(`${(error as Error).message}\n${USAGE}\n`);
    return 2;
  }

  const problems: string[] = [];
  if (values.seed === undefined) problems.push("--seed is required");
  if (values.scenario === undefined) problems.push("--scenario is required");
  const view = (values.view ?? "summary") as View;
  if (!VIEWS.includes(view)) problems.push(`--view must be one of ${VIEWS.join(", ")}, got ${JSON.stringify(values.view)}`);
  const scenario = values.scenario === undefined ? undefined : readJson(values.scenario, "scenario", io, problems);
  const config = values.config === undefined ? undefined : readJson(values.config, "config", io, problems);
  const commands = values.commands === undefined ? [] : readJson(values.commands, "commands", io, problems);
  if (values.commands !== undefined && commands !== undefined && !Array.isArray(commands)) {
    problems.push(`--commands ${values.commands}: must be a JSON list of commands`);
  }
  if (problems.length > 0) {
    io.stderr(`${problems.join("\n")}\n${USAGE}\n`);
    return 2;
  }

  const result = initializeCampaign({ seed: values.seed, scenario, config });
  if (!result.ok) {
    io.stderr(`Campaign not initialized:\n${result.issues.map((issue) => `  ${formatManifestIssue(issue)}`).join("\n")}\n`);
    return 1;
  }

  const json = values.json === true;
  let campaign = result.campaign;
  const log: CommandLogEntry[] = [];
  for (const envelope of (commands ?? []) as unknown[]) {
    const review = planReview(campaign, envelope);
    const submitted = submitCommand(campaign, envelope);
    if (submitted.ok) campaign = submitted.campaign;
    log.push({ envelope, review, submitted, after: inspectCampaign(campaign) });
  }
  const rejected = log.some((entry) => !entry.submitted.ok);

  if (json) {
    const shown =
      view === "player" ? viewAsPlayer(campaign) : view === "debug" ? viewForDebug(campaign) : { summary: inspectCampaign(campaign), manifest: campaign.manifest };
    io.stdout(`${canonicalJson(values.commands === undefined ? shown : { commands: log.map(commandJson), view: shown })}\n`);
    return rejected ? 1 : 0;
  }

  const sections = log.map(formatCommand);
  if (view === "player") {
    sections.push(formatPlayerView(viewAsPlayer(campaign)));
  } else if (view === "debug") {
    sections.push(formatDebugView(viewForDebug(campaign)));
  } else {
    sections.push(`${formatSummary(inspectCampaign(campaign))}\n\nManifest:\n${JSON.stringify(JSON.parse(canonicalJson(campaign.manifest)), null, 2)}`);
  }
  io.stdout(`${sections.join("\n\n")}\n`);
  return rejected ? 1 : 0;
}

interface CommandLogEntry {
  readonly envelope: unknown;
  /** The plan review shown before submitting End Week, when its plan is valid. */
  readonly review: PlanReview | undefined;
  readonly submitted: SubmitResult;
  /** The campaign after the command, accepted or not. */
  readonly after: CampaignSummary;
}

/** The review the player would see before End Week: only for an endWeek envelope with a valid plan. */
function planReview(campaign: Campaign, envelope: unknown): PlanReview | undefined {
  if (typeof envelope !== "object" || envelope === null) return undefined;
  const { type, args } = envelope as { type?: unknown; args?: unknown };
  if (type !== "endWeek") return undefined;
  const validation = validateWeeklyPlan(campaign, args);
  return validation.ok ? validation.review : undefined;
}

function commandJson(entry: CommandLogEntry): unknown {
  const { submitted, after } = entry;
  return {
    ...(entry.review === undefined ? {} : { review: entry.review }),
    ...(submitted.ok ? { record: submitted.record, repeated: submitted.repeated } : { rejection: submitted.rejection }),
    revision: after.revision,
    stateHash: after.stateHash,
  };
}

/** One submitted command: what it was, the plan review, and what happened. */
export function formatCommand(entry: CommandLogEntry, index: number): string {
  const { envelope, review, submitted, after } = entry;
  const fields = typeof envelope === "object" && envelope !== null ? (envelope as Record<string, unknown>) : {};
  const lines = [
    `Command ${index + 1}: ${shown(fields["commandId"], "(no id)")} · ${shown(fields["type"], "(no type)")} · expected revision ${shown(fields["expectedRevision"], "?")}`,
  ];
  if (review !== undefined) lines.push(...formatPlanReview(review).map((line) => `  ${line}`));
  if (!submitted.ok) {
    lines.push(`  ✖ Rejected (${submitted.rejection.code}):`, ...submitted.rejection.reasons.map((r) => `    ${r}`));
    lines.push(`  Nothing changed: revision ${after.revision} · planning week ${after.planningWeek} · state ${after.stateHash}`);
  } else if (submitted.repeated) {
    lines.push(`  ↺ Already accepted as command #${submitted.record.sequence}; the earlier result is returned and nothing is spent again`);
    lines.push(`  Revision ${after.revision} · planning week ${after.planningWeek} · state ${after.stateHash}`);
  } else {
    const delivered = (submitted.record.result as { delivered?: unknown } | undefined)?.delivered;
    const count = Array.isArray(delivered) ? delivered.length : 0;
    lines.push(
      `  ✔ Accepted as command #${submitted.record.sequence}: now planning week ${after.planningWeek}; ${count} ${count === 1 ? "observation" : "observations"} delivered`,
      `  Revision ${after.revision} · state ${after.stateHash}`,
    );
  }
  return lines.join("\n");
}

/**
 * A field of an envelope as read from the file, which may be any JSON value: strings
 * with control characters escaped, numbers as they are, anything else as JSON. Never throws, so a malformed command
 * still gets its rejection report.
 */
function shown(value: unknown, missing: string): string {
  if (value === undefined) return missing;
  // Escaped, so a newline in a field cannot start a line that looks like part of the report.
  if (typeof value === "string") return JSON.stringify(value).slice(1, -1);
  if (typeof value === "number") return String(value);
  try {
    return JSON.stringify(value) ?? missing;
  } catch {
    return "(unreadable)";
  }
}

/** The one review before End Week (§6.1): actions, slot costs, slots left and unanswered deadlines. */
export function formatPlanReview(review: PlanReview): string[] {
  const lines = [`Plan for week ${review.week}: ${review.slotsUsed} of ${review.slotsAvailable} slots, ${review.slotsLeft} left`];
  if (review.actions.length === 0) lines.push("  (no actions: the week passes)");
  review.actions.forEach((a, i) => {
    lines.push(`  ${i + 1}. ${a.title} · ${a.companyName} · ${a.question} · ${a.slotCost} slot · result readable in week ${a.resultReadableWeek}`);
  });
  lines.push(`Unanswered deadlines: ${review.unansweredDeadlines.length === 0 ? "none" : review.unansweredDeadlines.join("; ")}`);
  return lines;
}

export function formatSummary(s: CampaignSummary): string {
  const rows: Array<[string, string]> = [
    ["Campaign", s.campaignId],
    ["Seed", s.seed],
    ["Scenario", s.scenarioId],
    ["Config", `${s.configId} v${s.configVersion}`],
    ["Week", `planning week ${s.planningWeek}; ${s.completedWeeks} of ${s.horizonWeeks} completed`],
    ["Window", s.investmentWindowOpen ? "initial investments open" : "initial investments closed"],
    ["Slots", `${s.slotsAvailable} available`],
    ["Capital", `${formatCentsAsUsd(s.capitalAvailableCents)} available`],
    ["Invested", `${s.initialInvestmentsMade} of ${s.maxInitialInvestments} initial checks of ${formatCentsAsUsd(s.checkSizeCents)}`],
    ["Portfolio", s.portfolioSize === 0 ? "empty" : `${s.portfolioSize} companies`],
    ["Companies", `${s.knownCompanies} known`],
    ["Revision", `${s.revision} (accepted commands)`],
    ["State", s.stateHash],
  ];
  return rows.map(([label, value]) => `${label.padEnd(10)} ${value}`).join("\n");
}

/** What the player knows, as they would read it. Built only from `viewAsPlayer`. */
export function formatPlayerView(view: PlayerView): string {
  const lines = [
    `Player view: what you know in planning week ${view.planningWeek}`,
    `${view.companies.length} known ${view.companies.length === 1 ? "company" : "companies"}`,
  ];
  view.companies.forEach((company, index) => {
    const profile = company.profile;
    const names = new Map(profile?.founders.map((f) => [f.founderId, f.name]));
    lines.push("", `${index + 1}. ${profile?.name ?? "(name unknown)"} (${company.companyId})`);
    if (profile !== undefined) {
      lines.push(
        `   Sector     ${profile.sector} · ${profile.businessModel}`,
        `   About      ${profile.description}`,
        `   Founders   ${profile.founders.map((f) => `${f.name} (${f.specialization})`).join(", ")}`,
      );
    }
    lines.push(
      `   You        decision ${company.decision} · contact ${company.contact} · opportunity ${company.opportunity}`,
      "   Evidence",
    );
    for (const o of company.observations) lines.push(...formatObservation(o, names));
  });
  return lines.join("\n");
}

function formatObservation(o: PlayerObservation, names: ReadonlyMap<string, string>): string[] {
  const meta = `received week ${o.receivedWeek} from ${formatSource(o.source, names)} · ${formatPeriod(o.period)} · ${STATUS_LABELS[o.status]}`;
  if (o.content.kind === "metric") {
    return [`   · ${METRIC_LABELS[o.content.metric]}: ${formatMetricValue(o.content.metric, o.content.value)}`, `       ${meta}`];
  }
  return [`   · ${o.content.title}`, `       ${meta}`, `       ${o.content.text}`];
}

/** Developer-only: the whole world, hidden state and provenance included. */
export function formatDebugView(view: DebugView): string {
  const lines = [
    "DEBUG VIEW (developer only, design §17.4): hidden state, provenance and unknown companies",
    `Planning week ${view.planningWeek} · ${view.companies.length} companies in the world`,
  ];
  for (const { state, profile, trueMetrics, observations } of view.companies) {
    const h = profile.hidden;
    const dimensions = `knowledge ${state.knowledge} · decision ${state.decision} · contact ${state.contact} · opportunity ${state.opportunity} · lifecycle ${state.lifecycle}`;
    lines.push(
      "",
      `${profile.id}  ${profile.name} · ${profile.sector} · starts ${profile.initialKnowledge}`,
      `  State      ${dimensions}`,
      `  Hidden     cash ${formatCentsAsUsd(h.cashCents)} · price ${formatCentsAsUsd(h.weeklyPriceCents)}/week · ${h.payingCustomers} paying customers · largest ${formatBasisPoints(h.largestCustomerShareBps)} · ${h.baseWeeklyLeads} leads/week · fit ${h.productFit}/100 · strategy ${h.strategy}`,
      `  Money      revenue ${formatMetricValue("weeklyRevenueCents", trueMetrics.weeklyRevenueCents)} · costs ${formatMetricValue("weeklyBurnCents", trueMetrics.weeklyBurnCents)} (other ${formatCentsAsUsd(h.otherWeeklyCostsCents)}/week)`,
      `  Team       ${h.team.map((t) => `${t.specialization} ×${t.headcount} ${formatCentsAsUsd(t.weeklyCostCents)}/week at ${formatBasisPoints(t.productivityBps)}`).join("; ")}`,
      `  Founders   ${profile.founders.map((f) => `${f.name} [${f.id}] ${f.specialization}`).join(", ")} · alignment ${formatBasisPoints(h.founderAlignmentBps)}`,
      ...h.unresolvedConflicts.map((c) => `  Conflict   ${c.id} (${c.founderIds.join(", ")}): ${c.topic}`),
      ...(profile.authoringNote === undefined ? [] : [`  Note       ${profile.authoringNote}`]),
    );
    if (observations.length === 0) {
      lines.push("  Evidence   none delivered");
    }
    for (const { observation: o, provenance, status } of observations) {
      const said = o.content.kind === "metric" ? `${METRIC_LABELS[o.content.metric]} ${formatMetricValue(o.content.metric, o.content.value)}` : `text: ${o.content.title}`;
      const truth =
        o.content.kind !== "metric" || provenance?.fact === undefined
          ? ""
          : provenance.distortion === undefined
            ? " · matches the truth"
            : ` · truth ${formatMetricValue(o.content.metric, provenance.fact.value)} · ${provenance.distortion.reason}: ${provenance.distortion.note}`;
      lines.push(`  Evidence   ${o.observationId}: ${said}${truth} · shown as ${STATUS_LABELS[status]}`);
    }
  }
  return lines.join("\n");
}

function readJson(path: string, label: string, io: CliIo, problems: string[]): unknown {
  let text: string;
  try {
    text = io.readFile(path);
  } catch (error) {
    problems.push(`--${label} ${path}: cannot read file (${(error as NodeJS.ErrnoException).code ?? (error as Error).message})`);
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    problems.push(`--${label} ${path}: invalid JSON (${(error as Error).message})`);
    return undefined;
  }
}

if (import.meta.main) {
  process.exitCode = runCampaignInit(process.argv.slice(2), {
    readFile: (path) => readFileSync(path, "utf8"),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
}
