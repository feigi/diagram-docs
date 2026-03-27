# LLM Pipeline Performance Optimization

## Problem

The LLM agent step in the scan → model → generate pipeline takes too long for multi-app monorepos. A 3-app repo takes ~12 minutes in a single LLM call, and the 15-minute timeout is insufficient for larger repos (~40 folders). The bottleneck is LLM thinking time — the model must reason about all applications, their modules, relationships, actors, and external systems in one pass.

## Solution Overview

Two complementary strategies, each independently valuable:

1. **Smarter Deterministic Seed** — push more intelligence into the pre-LLM deterministic builder so the LLM has less to figure out.
2. **Parallel Per-App LLM Calls** — split one massive LLM call into N concurrent per-app calls plus a lightweight synthesis pass.

## Design

### Part 1: Smarter Deterministic Seed

#### Pattern Registry (`src/core/patterns.ts`)

A data-driven registry of patterns for detecting architectural roles and external systems. Framework-agnostic — matches on annotation names and dependency name substrings that apply across Java, Python, C#, Go, etc.

```ts
interface RolePattern {
  annotations: string[]; // annotation names to match (case-insensitive)
  role: string; // e.g. "controller", "repository", "listener"
}

interface ExternalSystemPattern {
  keywords: string[]; // substring match against dependency names
  type: string; // e.g. "Database", "Message Broker", "Cache"
  technology?: string; // e.g. "PostgreSQL" when keyword is "postgresql"
}
```

**Role patterns** (actor inference):

- `Controller`, `RestController`, `Resource`, `Endpoint`, `Route`, `Handler` → "controller" role → implies API consumer actor
- `Listener`, `Consumer`, `Subscriber` → "listener" role → implies upstream system actor
- `Repository`, `Dao` → "repository" role (used for relationship labels)
- `Service` → "service" role (used for relationship labels)

**External system patterns** (dependency detection):

- `postgresql`, `mysql`, `oracle`, `sqlite`, `h2` → Database
- `kafka`, `rabbitmq`, `amqp` → Message Broker
- `redis`, `memcached` → Cache
- `elasticsearch`, `opensearch` → Search Engine
- `s3`, `blob-storage`, `minio` → Object Storage
- Substring matches against `externalDependencies[].name`

#### Enhanced `model-builder.ts`

Using the pattern registry, the deterministic seed now produces:

- **Actors**: Inferred from module annotations. Controller-like annotations → "User" or "API Consumer" actor. Listener-like annotations → "Upstream System" actor. Deduplicated per type.
- **External systems**: Detected from dependency names via pattern matching. Each match produces an external system entry with appropriate type and technology.
- **Relationship labels**: Role-aware instead of all "Uses":
  - Controller-role component → another component: "Delegates to"
  - Any component → repository-role component: "Persists via"
  - Cross-app import: "Calls"
  - Component → detected external system: "Reads/writes data in" (DB), "Publishes to" / "Consumes from" (broker), etc.
  - Fallback: "Uses" (no worse than today)
- **Descriptions**: Role-informed. "REST API controller for user management" instead of "User Controller module".

### Part 2: Parallel Per-App LLM Calls

#### New file: `src/core/parallel-model-builder.ts`

Orchestrates the split → parallel dispatch → merge → synthesis flow.

#### Flow

```
buildModelWithLLM() entry point:
├── Resolve provider (unchanged)
├── If single app → existing single-call path (with enhanced seed)
├── If update mode (existingModelYaml provided) → existing single-call path
└── If multiple apps, seed mode → parallel path:
    ├── Split RawStructure into per-app slices
    ├── Build per-app deterministic seeds
    ├── Build cross-app relationships deterministically (kept separate from per-app calls)
    ├── Fire N parallel LLM calls (concurrency-limited via pLimit-style queue)
    │   ├── Each call: one app's scan data + its seed + scoped system prompt
    │   └── Per-app timeout: 5 minutes (starting point — may need tuning for large apps)
    ├── Collect partial models, fall back to deterministic seed on failure
    ├── Merge partial models:
    │   ├── Concatenate containers, components, intra-app relationships
    │   ├── Deduplicate actors by slugified name (same name = same actor, merge descriptions)
    │   ├── Deduplicate external systems by id
    │   ├── Inject deterministic cross-app relationships (container-level and component-level)
    │   └── Resolve relationship label conflicts: LLM label wins over deterministic "Uses"/"Calls"
    ├── One synthesis LLM call (lightweight):
    │   ├── Input: container summaries, merged actors, merged externals, cross-app relationships
    │   ├── Job: system description, cross-app relationship labels, actor/external consolidation
    │   └── Timeout: 2 minutes
    └── Merge synthesis into final model → validate against schema
```

#### Per-App RawStructure Split

Each per-app slice contains:

- One `ScannedApplication` with all its modules, dependencies, and configFiles
- `internalImports` included as **read-only context** — the per-app LLM sees which other apps this app depends on (by name/ID) but is instructed not to produce cross-app relationships. This gives the LLM enough context to write informed descriptions (e.g., "Calls the user service for authentication") without requiring it to resolve cross-app component IDs.
- Cross-app relationships are handled entirely by the deterministic builder (`buildRelationships()` in `model-builder.ts`), which already resolves them via the global `componentByModule` and `componentToContainer` maps. These are injected during the merge step.

