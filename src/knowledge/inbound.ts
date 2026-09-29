// Delivery of inbound applications (docs/design-doc.md §8.1, §9.1). Each application in
// the pack becomes observations from its author: one text observation (short form as
// its title, the application as written as its text) and one metric observation per
// claimed figure, which references the text. Each claim's provenance records the true
// value from the hidden state and the authored distortion reason, if any.
//
// Observation ids are derived from company id and metric, never from order or time,
// so the same pack always delivers the same ids.

import type { CompanyProfile } from "../content/company-profile.ts";
import { trueMetricValue } from "./facts.ts";
import { appendObservations, type ObservationLog } from "./observation.ts";

export interface ObservationEntry {
  readonly observation: unknown;
  readonly provenance?: unknown;
}

export function applicationObservationId(companyId: string): string {
  return `obs-${companyId}-application`;
}

/** The entries the applications received in `week` deliver, in pack order. */
export function inboundApplicationEntries(profiles: readonly CompanyProfile[], week: number): ObservationEntry[] {
  return profiles.flatMap((profile) => {
    const application = profile.application;
    if (application === undefined || application.receivedWeek !== week) return [];
    const textId = applicationObservationId(profile.id);
    const source = { kind: "founder", author: application.authorId };
    const text: ObservationEntry = {
      observation: {
        observationId: textId,
        companyId: profile.id,
        source,
        receivedWeek: application.receivedWeek,
        // The application as a whole describes the span its figures cover.
        period: {
          fromWeek: Math.min(...application.claims.map((c) => c.period.fromWeek)),
          toWeek: Math.max(...application.claims.map((c) => c.period.toWeek)),
        },
        content: { kind: "text", title: application.summary, text: application.text },
        references: [],
      },
    };
    const claims = application.claims.map(
      (claim): ObservationEntry => ({
        observation: {
          observationId: `${textId}-${kebab(claim.metric)}`,
          companyId: profile.id,
          source,
          receivedWeek: application.receivedWeek,
          period: claim.period,
          content: { kind: "metric", metric: claim.metric, value: claim.value },
          references: [textId],
        },
        provenance: {
          fact: { value: trueMetricValue(profile.hidden, claim.metric) },
          ...(claim.distortion === undefined ? {} : { distortion: claim.distortion }),
        },
      }),
    );
    return [text, ...claims];
  });
}

/**
 * Appends what arrives in `week`. A validated pack always delivers cleanly, so a
 * rejection is a bug in the pack validation, and it throws instead of half-delivering.
 */
export function deliverInboundApplications(log: ObservationLog, profiles: readonly CompanyProfile[], week: number): ObservationLog {
  const result = appendObservations(log, inboundApplicationEntries(profiles, week));
  if (!result.ok) {
    throw new Error(`inbound applications for week ${week} could not be delivered:\n${result.issues.map((i) => `${i.path}: ${i.message}`).join("\n")}`);
  }
  return result.log;
}

function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}
