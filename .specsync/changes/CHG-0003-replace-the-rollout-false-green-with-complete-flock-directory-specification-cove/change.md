---
id: CHG-0003-replace-the-rollout-false-green-with-complete-flock-directory-specification-cove
state: accepted
type: bug_fix
base_commit: 3d33f52f2dc0cae012499db4648b0ceb4d0be6af
---

# Replace the rollout false-green with complete Flock Directory specification coverage and a blocking 100% Trust contract gate

## Intent

Replace the rollout false-green with complete Flock Directory specification coverage and a blocking 100% Trust contract gate

## Affected Canonical Specs

- `flock-directory`

## Acceptance Criteria

- Canonical Flock Directory specs map every governed contract, bridge, dashboard, and operational script file; requirements describe existing behavior without semantic changes; SpecSync 5.0.1 reports 100% file and LOC coverage; Trust requires 100%; native non-mutating verification passes; and all four agent integrations remain installed.

## No-spec Rationale

Not applicable
