# Pure LLM Agent Prompt (Minimal Process): C4 Architecture Diagrams in D2

> **Variant:** Outcome-only. Process is unconstrained — the LLM decides how to read and interpret
> the codebase. Only the output format is specified exactly.
>
> **Benchmark against:** `llm-agent-c4-prompt.md` (fully prescriptive process variant).

---

## System Prompt

You are an expert software architect. Your task is to analyze a source code repository and produce
C4 architecture diagrams in D2 format. You have access to file system tools: `list_dir`,
`read_file`, and `write_file`.

Read as much of the code as you need to understand the system. Be thorough but efficient.

---

## User Prompt / Task

Analyze the repository at `{ROOT_DIR}` and produce C4 architecture diagrams in D2 format.

Explore the codebase however you see fit. Identify:

- The deployable applications/services and libraries it contains
- How they depend on each other
- What external systems they integrate with (databases, message brokers, storage, etc.)
- What kinds of users or upstream systems interact with it

Then write the files specified below. **The output format is mandatory and exact — do not deviate.**

---

### Output 1 — `{ROOT_DIR}/architecture-model.yaml`

An intermediate model capturing your understanding of the architecture. Used to generate the
diagrams. Write it before generating the D2 files.

```yaml
version: 1

system:
  name: "<human-readable system name>"
  description: "<one sentence>"

actors: # human users or external systems that initiate interactions
  - id: <kebab-case>
    name: <display name>
    description: <one sentence>

externalSystems: # infrastructure the system depends on (DBs, brokers, SaaS, etc.)
  - id: <kebab-case>
    name: <display name>
    description: <one sentence>
    technology: <technology name>
    tags: []

containers: # one per deployable unit / application / library
  - id: <kebab-case-path> # e.g. services-user-api
    applicationId: <same>
    name: <display name>
    description: <one sentence>
    technology: "<Language> / <Framework>" # e.g. "Java / Spring Boot"
    path: <relative path from ROOT_DIR>

components: # logical groupings within a container (packages, modules, layers)
  - id: <container-id>-<slug>
    containerId: <container-id>
    name: <display name>
    description: <one sentence, mention the role — e.g. "REST API controller for orders">
    technology: <specific technology — e.g. "Java REST Controller", "FastAPI Router">
    moduleIds:
      - <id>

relationships: # only relationships evidenced by actual code/imports/config
  - sourceId: <component-or-container-or-actor-id>
    targetId: <component-or-container-or-external-system-id>
    label: <verb phrase — e.g. "Reads/writes data in", "Delegates to", "Publishes to">
    technology: <optional>
```

---

### Output 2 — `{OUTPUT_DIR}/styles.d2`

Write exactly this content (no modifications):

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

---

### Output 3 — D2 Format Rules (mandatory for all generated D2 files)

**IDs:** Convert all kebab-case IDs to D2 ids — replace `-` with `_`, lowercase only.
Example: `services-user-api` → `services_user_api`

**Node label template** (use literal `\n`, not real newlines):

- Actor: `"<Name>\n\n[Person]\n<description>"`
- System (C1 box): `"<Name>\n\n[Software System]\n<description>"`
- System boundary label (C2/C3 outer): `"<Name>\n[Software System]"` or `"<Name>\n[Container: <Tech>]"`
- Container: `"<Name>\n\n[Container: <Technology>]\n<description>"`
- Component: `"<Name>\n\n[Component: <Technology>]\n<description>"`
- External system: `"<Name>\n\n[External System]\n[<Technology>]\n<description>"`

**Sorting:** Sort all nodes alphabetically by D2 id within each diagram (deterministic output).

**Connections:** `source_id -> target_id: "Label"` — label always in double quotes.
For nodes nested inside a D2 container, fully qualify: `outer.inner_a -> outer.inner_b: "Label"`

---

### Output 4 — `{OUTPUT_DIR}/c1-context.d2`

Shows actors, the system as a single box, and external systems.

```
# C4 Context Diagram (Level 1)
# Auto-generated by diagram-docs — do not edit

<actors — .class: person>

system: "<System Name>\n\n[Software System]\n<description>"
system.class: system

<external systems — .class: external-system>

<relationships>
```

---

### Output 5 — `{OUTPUT_DIR}/c2-container.d2`

Shows all containers nested inside the system boundary, plus external systems.

```
# C4 Container Diagram (Level 2)
# Auto-generated by diagram-docs — do not edit

<actors>

system: "<System Name>\n[Software System]" {
  class: system-boundary

  <containers — .class: container>
  <each container: .link: ../../<container.path>/docs/architecture/c3-component.svg>
}

<external systems>

<relationships — use system.container_id for nested nodes>
```

---

### Output 6 — `{OUTPUT_DIR}/containers/<container-id>/c3-component.d2` (one per container)

Shows components within a single container boundary.

```
# C4 Component Diagram (Level 3) — <Container Name>
# Auto-generated by diagram-docs — do not edit

<container_d2_id>: "<Container Name>\n[Container: <Technology>]" {
  class: system-boundary

  <components — .class: component>
}

<relationships — fully qualified container_d2_id.component_d2_id>
<external containers or systems referenced — as plain nodes outside the boundary>
```

---

### Configuration

| Variable      | Default                        |
| ------------- | ------------------------------ |
| `ROOT_DIR`    | _(required)_                   |
| `OUTPUT_DIR`  | `{ROOT_DIR}/docs/architecture` |
| `SYSTEM_NAME` | _(infer from repo)_            |
