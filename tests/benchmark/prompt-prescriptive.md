# Pure LLM Agent Prompt: C4 Architecture Diagrams in D2

> **Purpose:** Replace the diagram-docs hybrid pipeline (static scan + LLM model + deterministic generator)
> with a single LLM agent pass. Use this to benchmark cost, speed, and output stability against the
> hybrid approach.
>
> **Target agent:** Any tool-capable LLM (Claude, GPT-4o, Gemini) with `read_file`, `list_dir`,
> and `write_file` tools. No build tools, compilers, or external APIs required.

---

## System Prompt

You are an expert software architect. Your task is to analyze a source code repository and produce
C4 architecture diagrams in D2 format. You have access to file system tools: `list_dir`, `read_file`,
and `write_file`.

Work methodically. Reason step by step. Do not hallucinate files or dependencies — only describe
what you can verify by reading the code.

---

## User Prompt / Task

Analyze the source code repository rooted at `{ROOT_DIR}` and generate C4 architecture diagrams
in D2 format. Follow all instructions below precisely.

---

### Phase 1 — Discover Applications

Use `list_dir` recursively to find all build manifests. Each manifest signals one "application"
(a deployable unit or library):

| Language   | Build files to look for                                     |
| ---------- | ----------------------------------------------------------- |
| Java       | `pom.xml`, `build.gradle`, `build.gradle.kts`               |
| Python     | `pyproject.toml`, `setup.py`, `setup.cfg`                   |
| TypeScript | `tsconfig.json` (ignore `node_modules/`, `dist/`, `build/`) |
| C/C++      | `CMakeLists.txt`                                            |

Ignore build files nested inside `node_modules/`, `dist/`, `build/`, `.git/`, `__pycache__/`,
`target/`, `venv/`, `.venv/`.

For each build file found, record:

- `path` — directory containing the build file (relative to `ROOT_DIR`)
- `language` — inferred from build file type
- `name` — canonical name from the manifest (e.g. `"name"` field in `package.json`,
  `<artifactId>` in `pom.xml`, `name` in `pyproject.toml`, directory name for C)

If a directory contains both a root-level build file and sub-project build files (e.g. a Gradle
multi-project), treat each sub-project as its own application; ignore the root aggregator unless
it has its own source files.

---

### Phase 2 — Analyze Each Application

For each discovered application, read its source files and extract the following. Limit reads to
source code files; skip generated code (`dist/`, `build/`, `target/`, `__pycache__/`).

#### 2a. Modules

A "module" is the primary logical grouping within an application:

- **Java**: one module per top-level package grouping (e.g. `com.example.user`,
  `com.example.repo`). Read `.java` files in `src/main/java/`.
- **Python**: one module per top-level Python package directory that contains an `__init__.py`
  or a non-trivial `.py` file.
- **TypeScript**: one module per top-level directory under `src/` (or the `rootDir` from
  `tsconfig.json`).
- **C**: one module for `src/` (implementation files) and one for `include/` or `headers/`
  (public API).

For each module record:

- A unique `id` (kebab-case slug of `<app-path>/<module-name>`, e.g.
  `services-user-api-com-example-user`)
- Human-readable `name`
- Primary role (inferred from code): one of `controller`, `service`, `repository`,
  `gateway`, `listener`, `library`, `config`, `util`, `unknown`
- Technology/framework (e.g. `Spring Boot`, `Express`, `FastAPI`, `React`)

**Role detection heuristics:**

- Java: look for class-level annotations — `@RestController`/`@Controller` → controller;
  `@Service` → service; `@Repository` → repository; `@KafkaListener`/`@RabbitListener` → listener
- Python: FastAPI `@app.get`/`@router.*` → controller; Celery `@app.task` → listener
- TypeScript: files named `*.router.ts`, `*.controller.ts` → controller; Express `.route(` calls
- C: header files exposing public API → library

#### 2b. Internal Dependencies (Cross-Application)

Read the build manifest to find references to other paths in the repo:

- `package.json`: `"dependencies"` entries with `"file:../..."` paths → internal imports
- `pom.xml`: `<dependency>` entries whose `groupId:artifactId` matches another known module's
  artifact
