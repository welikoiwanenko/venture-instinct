// Display helpers shared by adapters (CLI, TUI). Presentation only: the results are
// never parsed back into domain values.

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
