---
change: CHG-0001-adopt-specsync-5-0-1-and-trust-1-0-0-governance-for-the-flock-directory-contract
artifact: research
---

# Research

Existing CI installs Bun and AlgoKit, starts Docker-backed localnet, filters known TEALScript dependency type errors, compiles the contract, and runs the Vitest integration suite. Pages is independently built and deployed. TestNet deployment and remote-agent scripts require credentials or live endpoints and are not normal CI checks. No prior SpecSync threshold exists.
