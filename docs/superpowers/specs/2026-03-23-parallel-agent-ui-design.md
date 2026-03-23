# Parallel Agent UI Design

## Problem

When `diagram-docs model --llm` runs on a multi-app repository, per-app LLM agents are dispatched in parallel (up to `config.llm.concurrency`, default 4). However:

1. **The UI shows only one agent at a time.** A single `onProgress` callback is shared by all agents. The frame's partial-entry logic causes agents to overwrite each other's thinking text, making it appear sequential.
2. **No post-mortem debugging.** When an agent fails or produces bad output, there's no way to see what it was thinking or what prompts it received. The thinking text is ephemeral.

## Solution

Replace the single shared frame during the parallel phase with two new mechanisms:

1. **`ParallelProgress` component** — a compact terminal display showing per-app status (queued/thinking/output/done/failed) with a spinner and elapsed timers.
2. **Per-agent log files** — one log file per app at `.diagram-docs/logs/agent-<app-id>.log` containing prompts, thinking, output, and timing for post-mortem debugging.

The existing `Frame` component continues to be used for the synthesis pass and single-app mode, unchanged.

## Pipeline Flow

```
model --llm (multi-app seed mode)
  |
  +-- Step 1-2: Split & seed (instant, no UI)
  |
  +-- Step 3: Parallel per-app LLM calls
  |     +-- ParallelProgress component (new)
  |           - Shows per-app status table with spinner
  |           - Each agent writes to .diagram-docs/logs/agent-<app-id>.log
  |           - No scrollable log, no mouse handling
  |
  +-- Step 4-5: Merge & cross-app rels (instant, no UI)
  |
  +-- Step 6: Synthesis LLM call
  |     +-- Frame component (existing)
  |           - Title: "LLM Synthesis"
  |           - Scrollable log with thinking/output
  |           - Single-stream, works as-is
  |
  +-- Done
```

`ParallelProgress` stops and collapses to a summary line when all agents finish. The synthesis `Frame` appears below it. Both are visible in terminal scrollback.

For single-app mode, nothing changes — it uses the existing `Frame` directly.

## ParallelProgress Component

### File

`src/cli/parallel-progress.ts` (~100-150 lines)

### Visual Output (active)

```
┌─ LLM Agents ─────────────────────────────────────┐
│ ⠹ Modeling 5 apps                         3m 12s │
│   Model: sonnet                                   │
│                                                   │
│   los-cha-app              ✓ done          1m 02s │
│   los-kafka-sink           ⠹ thinking...   0m 45s │
│   los-chargingdb-model     ⠹ output...     0m 32s │
│   los-billing-service      ○ queued                │
│   los-gateway              ○ queued                │
└───────────────────────────────────────────────────┘
```

**State icons and styles:**
- **Active** (thinking/output): `chalk.cyan(SPINNER_FRAMES[i])` — rotating braille spinner, same frames as `frame.ts`
- **Done**: `chalk.green("✓")`
- **Failed**: `chalk.red("✗")`
- **Queued**: `chalk.dim("○")`

App IDs are truncated to 28 characters using the existing `truncate()` utility (exported from `frame.ts` or extracted to a shared module). Queued apps show no elapsed time.

### Visual Output (collapsed on completion)

```
┌─ LLM Agents ─────────────────────────────────────┐
│ ✓ 5/5 apps modeled                        4m 18s │
└───────────────────────────────────────────────────┘
```

### Handling Many Apps

If the app list exceeds `terminalRows - 6` (borders + header + padding), show only active and recently-completed apps, with a summary line at the bottom: `chalk.dim("  … and 12 more queued")`. In practice, repos rarely exceed 16 apps, and `llm.concurrency` caps active agents at 16.

### API

