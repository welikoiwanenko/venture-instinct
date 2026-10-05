// Display helpers shared by adapters (CLI, TUI). Presentation only: the results are
// never parsed back into domain values.

import type { Metric, ObservationSource, Period } from "../knowledge/observation.ts";
import type { VerificationStatus } from "../knowledge/verification.ts";

/**
 * Fixed `$1,000,000` / `$12.50` style, independent of the host locale. Cents are
 * shown only when the amount is not a whole number of dollars.
 */
export function formatCentsAsUsd(cents: number): string {
  const absolute = Math.abs(cents);
  const remainder = absolute % 100;
  // Subtract first so the division is exact even near Number.MAX_SAFE_INTEGER.
  const dollars = String((absolute - remainder) / 100).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = remainder === 0 ? "" : `.${String(remainder).padStart(2, "0")}`;
  return `${cents < 0 ? "-" : ""}$${dollars}${fraction}`;
}

// Evidence formatting shared by the CLI and the TUI (design §9.1, §15). Statuses carry a
// symbol and a text label, so they never rely on colour.


export const METRIC_LABELS: Readonly<Record<Metric, string>> = {
  payingCustomers: "Paying customers",
  weeklyRevenueCents: "Weekly revenue",
  weeklyPriceCents: "Weekly price",
  weeklyBurnCents: "Weekly costs",
  cashCents: "Cash",
  teamSize: "Team size",
  largestCustomerShareBps: "Largest customer's share of revenue",
};

export const STATUS_LABELS: Readonly<Record<VerificationStatus, string>> = {
  "founder-claim": "◇ founder claim",
  "public-source": "○ public source",
  "confirmed-by-check": "✔ confirmed by this check",
  "conflicting-evidence": "⚠ conflicting evidence",
  "stale-period": "⌛ stale period",
};

/** `2600` → `26%`, `1250` → `12.5%`, `-50` → `-0.5%`. */
export function formatBasisPoints(bps: number): string {
  // The sign is written separately: -50 is -0.5%, and Math.trunc(-0.5) is -0, which prints as "0".
  const absolute = Math.abs(bps);
  const whole = Math.trunc(absolute / 100);
  const rest = absolute % 100;
  return `${bps < 0 ? "-" : ""}${whole}${rest === 0 ? "" : `.${String(rest).padStart(2, "0").replace(/0$/, "")}`}%`;
}

export function formatMetricValue(metric: Metric, value: number): string {
  switch (metric) {
    case "weeklyRevenueCents":
    case "weeklyPriceCents":
    case "weeklyBurnCents":
      return `${formatCentsAsUsd(value)}/week`;
    case "cashCents":
      return formatCentsAsUsd(value);
    case "largestCustomerShareBps":
      return formatBasisPoints(value);
    case "payingCustomers":
    case "teamSize":
      return String(value);
  }
}

/** `week 3` or `weeks -1 to 0`. */
export function formatWeeks(period: Period): string {
  return period.fromWeek === period.toWeek ? `week ${period.toWeek}` : `weeks ${period.fromWeek} to ${period.toWeek}`;
}

/** Week 0 and earlier are before the campaign started; the label says so. */
export function formatPeriod(period: Period): string {
  const span = formatWeeks(period);
  return period.toWeek <= 0 ? `${span} (before the campaign)` : span;
}

/** `Остап Гнатюк (founder)`; `names` maps known author ids (founders) to names. */
export function formatSource(source: ObservationSource, names: ReadonlyMap<string, string>): string {
  const who = names.get(source.author) ?? source.author;
  const kind = source.kind === "founder" ? "founder" : source.kind === "public" ? "public source" : "your check";
  return `${who} (${kind})`;
}
