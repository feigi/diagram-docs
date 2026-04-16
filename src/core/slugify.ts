import path from "node:path";

/**
 * Convert a path or name into a stable, URL-safe ID.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Like slugify(), but safe for file-system paths that may be "." (root).
 * Falls back to the resolved directory basename when the path contains only
 * non-alphanumeric characters (e.g. ".").
 */
export function slugifyPath(input: string): string {
  return slugify(input) || slugify(path.basename(path.resolve(input)));
}
