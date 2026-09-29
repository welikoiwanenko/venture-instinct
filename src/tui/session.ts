// Starts a campaign for the TUI through the application API, exactly as the VI-10
// command does: read the scenario pack, then `initializeCampaign` with the baseline
// config. The result is either a whole campaign or readable errors, never a partial one.

import { formatManifestIssue, initializeCampaign, type Campaign } from "../app/campaign-app.ts";

/** Where the scenario pack comes from; `read` is called on every start attempt. */
export interface ScenarioSource {
  /** Shown to the player, e.g. the file path. */
  readonly label: string;
  readonly read: () => string;
}

export type StartResult =
  | { readonly ok: true; readonly campaign: Campaign }
  | { readonly ok: false; readonly errors: readonly string[] };

export function startCampaign(seed: string, source: ScenarioSource): StartResult {
  let text: string;
  try {
    text = source.read();
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code ?? (error as Error).message;
    return { ok: false, errors: [`scenario ${source.label}: cannot read file (${reason})`] };
  }
  let scenario: unknown;
  try {
    scenario = JSON.parse(text) as unknown;
  } catch (error) {
    return { ok: false, errors: [`scenario ${source.label}: invalid JSON (${(error as Error).message})`] };
  }
  const result = initializeCampaign({ seed, scenario });
  return result.ok ? { ok: true, campaign: result.campaign } : { ok: false, errors: result.issues.map(formatManifestIssue) };
}
