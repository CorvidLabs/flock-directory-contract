---
change: CHG-0003-replace-the-rollout-false-green-with-complete-flock-directory-specification-cove
artifact: research
---

# Research

The source inventory contains one TEALScript contract, nine bridge modules, fifteen dashboard HTML/CSS/TypeScript files, and five operational scripts. Contract behavior was read from `contracts/flock-directory.algo.ts`; bridge behavior was traced through configuration, monitoring, parsing, broadcasting, query, ABI utility, and reputation modules; dashboard behavior was traced through its Algorand service, root lifecycle, components, templates, and styles; script boundaries were reviewed from each executable entry point.

The existing native lane typechecks, compiles to `dist/verification-artifacts`, and runs the localnet Vitest suite. It deliberately avoids tracked artifact mutation. The repository has no blocking browser, remote TestNet, or WebSocket integration lane, so this repair does not elevate source inspection into execution evidence.
