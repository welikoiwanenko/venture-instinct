// The player knowledge view (docs/design-doc.md §9.1, §15, §17.1, §17.4): the one read
// path that shows a player what they have legitimately learned. TUI and Playtest MCP
// adapters build on it. It is assembled field by field from an allow-list:
// - public profile fields of companies the player has identified,
// - the player's own dimensions (knowledge, decision, contact, opportunity),
// - the player-facing half of delivered observations, with a status computed from them.
// Hidden state, provenance, authoring notes and the world-side lifecycle are never read
// into it, and a company the player does not know is absent, not even counted.
//
// Pure: building the view changes nothing and draws no randomness.

import type { CampaignState } from "../campaign/initial-state.ts";
import type { Contact, Decision, Knowledge, Opportunity } from "../campaign/company-dimensions.ts";
import type { BusinessModel, CompanyProfile, Sector, Specialization } from "../content/company-profile.ts";
import { deepFreeze } from "../data/plain-data.ts";
import type { Observation } from "./observation.ts";
import { verificationStatus, type VerificationStatus } from "./verification.ts";

export interface PlayerFounder {
  readonly founderId: string;
  readonly name: string;
  readonly specialization: Specialization;
}

/** Public profile fields; present once the player has identified the company. */
export interface PlayerCompanyProfile {
  readonly name: string;
  readonly sector: Sector;
  readonly businessModel: BusinessModel;
  readonly description: string;
  readonly founders: readonly PlayerFounder[];
}

export interface PlayerObservation extends Observation {
  readonly status: VerificationStatus;
}

export interface PlayerCompany {
  readonly companyId: string;
  readonly knowledge: Exclude<Knowledge, "unknown">;
  readonly decision: Decision;
  readonly contact: Contact;
  readonly opportunity: Opportunity;
  /** Absent while the company is only a signal. */
  readonly profile?: PlayerCompanyProfile;
  /** Delivered observations about this company, oldest first. */
  readonly observations: readonly PlayerObservation[];
}

export interface PlayerView {
  readonly campaignId: string;
  readonly planningWeek: number;
  /** Known companies only, in the pack's stable order. */
  readonly companies: readonly PlayerCompany[];
}

export interface PlayerViewSource {
  readonly campaignId: string;
  readonly state: CampaignState;
  readonly profiles: readonly CompanyProfile[];
}

export function buildPlayerView({ campaignId, state, profiles }: PlayerViewSource): PlayerView {
  const delivered = state.observations.observations;
  const companies: PlayerCompany[] = [];
  for (const company of state.companies) {
    const { knowledge } = company;
    if (knowledge === "unknown") continue;
    const profile = profiles.find((p) => p.id === company.companyId);
    const observations = delivered
      .filter((o) => o.companyId === company.companyId)
      .map((o) => playerObservation(o, delivered, state.planningWeek));
    companies.push({
      companyId: company.companyId,
      knowledge,
      decision: company.decision,
      contact: company.contact,
      opportunity: company.opportunity,
      ...(knowledge === "identified" && profile !== undefined ? { profile: publicProfile(profile) } : {}),
      observations,
    });
  }
  return deepFreeze({ campaignId, planningWeek: state.planningWeek, companies });
}

/** Case-insensitive search over what the player can read: names, descriptions, founders and texts. */
export function searchPlayerView(view: PlayerView, query: string): readonly PlayerCompany[] {
  const needle = query.trim().toLocaleLowerCase("uk");
  if (needle === "") return [];
  return view.companies.filter((company) => {
    const texts = [
      company.companyId,
      company.profile?.name,
      company.profile?.description,
      ...(company.profile?.founders.map((f) => f.name) ?? []),
      ...company.observations.flatMap((o) => (o.content.kind === "text" ? [o.content.title, o.content.text] : [])),
    ];
    return texts.some((text) => text !== undefined && text.toLocaleLowerCase("uk").includes(needle));
  });
}

function publicProfile(profile: CompanyProfile): PlayerCompanyProfile {
  return {
    name: profile.name,
    sector: profile.sector,
    businessModel: profile.businessModel,
    description: profile.description,
    founders: profile.founders.map((f) => ({ founderId: f.id, name: f.name, specialization: f.specialization })),
  };
}

/** Copies the player-facing fields explicitly, so a field added to the log later stays out until listed here. */
function playerObservation(o: Observation, delivered: readonly Observation[], week: number): PlayerObservation {
  return {
    observationId: o.observationId,
    companyId: o.companyId,
    source: { kind: o.source.kind, author: o.source.author },
    receivedWeek: o.receivedWeek,
    period: { fromWeek: o.period.fromWeek, toWeek: o.period.toWeek },
    content:
      o.content.kind === "metric"
        ? { kind: "metric", metric: o.content.metric, value: o.content.value }
        : { kind: "text", title: o.content.title, text: o.content.text },
    references: [...o.references],
    status: verificationStatus(o, delivered, week),
  };
}
