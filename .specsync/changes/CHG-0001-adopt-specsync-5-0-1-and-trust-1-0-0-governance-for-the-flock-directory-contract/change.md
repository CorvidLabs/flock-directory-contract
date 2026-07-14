---
id: CHG-0001-adopt-specsync-5-0-1-and-trust-1-0-0-governance-for-the-flock-directory-contract
state: verifying
type: migration
base_commit: 3dfc1800ed8dcf32be7fa8967ce64796c90ea1e6
---

# Adopt SpecSync 5.0.1 and Trust 1.0.0 governance for the Flock Directory contract

## Intent

Adopt SpecSync 5.0.1 and Trust 1.0.0 governance for the Flock Directory contract

## Affected Canonical Specs

- None

## Acceptance Criteria

- Strict SpecSync passes at advisory threshold 0; all four agent integrations are installed; Trust doctor passes; project typecheck, contract compilation, and existing integration tests pass on the normal hosted localnet runner

## No-spec Rationale

This governance-only migration assigns stable requirement IDs and configures SpecSync and Trust without changing the Flock Directory contract, bridge, dashboard, or existing requirement semantics.
