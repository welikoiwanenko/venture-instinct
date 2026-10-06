// Developer command: initialize a campaign and print a read-only inspection.
// This is an adapter, not domain code: it reads input files and writes to the
// terminal, then delegates everything else to the application API.
//
//   node src/cli/campaign-init.ts --seed <seed> --scenario <file> [--config <file>]
//                                 [--view summary|player|debug] [--json]
//
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
  viewAsPlayer,
  type CampaignSummary,
  type PlayerObservation,
  type PlayerView,
} from "../app/campaign-app.ts";
import { viewForDebug, type DebugView } from "../app/debug.ts";

export const USAGE =
  "usage: campaign-init --seed <seed> --scenario <file.json> [--config <file.json>] [--view summary|player|debug] [--json]";

const VIEWS = ["summary", "player", "debug"] as const;
type View = (typeof VIEWS)[number];

export interface CliIo {
  readonly readFile: (path: string) => string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

/** Returns the process exit code. Nothing is written to stdout unless initialization succeeds. */
export function runCampaignInit(argv: readonly string[], io: CliIo): number {
  let values: { seed?: string; scenario?: string; config?: string; view?: string; json?: boolean };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        seed: { type: "string" },
        scenario: { type: "string" },
        config: { type: "string" },
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
  if (problems.length > 0) {
    io.stderr(`${problems.join("\n")}\n${USAGE}\n`);
    return 2;
  }

  const result = initializeCampaign({ seed: values.seed, scenario, config });
  if (!result.ok) {
    io.stderr(`Campaign not initialized:\n${result.issues.map((issue) => `  ${formatManifestIssue(issue)}`).join("\n")}\n`);
    return 1;
  }

  const { campaign } = result;
  const json = values.json === true;
  if (view === "player") {
    const player = viewAsPlayer(campaign);
    io.stdout(`${json ? canonicalJson(player) : formatPlayerView(player)}\n`);
  } else if (view === "debug") {
    const debug = viewForDebug(campaign);
    io.stdout(`${json ? canonicalJson(debug) : formatDebugView(debug)}\n`);
  } else {
    const summary = inspectCampaign(campaign);
    const { manifest } = campaign;
    io.stdout(
      json
        ? `${canonicalJson({ summary, manifest })}\n`
        : `${formatSummary(summary)}\n\nManifest:\n${JSON.stringify(JSON.parse(canonicalJson(manifest)), null, 2)}\n`,
    );
  }
  return 0;
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
