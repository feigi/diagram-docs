# diagram-docs

A CLI that generates C4 architecture diagrams from source code via a three-phase pipeline (Scan → Model → Generate). The domain language below sits on top of Simon Brown's C4 model — terms are project-specific where they sharpen or disambiguate the C4 vocabulary.

## Language

### Pipeline phases

**Scan**:
Static analysis of a codebase that emits a **Raw Structure**.
_Avoid_: parse, analyze, extract (these name the action, not the phase).

**Model**:
Deterministic or agent-driven conversion of a **Raw Structure** into an **Architecture Model**.
_Avoid_: build, transform.

**Generate**:
Production of one or more diagrams from an **Architecture Model** via one or more **Emitters**.
_Avoid_: render, output, draw.

### Pipeline artifacts

**Raw Structure**:
The JSON file emitted by **Scan** — per-application **Scanned Modules**, imports, deps, and optional code-element data.
_Avoid_: scan output, raw model, intermediate JSON.

**Architecture Model**:
The YAML file that bridges **Scan** and **Generate**: one system, **Containers**, **Components**, **External Systems**, **Actors**, **Code Elements**, and the relationships between them.
_Avoid_: arch model, c4 model file.

### C4 entities

**Container**:
A C4 Level 2 entity: a deployable/runnable unit (process, service, datastore, frontend) inside the system.

**Component**:
A C4 Level 3 entity: a logical grouping of related code inside a **Container**.
_Avoid_: module (reserved for **Scanned Module**), service, package.

**Code Element**:
A C4 Level 4 entity: a class, interface, function, struct, or enum inside a **Component**.

**Actor**:
A person or role that interacts with the system. Always rendered outside the system boundary.

**External System**:
An out-of-scope system the target system depends on. Tagged `library` when it's an in-process dependency rather than a remote service.

### Generate-side concepts

**Projection**:
A pure function that takes an **Architecture Model** plus a C4 level (and a container or component id when scoped) and returns a structured `{vertices, edges}` spec. Owns filtering, edge deduplication, and id-resolution rules. Owns no syntax. Consumed identically by every **Emitter**.
_Avoid_: resolver, builder, mapper, layout.

**Emitter**:
A backend that converts a **Projection** into concrete diagram syntax. Two today: D2 (text) and drawio (mxGraph XML).

### Scan-side terms

**Application**:
A discovered project unit, identified by a build file (`pom.xml`, `package.json`, etc.). One **Scan** may yield many.
_Avoid_: project, repo.

**Scanned Module**:
A language-analyzer-extracted unit inside an **Application** — a Java package, a TypeScript file group, a Python module. Pre-aggregation, pre-naming. Aggregated into a **Component** during **Model**.
_Avoid_: bare "module" (ambiguous with the architecture-skill sense).

## Relationships

- A **Scan** produces one **Raw Structure**.
- A **Raw Structure** + config produces one **Architecture Model** via **Model**.
- An **Architecture Model** + a C4 level produces one **Projection**.
- A **Projection** + an **Emitter** produces one diagram.
- An **Architecture Model** has one system, many **Containers**, many **Components** (each in one **Container**), zero or more **Code Elements** (each in one **Component**), zero or more **Actors** and **External Systems**.
- A **Component** belongs to exactly one **Container**.
- A **Code Element** belongs to exactly one **Component**.

## Example dialogue

> **Dev:** "When the L1 **Projection** sees a relationship between two **External Systems**, does it surface that edge?"
> **Domain expert:** "No — L1 documents how **Actors** and **External Systems** interact with the target system. External-to-external edges scatter the layout and add no information at this level. The **Projection** drops them; the **Emitter** never sees them."
> **Dev:** "And if a **Component** depends on an **External System**?"
> **Domain expert:** "The **Projection** rewrites the source to the system at L1 and dedupes — many component-to-external edges collapse into one system-to-external edge."

## Flagged ambiguities

- "module" — used both for **Scanned Module** (scan output) and the architecture-skill sense ("anything with an interface and an implementation"). Prefix the scan sense as **Scanned Module** when the architecture sense is also in play.
- "library" — a tag on **External System**, not a separate kind. Do not introduce a Library kind unless promotion buys something structural.
- "build" / "render" — avoid. Use **Generate** for the phase, **Emitter** for the syntax-producing module.
