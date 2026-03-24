# PR Review Session - 2026-03-24

## Branch: feat/parallel-agent-ui

### Issues Found by Review Agents

**Code Reviewer:**
1. Inverted dependency: src/core imports src/cli (architectural concern - skip for now, needs discussion)
2. AgentLogger.logProgress fire-and-forgets flush() Promise
3. truncate() uses raw string length, not ANSI-aware width

**Silent Failure Hunter:**
4. fs.rmSync/mkdirSync outside try-catch (misleading errors)
5. AgentLogger.flush() swallows write errors silently (related to #2)
6. TTY cursor not restored on stop() error path in parallel-progress.ts
7. updateApp silently drops unknown app IDs in TTY mode
8. Synthesis frame double-stop on recoverable error path
9. model.ts catch block doesn't stop frame on error
10. synthesisFrame dangling (INVALID: synthesisFrame created after the risky code)

**Test Analyzer:**
- Various test coverage gaps (secondary, not blocking)

### Fix Plan

Fix these in logical commits:
1. AgentLogger: make flush() synchronous (fixes #2 and #5)
2. terminal-utils: fix truncate() ANSI-awareness (#3)
3. parallel-progress.ts: warn on unknown appId in TTY mode (#7) + cursor restore fix (#6)
4. model.ts: stop frame on error (#9)
5. parallel-model-builder.ts: synthesis frame double-stop (#8) + fs ops try-catch (#4)

Skip: architectural inversion (#1) - requires major refactor, separate PR
Skip: synthesisFrame dangling (#10) - INVALID, synthesisFrame created after risky code

### Status
Starting with Task 1: AgentLogger fix
