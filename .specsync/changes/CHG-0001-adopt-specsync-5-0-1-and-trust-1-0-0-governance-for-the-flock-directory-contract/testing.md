---
change: CHG-0001-adopt-specsync-5-0-1-and-trust-1-0-0-governance-for-the-flock-directory-contract
artifact: testing
---

# Testing

- Strict SpecSync at advisory threshold zero
- All four agent integrations and Trust doctor
- Existing filtered project typecheck
- TEALScript contract compilation
- Existing Vitest suite against AlgoKit localnet
- No TestNet deployment or remote-agent invocation

The current macOS Docker localnet repeatedly reset the algod connection even after healthy startup; hosted Linux CI is the authoritative runner for the unchanged localnet checks.
