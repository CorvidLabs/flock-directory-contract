---
change: CHG-0003-replace-the-rollout-false-green-with-complete-flock-directory-specification-cove
artifact: context
---

# Context

The rollout configuration allowed Trust to pass with `require_coverage = 0`, while the canonical spec mapped only `package.json`. Forced SpecSync validation therefore reported zero coverage for the governed contract, bridge, dashboard, and operational scripts. The repair must describe the existing implementation accurately, raise the blocking threshold to 100 percent, and preserve product behavior.

Remote TestNet calls, browser rendering, and AlgoChat/WebSocket delivery require separately provisioned environments. This change records them as source-reviewed boundaries and does not claim they ran locally or in hosted CI.