```typescript
export interface ParallelProgress {
  /** Register apps upfront so queued state renders immediately */
  setApps(appIds: string[]): void;
  /** Update a single app's state */
  updateApp(appId: string, state: AppState): void;
  /** Overall status text (e.g. "Merging models...") */
  setStatus(text: string): void;
  /** Collapse to summary and release terminal */
  stop(summary: string): void;
}

export type AppState = "queued" | "thinking" | "output" | "done" | "failed";

export function createParallelProgress(llmModel: string): ParallelProgress;
```

### Rendering

- Same ANSI cursor-up approach as `frame.ts` but simpler: fixed row count (top border + 2 header rows + blank row + N app rows + bottom border), no scroll, no mouse tracking.
- Spinner timer at 80ms (matches `frame.ts`).
- Frame width recalculated on each render tick (handles terminal resize).
- Reuses `chalk.dim` border style and box-drawing characters for visual consistency with the existing frame.
- Reuses `formatElapsed()` from `frame.ts` (exported or extracted to shared module).
- Per-app elapsed timer: each app tracks its own start time, set when state transitions away from `queued`. Done/failed apps freeze their elapsed time.
- `stop()` uses cursor-up by `prevTotalRows` to overwrite the full display, renders the collapsed 3-line frame, then erases below with `\x1b[J` — same approach as `Frame.stop()`.
- No Ctrl+C / SIGINT handling needed — `ParallelProgress` does not use raw mode or mouse tracking, so default signal behavior applies.

### Non-TTY Fallback

When stderr is not a TTY, print one line per state transition:

```
[0m 00s] Modeling 5 apps (sonnet)
[0m 12s] los-cha-app: thinking...
[0m 15s] los-kafka-sink: thinking...
[1m 02s] los-cha-app: done (1m 02s)
[1m 02s] los-chargingdb-model: thinking...
...
[4m 18s] 5/5 apps modeled
```

## Per-Agent Log Files

### Location

`.diagram-docs/logs/agent-<app-id>.log`

### Format

Plain text, append-only, with timestamped section markers:

```
[2026-03-23T14:02:31Z] START app=los-cha-app model=sonnet provider=claude-code
[2026-03-23T14:02:31Z] SYSTEM PROMPT
<full system prompt text>
[2026-03-23T14:02:31Z] USER MESSAGE
<full user message text>
[2026-03-23T14:02:33Z] THINKING
I need to analyze the raw-structure.json and the deterministic seed...
**Applications in the scan:**
1. `los-cha` – shell parent...
[2026-03-23T14:04:15Z] OUTPUT
version: "1.0"
system:
  name: "Charging Platform"
...
[2026-03-23T14:04:18Z] DONE elapsed=107s
```

On failure, a `FAILED` marker with the error message replaces `DONE`:

```
[2026-03-23T14:04:18Z] FAILED elapsed=107s error=Provider timeout after 900000ms
```

### Lifecycle

- `.diagram-docs/logs/` directory created at start of parallel build if it doesn't exist.
- The entire `logs/` directory is cleared at the start of each parallel build to remove stale logs from previous runs with different app sets.
- On first run, warn to stderr if `.diagram-docs/logs/` is not in `.gitignore` (do not auto-mutate the file).

### AgentLogger

A thin class in `src/core/agent-logger.ts`. Uses `fs.writeFile` (async) with an internal buffer that flushes on section boundaries (THINKING, OUTPUT, DONE, FAILED) rather than on every progress event, avoiding blocking the event loop with high-frequency sync writes.

```typescript
export class AgentLogger {
  constructor(logPath: string, metadata: { appId: string; model: string; provider: string });
  logPrompt(systemPrompt: string, userMessage: string): void;
  logProgress(event: ProgressEvent): void;
  logDone(elapsed: number): Promise<void>;
  logFailed(error: string, elapsed: number): Promise<void>;
}
```

`logProgress` appends thinking/output text to an internal buffer with section markers. Consecutive events of the same kind append without repeating the section header. The buffer is flushed when the kind changes or on `logDone`/`logFailed`.

## Changes to Existing Code

### `model.ts` (CLI command)

