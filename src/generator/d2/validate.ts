import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface ValidationError {
  file: string;
  message: string;
}

export interface ValidationResult {
  valid: number;
  errors: ValidationError[];
}

/**
 * Validate D2 files using the `d2 validate` CLI command.
 * Returns counts and any validation errors found.
 * Returns null and warns if the d2 CLI is not installed (ENOENT). Other
 * failures (EACCES, timeout, crash) are re-thrown so they aren't silently
 * swallowed as "validation skipped".
 */
export function validateD2Files(d2Files: string[]): ValidationResult | null {
  if (d2Files.length === 0) return { valid: 0, errors: [] };

  try {
    execFileSync("d2", ["version"], { stdio: "pipe", timeout: 5_000 });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      process.stderr.write(
        "Warning: skipping D2 validation; 'd2' CLI not found in PATH.\n",
      );
      return null;
    }
    throw err;
  }

  const errors: ValidationError[] = [];
  let valid = 0;

  for (const d2Path of d2Files) {
    if (!fs.existsSync(d2Path)) continue;

    try {
      execFileSync("d2", ["validate", d2Path], {
        stdio: "pipe",
        timeout: 30_000,
      });
      valid++;
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "stderr" in err
          ? String((err as { stderr: unknown }).stderr).trim()
          : err instanceof Error
            ? err.message
            : String(err);
      errors.push({
        file: path.relative(process.cwd(), d2Path),
        message,
      });
    }
  }

  return { valid, errors };
}
