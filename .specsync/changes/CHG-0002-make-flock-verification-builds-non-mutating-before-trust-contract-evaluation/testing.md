---
change: CHG-0002-make-flock-verification-builds-non-mutating-before-trust-contract-evaluation
artifact: testing
---

# Testing

Run `fledge lanes run verify` against the official localnet and confirm:

- the dependency-filtered typecheck policy passes;
- TEALScript compilation succeeds in `dist/verification-artifacts`;
- all 46 contract tests pass;
- `git status --short` remains unchanged after the lane; and
- `fledge trust verify` passes contract, risk, and progressive-provenance evaluation without stale delivery-input evidence.

Hosted CI is not claimed until its normal runner completes.
