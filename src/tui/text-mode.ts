// Linear text mode for screen readers and pipes (docs/design-doc.md §15): output is
// append-only plain text with no cursor movement or colour, and input is one command
// per line. It shares the navigation model with the full-screen renderer.

import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

import { update, type TuiState } from "./model.ts";
import { textCommand } from "./keys.ts";
import { buildScreen, renderHelp, renderLinear, TEXT_COMMANDS, type ScreenContext } from "./screen.ts";
import { startCampaign, submitEndWeek, type ScenarioSource } from "./session.ts";

export interface TextIo {
  readonly input: Readable;
  readonly write: (text: string) => void;
}

/** Resolves when the player quits or input ends. */
export async function runTextMode(initial: TuiState, io: TextIo, source: ScenarioSource): Promise<void> {
  const context: ScreenContext = { scenarioLabel: source.label, linear: true };
  let state = initial;
  io.write(`Venture Instinct, linear text mode. Type help for commands.\n\n${renderLinear(buildScreen(state, context))}> `);
  const lines = createInterface({ input: io.input, terminal: false });
  for await (const line of lines) {
    const command = textCommand(line);
    if (command === undefined) {
      io.write("> ");
      continue;
    }
    if ("unknown" in command) {
      io.write(`Unknown command: ${command.unknown}. Type help for commands.\n> `);
      continue;
    }
    if (command.type === "quit") break;
    if (command.type === "toggle-help") {
      io.write(`Commands:\n${renderHelp(TEXT_COMMANDS).join("\n")}\n> `);
      continue;
    }
    if (command.type === "start") {
      if (state.campaign !== undefined) {
        io.write("A campaign is already running in this session.\n> ");
        continue;
      }
      // Show the Overview, where the start form, its errors or the new campaign appear.
      state = update(state, { type: "select", section: "overview" });
      state = update(state, { type: "start-result", result: startCampaign(command.seed, source) });
    } else if (command.type === "open-company") {
      const count = buildScreen(state, context).companyCount;
      if (count === 0 || command.index < 0 || command.index >= count) {
        io.write(`${count === 0 ? "No companies to open yet." : `Choose a company from 1 to ${count}.`}\n> `);
        continue;
      }
      state = update(update(state, { type: "select", section: "companies" }), { type: "open-company", count, index: command.index });
    } else if (command.type === "plan-add" || command.type === "plan-remove") {
      if (state.campaign === undefined) {
        io.write("Start a campaign first.\n> ");
        continue;
      }
      state = update(update(state, { type: "select", section: "plan" }), { type: "close-review" });
      const screen = buildScreen(state, context);
      const row = screen.planRows[command.index];
      if (row === undefined) {
        io.write(`${screen.planRows.length === 0 ? "No research is available this week." : `Choose an action from 1 to ${screen.planRows.length}.`}\n> `);
        continue;
      }
      const planned = state.planDraft.some((i) => i.companyId === row.item.companyId && i.checkId === row.item.checkId);
      if (planned === (command.type === "plan-add")) {
        io.write(`Action ${command.index + 1} is ${planned ? "already" : "not"} in the plan.\n> `);
        continue;
      }
      state = update(state, { type: "toggle-plan", item: row.item, cost: row.cost, slotsLeft: screen.slotsLeft, index: command.index });
    } else if (command.type === "open-review" || command.type === "end-week") {
      const campaign = state.campaign;
      if (campaign === undefined) {
        io.write("Start a campaign first.\n> ");
        continue;
      }
      state = update(state, { type: "select", section: "plan" });
      // One review before End Week: `end` without an open review shows it first.
      if (command.type === "end-week" && state.reviewOpen) {
        state = update(state, { type: "end-week-result", result: submitEndWeek(campaign, state.planDraft) });
      } else if (!state.reviewOpen) {
        state = update(state, { type: "open-review" });
        if (command.type === "end-week") io.write("\nReview the plan first; type end again to end the week.\n");
      }
    } else if (command.type === "close-company" && state.reviewOpen && state.section === "plan") {
      state = update(state, { type: "close-review" });
    } else {
      state = update(state, command);
    }
    io.write(`\n${renderLinear(buildScreen(state, context))}> `);
  }
  lines.close();
  io.write("\nBye.\n");
}
