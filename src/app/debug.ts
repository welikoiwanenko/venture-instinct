// Developer-only application API (docs/design-doc.md §17.4): the full world state of a
// campaign, hidden values and distortion reasons included. Kept apart from
// campaign-app.ts so that player-facing adapters cannot reach it by accident: the TUI
// and the future Playtest MCP must never import this module (test/tui-boundary.test.ts
// enforces it for the TUI). The developer CLI may.

import { buildDebugView, type DebugView } from "../knowledge/debug-view.ts";
import type { Campaign } from "./campaign-app.ts";

export type { DebugCompany, DebugObservation, DebugView } from "../knowledge/debug-view.ts";

/** Pure: never changes the campaign, advances time or draws randomness. */
export function viewForDebug(campaign: Campaign): DebugView {
  return buildDebugView({ campaignId: campaign.id, state: campaign.state, profiles: campaign.scenario.content.companies });
}
