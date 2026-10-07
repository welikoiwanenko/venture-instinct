// Completing research (docs/design-doc.md §6.2 phase 3, §9.1, §9.2). A research action
// reads the state of the world through its authored check and becomes one observation
// with source kind `check`, received at the end of the week it ran. The id is derived
// from the check (unique in the pack, so it also names the company) and the week,
// never from order or time, so the same plan always delivers the same ids. A figure's provenance carries the true value from the hidden
// state and the authored distortion reason, if any.
//
// The world does not change between weeks until Zeta, so the truth is the hidden
// starting state, which is what the pack validation measured the check against.

import type { CompanyProfile } from "../content/company-profile.ts";
import type { ResearchCheck } from "../content/research-check.ts";
import { trueMetricValue } from "../knowledge/facts.ts";
import type { Week } from "./week.ts";

/** Title of a "could not get the data" result; the reason is its text. Player-facing language. */
export const UNAVAILABLE_TITLE = "Не вдалося отримати дані";

/**
 * Check ids are unique across the pack (src/content/scenario-pack.ts), so a check id
 * names its company too. Joining company and check ids would be ambiguous, since both
 * contain dashes ("co-a" + "b-c" and "co-a-b" + "c"); the check id with a fixed
 * "-week-<n>" suffix is not.
 */
export function researchObservationId(checkId: string, week: Week): string {
  return `obs-${checkId}-week-${week}`;
}

/** The observation entry (player-facing half and provenance) a completed check delivers. */
export function researchEntry(
  profile: CompanyProfile,
  check: ResearchCheck,
  week: Week,
): { readonly observation: unknown; readonly provenance: unknown } {
  const result = check.result;
  const observation = {
    observationId: researchObservationId(check.id, week),
    companyId: profile.id,
    // The evidence the check read is its source, as the player saw it when choosing the check.
    source: { kind: "check", author: check.evidence.source },
    receivedWeek: week,
    period: check.evidence.period,
    content:
      result.kind === "metric"
        ? { kind: "metric", metric: result.metric, value: result.value }
        : result.kind === "text"
          ? { kind: "text", title: result.title, text: result.text }
          : { kind: "text", title: UNAVAILABLE_TITLE, text: result.reason },
    references: [],
  };
  const provenance =
    result.kind === "metric"
      ? {
          fact: { value: trueMetricValue(profile.hidden, result.metric) },
          ...(result.distortion === undefined ? {} : { distortion: result.distortion }),
        }
      : {};
  return { observation, provenance };
}
