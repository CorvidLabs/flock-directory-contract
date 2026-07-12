---
spec: flock-directory.spec.md
---

## Test Plan

- Exercise the existing registration, authorization, challenge, scoring, tier, query, and edge-case coverage.

- Typecheck project code while retaining the existing TEALScript dependency filtering.
- Compile contract artifacts and execute the Vitest suite against AlgoKit localnet.
- Do not deploy to TestNet or call remote agent endpoints from the blocking gate.