- `pyproject.toml`: local path dependencies in `[tool.poetry.dependencies]` or `[project]`

Record each as: source application → target application path.

#### 2c. External Dependencies

From the build manifest, extract third-party dependencies. Then classify each as:

**External System** (has its own box in C4) if the name matches:

- Databases: `postgresql`, `mysql`, `mongodb`, `redis`, `sqlite`, `oracle`, `cassandra`,
  `dynamodb`, `mariadb`, `mssql`, `h2`
- Messaging: `kafka`, `rabbitmq`, `amqp`, `activemq`, `sqs`, `pubsub`, `nats`, `zeromq`
- Storage: `s3`, `gcs`, `azure-blob`, `minio`
- Search: `elasticsearch`, `opensearch`, `solr`
- Auth: `keycloak`, `auth0`, `okta`
- Email/SMS: `sendgrid`, `twilio`, `ses`
- Cache: `memcached`, `hazelcast`
- Observability: `datadog`, `newrelic`, `prometheus` _(tag as `monitoring`, don't show by default)_

**Library** (do not create a separate C4 box): everything else (utility libs, test frameworks,
build plugins, etc.).

For each detected External System record: `name`, `technology` (same as name, title-cased),
`description` (one sentence inferred from its role in the code).

#### 2d. Actors

Infer human/system actors from the presence of inbound API surface:

- If any application has a `controller` or `gateway` module → add actor `API Consumer`
  (description: "External client that consumes the system's APIs")
- If any application has a `listener` module → add actor `Upstream System`
  (description: "External system that sends events or messages")

Only add each actor once (deduplicate).

---

### Phase 3 — Build the C4 Architecture Model

Using the data gathered above, produce an `architecture-model.yaml` file at `{ROOT_DIR}`.
The file must conform exactly to this schema:

```yaml
version: 1

system:
  name: "<human-readable system name>" # infer from root package name, directory name, or readme
  description: "<one sentence description>"

actors:
  - id: <kebab-case>
    name: <display name>
    description: <one sentence>

externalSystems:
  - id: <kebab-case>
    name: <display name>
    description: <one sentence>
    technology: <technology name>
    tags: [] # add "library" if it's a lib, not an external system

containers: # one per application (skip pure library aggregators)
  - id: <app-path-as-kebab> # e.g. services-user-api
    applicationId: <same as id>
    name: <display name>
    description: <one sentence>
    technology: "<Language> / <Framework>" # e.g. "Java / Spring Boot", "Python / FastAPI", "TypeScript / Express"
    path: <relative path> # e.g. services/user-api

components: # one per module (with "balanced" grouping: max ~20 per container)
  - id: <container-id>-<module-slug>
    containerId: <container-id>
    name: <display name>
    description: <one sentence, role-aware> # e.g. "REST API controller for User"
    technology: <module technology> # e.g. "Java REST Controller", "FastAPI Router"
    moduleIds:
      - <module-id>

relationships:
  - sourceId: <component-or-container-id>
    targetId: <component-or-container-id-or-external-system-id>
    label: <verb phrase> # see label rules below
    technology: <optional, only for external systems>
```

**Relationship label rules** (source role → target role → label):

- controller → repository: `"Reads/writes via"`
- controller → service: `"Calls"`
- controller → listener/queue (external): `"Sends to"`
- service → repository: `"Delegates to"`
- service → external DB: `"Reads/writes data in"`
- any → external messaging: `"Publishes to"` or `"Consumes from"`
- container → container (cross-app): `"Uses"`
- anything else: `"Uses"`

Only create relationships that are evidenced by actual imports or explicit dependency declarations.
Do not infer relationships that are not in the code.

**Component grouping (balanced granularity):**
If a container has more than 20 modules, group related ones by shared name prefix. Aim for
5–20 components per container. Never group across different roles (don't merge a controller
with a repository).

**Exclude from components** (but still record them internally for relationship tracing):
modules whose name matches: `logging`, `metrics`, `middleware`, `config`, `utils`, `helpers`,
`constants`, `exceptions`, `errors`, `types`, `interfaces`, `dto`, `vo`.

---

### Phase 4 — Generate D2 Diagrams

Create the following files. The output directory root is `{OUTPUT_DIR}` (default:
`{ROOT_DIR}/docs/architecture`).

#### 4a. styles.d2

Write exactly this content to `{OUTPUT_DIR}/styles.d2`:

```d2
# C4 Architecture Diagram Styles
# Auto-generated — do not edit

direction: right

classes: {
  person: {
    shape: person
    width: 180
    height: 230
    style.fill: "#08427B"
    style.font-color: "#ffffff"
    style.stroke: "#073B6F"
  }
  system: {
    shape: rectangle
    style.fill: "#1168BD"
    style.font-color: "#ffffff"
    style.stroke: "#0E5CA8"
    style.border-radius: 8
  }
  external-system: {
    shape: rectangle
    style.fill: "#999999"
    style.font-color: "#ffffff"
    style.stroke: "#8A8A8A"
    style.border-radius: 8
  }
  container: {
    shape: rectangle
    style.fill: "#438DD5"
    style.font-color: "#ffffff"
    style.stroke: "#3C7FC0"
    style.border-radius: 8
  }
  component: {
    shape: rectangle
    style.fill: "#85BBF0"
    style.font-color: "#000000"
    style.stroke: "#78A8D8"
    style.border-radius: 8
  }
  system-boundary: {
    shape: rectangle
    style.fill: "#ffffff"
    style.font-color: "#444444"
    style.stroke: "#444444"
    style.stroke-dash: 5
    style.border-radius: 8
  }
}
```

#### 4b. D2 Syntax Rules (apply to all generated files)

- **IDs**: convert all kebab-case IDs to D2 ids by replacing `-` with `_` and lowercasing.
  Example: `services-user-api` → `services_user_api`
- **Node labels**: Use this multiline format (literal `\n` in the string, not a real newline):
  ```
  "<Name>\n\n[<Type>: <Technology>]\n<Description>"
  ```
  Examples:
  - Container: `"User Api\n\n[Container: Java / Spring Boot]\nUser Api application"`
  - Component: `"User\n\n[Component: Java REST Controller]\nREST API controller for User"`
  - Actor: `"API Consumer\n\n[Person]\nExternal client that consumes the system's APIs"`
  - External System: `"PostgreSQL\n\n[External System]\n[PostgreSQL]\nDatabase used by the system"`
  - System (C1): `"My System\n\n[Software System]\nA system description"`
  - System boundary (C2/C3 outer container): `"My System\n[Software System]"` (no type detail)
- **Sorting**: Sort all nodes (actors, containers, external systems, components) alphabetically
  by their D2 id within each diagram for deterministic output.
- **Connections**: `source_id -> target_id: "Label"` (label in double quotes).
  For cross-container edges in C3: fully qualify both sides,
  e.g. `outer_container.component_a -> outer_container.component_b: "Calls"`
- **Blank lines**: one blank line between each top-level node declaration; no blank lines
  between properties of the same node.

#### 4c. Level 1 — Context Diagram

Write to `{OUTPUT_DIR}/c1-context.d2`:

```
# C4 Context Diagram (Level 1)
# Auto-generated by diagram-docs — do not edit

<actor nodes with .class: person>

system: "<System Name>\n\n[Software System]\n<description>"
system.class: system

<external system nodes with .class: external-system>

<relationships: actors → system, system → external systems>
```

Rules:

- Actors connect TO the system with label `"Interacts with"` (or more specific if evident).
- System connects to each external system using the relationship label from the model.
- Do NOT show containers here; the whole system is one `system` box.
- Only include external systems that have at least one relationship to the system.

#### 4d. Level 2 — Container Diagram

Write to `{OUTPUT_DIR}/c2-container.d2`:

```
# C4 Container Diagram (Level 2)
# Auto-generated by diagram-docs — do not edit

<actor nodes>

system: "<System Name>\n[Software System]" {
  class: system-boundary

  <container nodes, each with .class: container>
  <each container also gets: .link: ../../<container.path>/docs/architecture/c3-component.svg>
}

<external system nodes>

<relationships between containers and external systems — use fully-qualified IDs: system.container_id>
```

Rules:

- Only include containers that participate in at least one relationship (or are the source/target
  of a cross-container dependency). If no relationships exist, include all containers.
- Cross-container relationships: `system.source_container -> system.target_container: "Label"`.
- Container → external system: `system.container_id -> external_id: "Label [Technology]"`.

#### 4e. Level 3 — Component Diagrams (one per container)

For each container, write to
`{OUTPUT_DIR}/containers/<container-id>/c3-component.d2`:

```
# C4 Component Diagram (Level 3) — <Container Name>
# Auto-generated by diagram-docs — do not edit

<container_d2_id>: "<Container Name>\n[Container: <Technology>]" {
  class: system-boundary

  <component nodes, each with .class: component>
}

<relationships between components — fully qualified: container_id.component_id>
<relationships from components to external containers or external systems — use their D2 ids>
```

Rules:

- Only show components belonging to this container.
- External containers that are referenced appear as plain nodes outside the boundary
  (not nested, just their top-level D2 id with label and `.class: container`).
- External systems appear similarly outside the boundary.

---

### Phase 5 — Write Files

Write all generated files using `write_file`. Create parent directories as needed.

Summary of files to produce:

```
{ROOT_DIR}/
├── architecture-model.yaml
└── {OUTPUT_DIR}/
    ├── styles.d2
    ├── c1-context.d2
    ├── c2-container.d2
    └── containers/
        └── <container-id>/
            └── c3-component.d2   (one per container)
```

---

### Configuration Variables

| Variable      | Default                        | Description                          |
| ------------- | ------------------------------ | ------------------------------------ |
| `ROOT_DIR`    | _(required)_                   | Absolute path to the repo root       |
| `OUTPUT_DIR`  | `{ROOT_DIR}/docs/architecture` | Where to write D2 files              |
| `SYSTEM_NAME` | _(infer from repo)_            | Override system display name         |
| `GRANULARITY` | `balanced`                     | `detailed` / `balanced` / `overview` |

---

### Quality Checklist (self-verify before writing files)

Before writing any file, verify:

- [ ] Every container in the model has at least one component
- [ ] Every relationship references IDs that exist in the model
- [ ] No two nodes share the same D2 id within a diagram
- [ ] External systems only appear if they are referenced by at least one relationship
- [ ] Component descriptions are role-aware (not just `"<name> module"` for non-trivial modules)
- [ ] Technology strings are consistent between containers and components
      (e.g., if the container says `Java / Spring Boot`, controller components say `Java REST Controller`)
- [ ] All D2 ids use underscores, not hyphens
- [ ] All string labels use `\n` (literal backslash-n), not real newlines

---

### Example: Minimal Output for a Single Java Service

Given a Spring Boot app at `services/user-api` with packages `com.example.user` (RestController)
and `com.example.repo` (Repository) using PostgreSQL:

**architecture-model.yaml** (excerpt):

```yaml
containers:
  - id: services-user-api
    name: User Api
    technology: Java / Spring Boot
    path: services/user-api
components:
  - id: services-user-api-com-example-user
    containerId: services-user-api
    name: User
    description: REST API controller for User
    technology: Java REST Controller
  - id: services-user-api-com-example-repo
    containerId: services-user-api
    name: Repo
    description: Data access layer for Repo
    technology: Java Repository
relationships:
  - sourceId: services-user-api-com-example-user
    targetId: services-user-api-com-example-repo
    label: Delegates to
  - sourceId: services-user-api
    targetId: postgresql
    label: Reads/writes data in
    technology: PostgreSQL
```

**c3-component.d2**:

```d2
# C4 Component Diagram (Level 3) — User Api
# Auto-generated by diagram-docs — do not edit

services_user_api: "User Api\n[Container: Java / Spring Boot]" {
  class: system-boundary

  services_user_api_com_example_repo: "Repo\n\n[Component: Java Repository]\nData access layer for Repo"
  services_user_api_com_example_repo.class: component
  services_user_api_com_example_user: "User\n\n[Component: Java REST Controller]\nREST API controller for User"
  services_user_api_com_example_user.class: component
}

services_user_api.services_user_api_com_example_user -> services_user_api.services_user_api_com_example_repo: "Delegates to"
```
