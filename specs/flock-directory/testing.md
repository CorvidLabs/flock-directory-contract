---
spec: flock-directory.spec.md
---

## Test Plan

- Exercise the existing registration, authorization, challenge, scoring, tier, query, and edge-case coverage.

- Typecheck root and bridge code while retaining the existing TEALScript dependency filtering, and run the dashboard production build.
- Compile contract artifacts into the temporary verification directory, compare their content with committed artifacts while excluding only ARC-56 compiler identity metadata, and execute the Vitest suite against AlgoKit localnet.
- Do not deploy to TestNet or call remote agent endpoints from the blocking gate.
- Run released SpecSync 5.0.1 in normal and forced strict modes at the committed 100 percent threshold, and compare it with the portable 5.0.2 lifecycle validator.
- Confirm all four generated agent integrations are installed and local Trust evaluates the blocking contract threshold.
- Treat bridge network polling, dashboard browser rendering, AlgoChat/WebSocket delivery, and TestNet mutation as unexecuted unless a separately authorized environment supplies direct evidence.