#### Per-App Prompt

Same system prompt as today but scoped:

- Adds context: "You are modeling a single application within a larger system. Focus only on this application's internal architecture."
- Explicitly instructs: "Do not produce cross-container relationships. These are handled separately."
- `internalImports` included for context but marked as informational only.
- Input is one app's scan data + one app's seed. Much smaller token footprint.

#### Synthesis Prompt

A new, minimal prompt:

- Input: list of containers (id, name, description, technology), merged actors, merged external systems, deterministic cross-app relationships (container-level only).
- Job: write system name + description, refine cross-app relationship labels from generic "Uses"/"Calls" to specific verb phrases, consolidate duplicate actors/externals.
- No component-level detail — keeps input small and fast. Component-level cross-app relationships use deterministic labels (from the enhanced seed's pattern-based labeling).

#### Merge Logic Details

**Relationship dedup:** When two sources produce a relationship with the same `sourceId → targetId`:

1. LLM-generated label always wins over deterministic "Uses"/"Calls".
2. Between two LLM-generated labels, keep the longer/more specific one.
3. `technology` field: keep whichever is non-empty; if both present, prefer the LLM-generated one.

**Actor dedup:** Actors are deduplicated by `slugify(name)`. When two per-app models produce actors with the same slugified name:

1. Keep the longer/more specific description.
2. Merge any distinct relationship references.

**External system dedup:** Already keyed by `slugify(name)` → same ID = same system. Keep the more specific description/technology.

#### Concurrency Control

- New config option: `llm.concurrency` (default: 4, max parallel LLM calls)
- Implementation: `pLimit`-style concurrency queue — wraps each per-app call in a slot-limited async executor. `Promise.allSettled()` collects results after all slots complete.
- Each spawned process is independent (separate stdin/stdout/temp files)
- Note: `concurrency: 1` means serial per-app calls, which is slower than the monolithic path due to N invocations + synthesis overhead. This is intentional for rate-limit-constrained environments.

#### Progress Reporting

Uses existing `onStatus` and `onProgress` callbacks:

- "Modeling application 1/5: order-service..."
- "Modeling application 2/5: user-service..."
- "Synthesizing cross-app architecture..."
- Per-app progress shows only the most recently started app's streaming output (avoids garbled interleaved output). Status messages for all apps are shown sequentially.

#### Error Handling

- **Per-app call fails**: Log warning, use that app's deterministic seed. Other apps unaffected.
- **Synthesis call fails**: Use merged per-app results as-is. Cross-app labels remain as deterministic defaults. System description falls back to config value.
- **All per-app calls fail**: Throw `LLMCallError` (same as today's total failure).
- **Partial timeout**: Per-app timeout (5 min) is independent. One slow app doesn't block others.
- **Update mode**: Always uses the single-call path. Splitting an existing human-edited model across per-app calls would risk losing manual edits that span multiple apps.

### Configuration

New option in `src/config/schema.ts`:

```yaml
llm:
  provider: "auto" # existing
  model: "sonnet" # existing
  concurrency: 4 # NEW — max parallel LLM calls
```

## File Changes

### New Files

- `src/core/patterns.ts` — role pattern + external system pattern registries
- `src/core/parallel-model-builder.ts` — parallel orchestration: split, dispatch, merge, synthesis

### Modified Files

- `src/core/model-builder.ts` — use patterns for actors, externals, relationship labels, descriptions. Consolidate existing `inferComponentTechnology()` annotation matching into the shared pattern registry.
- `src/core/llm-model-builder.ts` — delegate to parallel builder for multi-app; add per-app and synthesis prompt builders
- `src/config/schema.ts` — add `llm.concurrency` option

## Implementation Phases

### Phase 1: Smarter Seed (standalone value)

1. Create `src/core/patterns.ts`
2. Enhance `src/core/model-builder.ts` to use patterns
3. Update `summarizeForLLM()` to include detected roles compactly
4. Test against existing monorepo fixture

### Phase 2: Parallel Per-App Calls

1. Create `src/core/parallel-model-builder.ts`
2. Add per-app and synthesis prompt variants
3. Wire into `buildModelWithLLM()` (parallel for multi-app, passthrough for single-app)
4. Add `llm.concurrency` config
5. Test with mock provider: verify parallel dispatch, merge correctness, error fallbacks

Each phase is independently shippable.

## Expected Performance

| Scenario                           | Current           | After Phase 1  | After Phase 2 |
| ---------------------------------- | ----------------- | -------------- | ------------- |
| 3 apps                             | ~12 min           | ~7-8 min       | ~3-4 min      |
| 10 apps                            | timeout (>15 min) | likely timeout | ~4-5 min      |
| 40 apps (filtered to ~10 relevant) | timeout           | timeout        | ~5-6 min      |

Time after Phase 2 is bounded by the slowest single app + synthesis (~1 min), not by the total number of apps.
