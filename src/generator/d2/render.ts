import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { Config } from "../../config/schema.js";

export function renderD2Files(d2Files: string[], config: Config): { rendered: number; skipped: number; failed: number } {
  if (d2Files.length === 0) return { rendered: 0, skipped: 0, failed: 0 };

  let rendered = 0;
  let skipped = 0;
  let failed = 0;
  for (const d2Path of d2Files) {
    if (!fs.existsSync(d2Path)) {
      console.error(`Warning: expected D2 file not found, skipping: ${path.relative(process.cwd(), d2Path)}`);
      failed++;
      continue;
    }

    const ext = config.output.format;
    const outPath = d2Path.replace(/\.d2$/, `.${ext}`);
    const relPath = path.relative(process.cwd(), outPath);

    // Skip rendering if the output is already newer than all contributing D2 sources.
    if (isUpToDate(d2Path, outPath)) {
      skipped++;
      continue;
    }

    try {
      execFileSync(
        "d2",
        [
          `--theme=${config.output.theme}`,
          `--layout=${config.output.layout}`,
          d2Path,
          outPath,
        ],
        { stdio: "pipe", timeout: 30_000 },
      );
      rendered++;
      console.error(`Rendered: ${relPath}`);
    } catch (err: unknown) {
      const errCode = (err as NodeJS.ErrnoException).code;
      if (errCode === "ENOENT") {
        console.error(
          "Error: d2 CLI not found. Install it to render diagrams: https://d2lang.com/releases/install",
        );
        return { rendered, skipped, failed: failed + d2Files.length - rendered - skipped - failed };
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (errCode === "ETIMEDOUT" || msg.includes("killed")) {
        console.error(`Warning: rendering timed out for ${relPath} (diagram may be too large)`);
        failed++;
        continue;
      }
      console.error(`Warning: failed to render ${relPath}: ${msg}`);
      failed++;
    }
  }
  if (rendered > 0) {
    console.error(
      `Rendered ${rendered} ${config.output.format.toUpperCase()} file(s).`,
    );
  }
  if (skipped > 0) {
    console.error(`Skipped ${skipped} unchanged file(s).`);
  }
  if (failed > 0) {
    console.error(`Failed to render ${failed} file(s). See warnings above.`);
  }
  return { rendered, skipped, failed };
}

/**
 * Check if the rendered output is up-to-date with all D2 source files
 * that contribute to it: the user-facing D2 file, the corresponding
 * _generated/*.d2 file, the local styles.d2, and (for nested diagrams)
 * the parent-level styles.d2.
 */
function isUpToDate(d2Path: string, outPath: string): boolean {
  try {
    if (!fs.existsSync(outPath)) return false;

    const outMtime = fs.statSync(outPath).mtimeMs;
    const dir = path.dirname(d2Path);
    const base = path.basename(d2Path, ".d2");

    // Collect all D2 files that feed into this output
    const sources = [d2Path];

    const generatedFile = path.join(dir, "_generated", `${base}.d2`);
    if (fs.existsSync(generatedFile)) sources.push(generatedFile);

    const stylesFile = path.join(dir, "styles.d2");
    if (fs.existsSync(stylesFile)) sources.push(stylesFile);

    // For component diagrams nested in containers/, styles.d2 is two levels up
    const parentStyles = path.join(dir, "..", "..", "styles.d2");
    if (fs.existsSync(parentStyles)) sources.push(parentStyles);

    return sources.every((src) => fs.statSync(src).mtimeMs <= outMtime);
  } catch {
    // If any stat fails (e.g., file deleted between exists check and stat),
    // treat as out of date — a re-render is the safe fallback.
    return false;
  }
}
