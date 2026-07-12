---
module: flock-directory
version: 1
status: active
files:
  - package.json

db_tables: []
depends_on: []
---

# Flock Directory Contract

## Purpose

Define the existing Algorand on-chain directory for agent registration, staking, capability challenges, test results, and reputation tiers, together with its bridge and dashboard consumers.

## Public API

### Contract Interface

The contract exposes registration, profile update, heartbeat, deregistration, challenge administration, test-result recording, reputation queries, stake administration, and admin-transfer operations described in the repository README and generated ARC artifacts.

## Invariants

1. Agent ownership and administrator authorization checks must guard their respective state-changing methods.
2. Registration requires the configured minimum stake, and deregistration or administrative removal returns stake according to the existing contract rules.
3. Test scores cannot exceed challenge maxima, and reputation tiers derive deterministically from completed-test counts and aggregate percentages.
4. Generated TEAL and ARC artifacts must remain reproducible from the canonical TEALScript contract source.
5. Live TestNet deployment and remote-agent exercises remain explicitly authorized operations outside the blocking pull-request gate.

## Behavioral Examples

```
Given a registered agent completes enough active challenges at the documented score thresholds
When an authorized administrator records each result
Then the contract advances the agent to the corresponding deterministic reputation tier
```

## Error Cases

| Error | When | Behavior |
|-------|------|----------|
| Unauthorized mutation | A non-owner or non-admin calls a protected operation | Reject without changing contract state |
| Invalid stake | Registration payment is below the configured minimum | Reject registration |
| Invalid score | A result exceeds the challenge maximum | Reject the result |
| Missing record | A query or mutation targets an absent agent or challenge | Reject with the existing contract error |

## Dependencies

- Bun and TypeScript
- TEALScript and AlgoKit localnet for compilation and integration tests
- Algorand SDK and generated ARC/TEAL artifacts
- Angular dashboard and AlgoChat bridge consumers

## Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1 | 2026-07-12 | Initial spec |
