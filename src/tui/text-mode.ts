// Linear text mode for screen readers and pipes (docs/design-doc.md §15): output is
// append-only plain text with no cursor movement or colour, and input is one command
// per line. It shares the navigation model with the full-screen renderer.

import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

import { update, type TuiState } from "./model.ts";
import { textCommand } from "./keys.ts";
import { buildScreen, renderHelp, renderLinear, TEXT_COMMANDS } from "./screen.ts";

export interface TextIo {
  readonly input: Readable;
  readonly write: (text: string) => void;
}

/** Resolves when the player quits or input ends. */
export async function runTextMode(initial: TuiState, io: TextIo): Promise<void> {
  let state = initial;
  io.write(`Venture Instinct, linear text mode. Type help for commands.\n\n${renderLinear(buildScreen(state))}> `);
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
    state = update(state, command);
    io.write(`\n${renderLinear(buildScreen(state))}> `);
  }
  lines.close();
  io.write("\nBye.\n");
}
