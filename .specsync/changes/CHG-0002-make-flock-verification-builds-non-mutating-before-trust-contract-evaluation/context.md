---
change: CHG-0002-make-flock-verification-builds-non-mutating-before-trust-contract-evaluation
artifact: context
---

# Context

Trust runs the native verification lane before validating the accepted delivery-input digest. The existing lane compiled TEALScript into tracked `artifacts/`; Linux output can differ from the committed macOS-generated files even when the contract is semantically identical. That made a successful test run invalidate its own accepted evidence.

The product build remains unchanged. Only the verification lane writes compiler output to the already ignored `dist/verification-artifacts` directory so contract evaluation sees an unmodified checkout.
