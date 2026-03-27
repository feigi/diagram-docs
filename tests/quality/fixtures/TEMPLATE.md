# Adding a Quality Test Fixture

This guide is designed for LLM-assisted fixture creation. Point an LLM at the source code you want to test and ask it to produce an `expected.json` following this template.

## Steps

1. **Create the fixture source code** in `tests/fixtures/monorepo/` (or a new standalone directory under `tests/fixtures/`).

2. **Create `expected.json`** in `tests/quality/fixtures/<name>/expected.json` by reading every source file and hand-verifying:

```json
{
  "$comment": "Ground truth for <path>. Hand-verified from source.",
  "language": "java | python | c | typescript",
  "modules": [
    {
      "name": "<package/module name as the analyzer sees it>",
      "exports": ["<public class>", "<public function>"]
    }
  ],
  "imports": [
    {
      "source": "<import string exactly as written in source>",
      "inModule": "<which module name contains this import>",
      "isExternal": true
    }
  ],
  "externalDependencies": [{ "name": "<dep name as parsed from build file>" }],
  "metadata": {
    "<module name>": {
      "<key>": "<value, e.g. spring.stereotypes: @Service>"
    }
  }
}
```

3. **Register the fixture** in `tests/quality/correctness.test.ts` by adding an entry to the `FIXTURES` array:

```typescript
{
  name: "my-new-fixture",
  appPath: path.resolve(MONOREPO, "path/to/app"),
  expectedPath: path.resolve(QUALITY_FIXTURES, "my-new-fixture/expected.json"),
  analyzerId: "java",  // must match the language analyzer id
}
```

## LLM Prompt for Generating expected.json

Use this prompt with any LLM to generate a ground-truth file:

```
Read every source file in <path>. For each file, extract:
- Which module/package it belongs to
- All import/include statements (exact source string)
- Whether each import is internal (resolves to another module in this app) or external
- All public exports (classes, functions, interfaces)
- Any framework metadata (Spring annotations, FastAPI/Flask markers)

Also read the build file (pom.xml, pyproject.toml, CMakeLists.txt, etc.) and extract all declared dependencies.

Output as JSON matching this schema: <paste ExpectedApplication type from types.ts>

Be exhaustive — list every import, every export, every dependency. This is ground truth for testing a code scanner.
```

## Verification Rules

- Every import in `expected.json` must have a corresponding line in the source code
- Every export must be a public class/function/interface that actually exists
- Every external dependency must appear in the build file
- Module names must match what the analyzer would derive (package name for Java, top-level dir for Python, directory for C)
- Metadata keys must match the analyzer's output keys (e.g. `spring.stereotypes`, `framework`)
