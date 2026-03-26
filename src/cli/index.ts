#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { scanCommand } from "./commands/scan.js";
import { generateCommand } from "./commands/generate.js";
import { modelCommand } from "./commands/model.js";
import { removeCommand } from "./commands/remove.js";

const program = new Command();

program
  .name("diagram-docs")
  .description(
    "C4 architecture diagram generator — static analysis to D2 format",
  )
  .version("0.1.0");

program.addCommand(initCommand);
program.addCommand(scanCommand);
program.addCommand(modelCommand);
program.addCommand(generateCommand);
program.addCommand(removeCommand);

program.parse();
