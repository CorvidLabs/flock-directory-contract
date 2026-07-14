---
change: CHG-0003-replace-the-rollout-false-green-with-complete-flock-directory-specification-cove
artifact: testing
---

# Testing

- Run `fledge lanes run verify` for root and bridge TypeScript checking, dashboard production build, temporary TEALScript compilation, committed-artifact comparison, and the existing localnet Vitest suite.
- Run portable SpecSync 5.0.2 and released SpecSync 5.0.1 with strict forced coverage at 100 percent; also run released 5.0.1 without force because that is the hosted Trust contract path.
- Run `specsync agents status`, `fledge trust doctor`, and `fledge trust verify`.
- Confirm the diff contains governance and specification content only and has no runtime, test, generated artifact, lockfile, or dependency changes.
- Do not claim TestNet mutation, remote-agent requests, browser rendering, or AlgoChat/WebSocket delivery without separate direct evidence.
