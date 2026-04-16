import * as fs from "node:fs";
import * as path from "node:path";

export interface ScaffoldOptions {
  containerName: string;
  componentName: string;
  outputDir: string;
}

export function scaffoldCodeFile(
  targetPath: string,
  opts: ScaffoldOptions,
): void {
  if (fs.existsSync(targetPath)) return;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const relStyles = path.relative(
    path.dirname(targetPath),
    path.join(opts.outputDir, "styles.d2"),
  );
  const contents = [
    `# C4 Code Diagram — ${opts.containerName} / ${opts.componentName}`,
    `...@_generated/c4-code.d2`,
    `...@${relStyles}`,
    ``,
    `# Add your customizations below this line`,
    ``,
  ].join("\n");
  fs.writeFileSync(targetPath, contents, "utf-8");
}
