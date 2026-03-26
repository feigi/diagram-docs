/**
 * Interactive LLM provider and model selection for first-time setup.
 *
 * When no diagram-docs.yaml exists and the user is not in deterministic mode,
 * this module detects available CLI tools, prompts the user to choose a
 * provider (if multiple are available), queries available models, and lets
 * the user pick one.
 */
import * as readline from "node:readline";
import { execFileSync } from "node:child_process";
import chalk from "chalk";
import { commandExists } from "../core/llm-model-builder.js";

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

export interface LLMSetup {
  provider: "claude-code" | "copilot";
  model: string;
}

interface ProviderInfo {
  id: "claude-code" | "copilot";
  label: string;
  cliCommand: string;
}

const PROVIDERS: ProviderInfo[] = [
  { id: "claude-code", label: "Claude Code CLI", cliCommand: "claude" },
  { id: "copilot", label: "GitHub Copilot CLI", cliCommand: "copilot" },
];

// -------------------------------------------------------------------------
// Model querying
// -------------------------------------------------------------------------

/**
 * Attempt to list available models by running `<cli> model list`.
 * Returns model identifiers on success, null on failure.
 */
function queryModelsFromCLI(cliCommand: string): string[] | null {
  try {
    const output = execFileSync(cliCommand, ["model", "list"], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15_000,
      encoding: "utf-8",
    });

    const models: string[] = [];
    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Skip header/decoration lines
      if (/^[-=─┌┐└┘│┤├┬┴┼╔╗╚╝║╠╣╦╩╬]+$/.test(trimmed)) continue;
      if (/^(available|models?|id|name)\b/i.test(trimmed)) continue;

      // Extract the first whitespace-delimited token as the model ID.
      // CLI output may include descriptions or table columns after the ID.
      const token = trimmed.split(/\s+/)[0];
      if (token && /^[a-zA-Z0-9]/.test(token)) {
        models.push(token);
      }
    }

    return models.length > 0 ? models : null;
  } catch {
    return null;
  }
}

const FALLBACK_MODELS: Record<string, string[]> = {
  "claude-code": ["sonnet", "haiku", "opus"],
  copilot: ["claude-sonnet-4", "gpt-4.1", "o4-mini"],
};

function getModelsForProvider(provider: ProviderInfo): string[] {
  const queried = queryModelsFromCLI(provider.cliCommand);
  return queried ?? FALLBACK_MODELS[provider.id] ?? [];
}

// -------------------------------------------------------------------------
// Interactive prompts (readline-based, writes to stderr)
// -------------------------------------------------------------------------

function createRL(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
}

function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer));
  });
}

/**
 * Present a numbered list and return the 0-based index of the user's choice.
 */
async function promptChoice(
  rl: readline.Interface,
  header: string,
  choices: string[],
): Promise<number> {
  process.stderr.write(`\n${header}\n`);
  for (let i = 0; i < choices.length; i++) {
    const marker = i === 0 ? chalk.dim(" (recommended)") : "";
    process.stderr.write(`  ${chalk.bold(`${i + 1})`)} ${choices[i]}${marker}\n`);
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const answer = await question(rl, `${chalk.cyan(">")} `);
    const num = parseInt(answer.trim(), 10);
    if (num >= 1 && num <= choices.length) {
      return num - 1;
    }
    process.stderr.write(
      chalk.yellow(`  Please enter a number between 1 and ${choices.length}\n`),
    );
  }
}

// -------------------------------------------------------------------------
// Main entry point
// -------------------------------------------------------------------------

/**
 * Interactively select an LLM provider and model.
 *
 * Returns `null` when:
 * - stdin is not a TTY (non-interactive — e.g. piped input)
 * - no supported CLI is available
 */
export async function promptLLMSetup(): Promise<LLMSetup | null> {
  if (!process.stdin.isTTY) return null;

  const available = PROVIDERS.filter((p) => commandExists(p.cliCommand));

  if (available.length === 0) return null;

  const rl = createRL();
  try {
    let provider: ProviderInfo;

    if (available.length === 1) {
      provider = available[0];
      process.stderr.write(
        `\nDetected ${chalk.bold(provider.label)}.\n`,
      );
    } else {
      const idx = await promptChoice(
        rl,
        "Multiple LLM providers detected. Which would you like to use?",
        available.map((p) => p.label),
      );
      provider = available[idx];
    }

    // Query models
    const models = getModelsForProvider(provider);

    let model: string;
    if (models.length === 0) {
      model = FALLBACK_MODELS[provider.id]?.[0] ?? "sonnet";
    } else if (models.length === 1) {
      model = models[0];
      process.stderr.write(`  Model: ${chalk.bold(model)}\n`);
    } else {
      const idx = await promptChoice(
        rl,
        `Select a model for ${provider.label}:`,
        models,
      );
      model = models[idx];
    }

    process.stderr.write(
      `\nUsing ${chalk.bold(provider.label)} with model ${chalk.bold(model)}.\n`,
    );

    return { provider: provider.id, model };
  } finally {
    rl.close();
  }
}
