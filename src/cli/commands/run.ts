import { Command } from "commander";
import { loadConfig } from "../../config/loader.js";
import { processFolder, totalFailures } from "../../core/recursive-runner.js";
import { renderD2Files } from "../../generator/d2/render.js";

export const runCommand = new Command("run")
  .description(
    "Recursively analyze and generate architecture diagrams for the entire repository",
  )
  .option("-c, --config <path>", "Path to diagram-docs.yaml")
  .option("--no-agent", "Disable LLM agent assist (use heuristics only)")
  .action(async (options) => {
    const { config, configDir } = loadConfig(options.config);

    if (options.agent === false) {
      config.agent.enabled = false;
    }

    const rootDir = configDir;
    console.error(`diagram-docs: recursive analysis starting at ${rootDir}`);
    console.error(
      `Agent assist: ${config.agent.enabled ? `enabled (${config.agent.provider}/${config.agent.model})` : "disabled"}`,
    );

    try {
      const { d2Files, failures } = await processFolder(rootDir, rootDir, config);
      console.error(`Done. Generated ${d2Files.length} D2 file(s).`);

      const nonFatal = totalFailures(failures);
      if (nonFatal > 0) {
        console.error(
          `Summary of non-fatal failures: ${failures.llm} LLM, ${failures.analyzer} analyzer, ${failures.generation} generation, ${failures.scaffold} scaffold. See warnings above.`,
        );
      }

      const result = renderD2Files(d2Files, config);
      if (result.failed > 0 || nonFatal > 0) {
        process.exitCode = 1;
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        console.error(`Error: recursive analysis failed: ${err.message}`);
        if (err.stack) console.error(err.stack);
      } else {
        console.error(`Error: recursive analysis failed: ${err}`);
      }
      process.exitCode = 1;
    }
  });