Currently creates one `Frame` upfront for all modes. Change to detect mode and create the appropriate UI:

```typescript
const isSeedMode = !existingModelYaml?.trim();
const isParallel = isSeedMode && rawStructure.applications.length > 1;

if (isParallel) {
  // Multi-app: parallel builder manages its own UI internally
  const model = await buildModelWithLLM({
    rawStructure, config, configYaml, existingModelYaml,
  });
  // ... write output, print summary
} else {
  // Single-app / update: use Frame as before
  const frame = createFrame("LLM Agent");
  const model = await buildModelWithLLM({
    rawStructure, config, configYaml, existingModelYaml,
    onStatus(status) { frame.update([...]); },
    onProgress({ line, final, kind }) { frame.log(line, final, kind); },
  });
  frame.stop([...]);
  // ... write output
}
```

### `llm-model-builder.ts`

- `BuildModelWithLLMOptions.onStatus` and `onProgress` become optional (they already are). In multi-app mode, when the caller omits them, the parallel builder creates its own UI.
- `buildModelWithLLM()` passes no `onStatus`/`onProgress` to `buildModelParallel()` when the caller didn't provide them. The parallel builder detects this and creates `ParallelProgress` + `Frame` internally.

### `parallel-model-builder.ts`

1. **`ParallelBuildOptions` changes:**
   - `onStatus` and `onProgress` remain optional. When absent, the parallel builder creates its own `ParallelProgress` and synthesis `Frame`.
   - When present (future callers that want custom UI), they're used as before.
2. **At the start of `buildModelParallel()`:** if no `onStatus`/`onProgress` provided, create `ParallelProgress` via `createParallelProgress(config.llm.model)` and call `progress.setApps(appIds)`.
3. **In `buildOneApp()`:** create `AgentLogger` for the app. Replace the existing `onStatus?.("Modeling app ...")` call with `progress.updateApp()`. Create a per-app `onProgress` closure that:
   - Writes to the `AgentLogger` (imports `ProgressEvent` from `llm-model-builder.ts`)
   - Maps `ProgressEvent.kind` to `ParallelProgress` state: first event transitions from `"queued"` to the event's `kind` (`"thinking"` or `"output"`). Subsequent events update if kind changes.
   - On `buildOneApp` success: `progress.updateApp(appId, "done")`
   - On `buildOneApp` catch (recoverable): `progress.updateApp(appId, "failed")`
4. **After `Promise.allSettled`:** `progress.stop("5/5 apps modeled")` collapses the parallel display.
5. **For synthesis (step 6):** create `Frame` via `createFrame("LLM Synthesis")`, wire its `onProgress`/`onStatus` for the single synthesis `provider.generate()` call. Stop the frame when synthesis completes.
6. **Log directory setup:** at the top of `buildModelParallel()`, create `.diagram-docs/logs/` if missing. Warn if not gitignored.

### `frame.ts`

Extract shared terminal utilities into a new `src/cli/terminal-utils.ts` module:
- `formatElapsed()` — elapsed time formatting
- `SPINNER_FRAMES`, `SPINNER_INTERVAL` — braille spinner characters and timing
- `stripAnsi()`, `truncate()`, `padRight()`, `getFrameWidth()` — string/layout utilities

Both `frame.ts` and `parallel-progress.ts` import from this shared module. `frame.ts` re-exports nothing — its public API stays unchanged.

### `ProgressEvent`

No changes. Each agent gets its own callback closure that knows its app ID, so events don't need a source identifier.

### `.gitignore`

No automatic mutation. On first run, if `.diagram-docs/logs/` is not in any applicable `.gitignore`, print a one-time warning to stderr.

## Non-Goals

- Live-scrolling per-agent output in the terminal (use `tail -f` on the log files instead).
- Persisting log files across runs (each run overwrites previous logs).
- Changes to single-app mode or the synthesis phase display.
- Automatic `.gitignore` mutation.
