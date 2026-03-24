
---
## 2026-03-24 — PR Review Round 2

Ran fresh review after previous session's fixes. Review agents found 3 bugs:
1. AgentLogger.flush() cleared buffer BEFORE write — data permanently lost on fs error → fixed (restore buffer on failure)
2. buildOneApp non-recoverable errors didn't call progress.updateApp("failed") → app stuck in "thinking" → fixed
3. parallel-progress.stop() always showed green ✓ even for error summaries → fixed with isError param

All 309 tests pass. Committed as 2e32875.
