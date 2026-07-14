---
change: CHG-0003-replace-the-rollout-false-green-with-complete-flock-directory-specification-cove
artifact: design
---

# Design

Use the existing `flock-directory` canonical module as the authority for the complete governed source surface. Map every contract, bridge, dashboard, and script source file in frontmatter, then split the previous four broad statements into stable requirements that describe observable invariants at contract, bridge, dashboard, operations, and verification boundaries.

Set Trust contract coverage to 100 and remove its obsolete zero-coverage explanation. Make canonical specs and governance configuration meaningful lifecycle paths, with no broad `.specsync/` or `specs/` bypass. Extend the Fledge lane to typecheck the bridge, build the dashboard, and compare temporary compilation output with committed artifacts while excluding only environment-specific Algod compiler identity. Do not modify runtime, tests, generated contract artifacts, dependencies, or public interfaces.
