---
spec: flock-directory.spec.md
---

## Requirements

- **REQ-flock-directory-001** (stable): The contract shall register, update, heartbeat, and deregister agents while enforcing ownership and minimum-stake rules.
- **REQ-flock-directory-002** (stable): Authorized administrators shall manage challenges and record bounded results used to derive deterministic reputation tiers.
- **REQ-flock-directory-003** (stable): Public read methods and generated ARC artifacts shall expose existing agent, challenge, score, tier, and test-count data consistently.
- **REQ-flock-directory-004** (stable): The native verification lane shall typecheck, compile, and execute the existing localnet integration suite without performing TestNet mutations or remote-agent calls.

## Constraints

- Contract integration tests require Docker-backed AlgoKit localnet.
- Deployment and remote capability tests require separately supplied credentials and authorization.

## Out of Scope

- Changing contract methods, deployed application state, reputation formulas, or public dashboard behavior.
