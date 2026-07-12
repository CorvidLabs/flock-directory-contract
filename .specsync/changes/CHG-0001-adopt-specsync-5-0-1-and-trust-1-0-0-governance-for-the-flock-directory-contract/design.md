---
change: CHG-0001-adopt-specsync-5-0-1-and-trust-1-0-0-governance-for-the-flock-directory-contract
artifact: design
---

# Design

Keep CI and Pages unchanged. Add a separate job named `trust` pinned to immutable Trust 1.0.0. Its setup mirrors the existing localnet runner and delegates typecheck, compilation, and tests to one Fledge lane. Use advisory contract coverage zero with a factual no-prior-threshold rationale, blocking risk, progressive provenance, and Trust-managed Atlas disabled.
