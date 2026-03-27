import * as fs from "node:fs";
import * as path from "node:path";

export interface GradleSettings {
  rootProjectName: string | null;
  subprojects: Array<{ name: string; dir: string }>;
}

export function parseSettingsGradle(appPath: string): GradleSettings | null {
  const settingsFile = findFile(appPath, [
    "settings.gradle",
    "settings.gradle.kts",
  ]);
  if (!settingsFile) return null;

  let content: string;
  try {
    content = fs.readFileSync(settingsFile, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      process.stderr.write(
        `Warning: settings file not found during Gradle scan, skipping: ${settingsFile}\n`,
      );
      return null;
    }
    throw err;
  }

  // Extract rootProject.name
  const nameMatch = content.match(/rootProject\.name\s*=\s*['"]([^'"]+)['"]/);
  const rootProjectName = nameMatch?.[1] ?? null;

  // Extract include directives: include 'foo', include('foo'), include('foo', 'bar')
  const subprojects: Array<{ name: string; dir: string }> = [];
  for (const match of content.matchAll(
    /include\s*\(?['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])*/g,
  )) {
    // First capture group
    addSubproject(match[1], subprojects);
    // Additional includes in the same call
    if (match[2]) addSubproject(match[2], subprojects);
  }

  // Handle multi-arg include: include('a', 'b', 'c')
  // The regex above only gets first two. Re-scan for all quoted strings in include() calls.
  for (const includeMatch of content.matchAll(/include\s*\(([^)]+)\)/g)) {
    const args = includeMatch[1];
    for (const argMatch of args.matchAll(/['"]([^'"]+)['"]/g)) {
      const name = argMatch[1];
      if (!subprojects.some((s) => s.name === name)) {
        addSubproject(name, subprojects);
      }
    }
  }

  // Handle projectDir overrides:
  // project(':foo').projectDir = file('bar')
  for (const match of content.matchAll(
    /project\s*\(\s*['"][:.]?([^'"]+)['"]\s*\)\.projectDir\s*=\s*file\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  )) {
    const projectName = match[1];
    const dir = match[2];
    const existing = subprojects.find((s) => s.name === projectName);
    if (existing) {
      existing.dir = dir;
    }
  }

  return { rootProjectName, subprojects };
}

function addSubproject(
  name: string,
  subprojects: Array<{ name: string; dir: string }>,
): void {
  // Strip leading colon (Gradle project paths use ':app' notation)
  const clean = name.replace(/^:/, "");
  subprojects.push({ name: clean, dir: clean });
}

export interface GradleDependencies {
  group: string | null;
  projectDeps: string[];
  mavenDeps: Array<{ group: string; artifact: string; version?: string }>;
}

export function parseGradleDependencies(
  buildFilePath: string,
): GradleDependencies {
  if (!fs.existsSync(buildFilePath)) {
    return { group: null, projectDeps: [], mavenDeps: [] };
  }

  let content: string;
  try {
    content = fs.readFileSync(buildFilePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { group: null, projectDeps: [], mavenDeps: [] };
    }
    throw err;
  }

  // Extract group: handles both `group = '...'` and `group '...'` (Groovy shorthand)
  const groupMatch = content.match(/^group\b\s*=?\s*['"]([^'"]+)['"]/m);
  const group = groupMatch?.[1] ?? null;

  const projectDeps: string[] = [];
  const mavenDeps: GradleDependencies["mavenDeps"] = [];

  // Match dependency lines: both Groovy (`implementation '...'`, `implementation project(':...')`)
  // and Kotlin DSL (`implementation("...")`, `implementation(project(":..."))`)
  // Word-boundary prefix prevents matching testImplementation as implementation
  const implConfigs =
    "(?:^|\\s)(?:implementation|api|compileOnly|runtimeOnly|annotationProcessor)";
  const testConfigs =
    "(?:testImplementation|testCompileOnly|testRuntimeOnly|testAnnotationProcessor)";

  // project(':name') deps — Groovy: `implementation project(':x')`, Kotlin: `implementation(project(":x"))`
  for (const match of content.matchAll(
    new RegExp(
      `${implConfigs}\\s*\\(?\\s*project\\s*\\(\\s*['"][:.]?([^'"]+)['"]\\s*\\)`,
      "gm",
    ),
  )) {
    projectDeps.push(match[1].replace(/^:/, ""));
  }

  // Maven coordinate deps — Groovy: `implementation 'g:a:v'`, Kotlin: `implementation("g:a:v")`
  for (const match of content.matchAll(
    new RegExp(
      `${implConfigs}\\s*\\(?\\s*['"]([^'":]+):([^'":]+)(?::([^'"]+))?['"]`,
      "gm",
    ),
  )) {
    mavenDeps.push({
      group: match[1],
      artifact: match[2],
      version: match[3] || undefined,
    });
  }

  // Exclude deps from test configurations — scan for those and remove matches
  const testDeps = new Set<string>();
  for (const match of content.matchAll(
    new RegExp(
      `${testConfigs}\\s*\\(?\\s*['"]([^'":]+):([^'":]+)(?::([^'"]+))?['"]`,
      "g",
    ),
  )) {
    testDeps.add(`${match[1]}:${match[2]}`);
  }
  const filteredMaven = mavenDeps.filter(
    (d) => !testDeps.has(`${d.group}:${d.artifact}`),
  );

  return { group, projectDeps, mavenDeps: filteredMaven };
}

export function findFile(dir: string, names: string[]): string | null {
  for (const name of names) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
