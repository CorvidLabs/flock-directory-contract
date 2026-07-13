---
id: CHG-0002-make-flock-verification-builds-non-mutating-before-trust-contract-evaluation
state: implementing
type: bug_fix
base_commit: 3e6524beb64410195892091086244b84990c1ef4
---

# Make Flock verification builds non-mutating before Trust contract evaluation

## Intent

Make Flock verification builds non-mutating before Trust contract evaluation

## Affected Canonical Specs

- None

## Acceptance Criteria

- The verification lane compiles TEALScript into an ignored workspace, leaves tracked files unchanged, passes 46 localnet contract tests, and allows Trust contract validation to observe the same delivery inputs that received closing approval.

## No-spec Rationale

The verification lane redirects generated TEALScript artifacts to an ignored workspace without changing the contract, committed release artifacts, or canonical requirement semantics.
