---
spec: flock-directory.spec.md
---

## Context

The repository combines a security-sensitive Algorand contract, generated artifacts, integration tests, operational scripts, an event bridge, and a Pages dashboard. Governance must cover changes without turning live TestNet deployment or remote-agent calls into implicit CI behavior.

## Related Modules

- Generated ARC and TEAL artifacts consumed by clients.
- The bridge and dashboard packages that read directory state.

## Design Decisions

- Preserve AlgoKit localnet as the blocking deterministic integration environment.
- Keep TestNet deployment and remote agent testing independently authorized.
- Keep standalone Pages deployment outside Trust-managed Atlas.
