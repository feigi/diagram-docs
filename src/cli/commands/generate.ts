import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import { loadConfig } from "../../config/loader.js";
import { loadModel } from "../../core/model.js";
import { generateContextDiagram } from "../../generator/d2/context.js";
import { generateContainerDiagram } from "../../generator/d2/container.js";
import { generateComponentDiagram } from "../../generator/d2/component.js";
import { scaffoldUserFiles } from "../../generator/d2/scaffold.js";

export const generateCommand = new Command("generate")
  .description("Generate D2 diagrams from an architecture model")
  .requiredOption("-m, --model <path>", "Path to architecture-model.yaml")
  .option("-c, --config <path>", "Path to diagram-docs.yaml")
  .action((options) => {
    const { config, configDir } = loadConfig(options.config);
    const model = loadModel(options.model);

    const outputDir = path.resolve(configDir, config.output.dir);
    const generatedDir = path.join(outputDir, "_generated");

    // Ensure output directories exist
    if (!fs.existsSync(generatedDir)) {
      fs.mkdirSync(generatedDir, { recursive: true });
    }

    let filesWritten = 0;

    // L1: Context diagram
    if (config.levels.context) {
      const d2 = generateContextDiagram(model);
      fs.writeFileSync(path.join(generatedDir, "context.d2"), d2, "utf-8");
      filesWritten++;
      console.error("Generated: _generated/context.d2");
    }

    // L2: Container diagram
    if (config.levels.container) {
      const d2 = generateContainerDiagram(model);
      fs.writeFileSync(path.join(generatedDir, "container.d2"), d2, "utf-8");
      filesWritten++;
      console.error("Generated: _generated/container.d2");
    }

    // L3: Component diagrams (one per container)
    if (config.levels.component) {
      const componentsDir = path.join(generatedDir, "components");
      if (!fs.existsSync(componentsDir)) {
        fs.mkdirSync(componentsDir, { recursive: true });
      }

      for (const container of model.containers) {
        const d2 = generateComponentDiagram(model, container.id);
        fs.writeFileSync(
          path.join(componentsDir, `${container.id}.d2`),
          d2,
          "utf-8",
        );
        filesWritten++;
        console.error(`Generated: _generated/components/${container.id}.d2`);
      }
    }

    // Scaffold user-facing files (only creates, never overwrites)
    scaffoldUserFiles(outputDir, model, config);

    console.error(`Done. ${filesWritten} generated file(s) written to ${config.output.dir}/`);
  });
