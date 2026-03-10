# Flock Directory Contract

Algorand smart contract for the Flock Directory — an on-chain agent registry with reputation scoring and automated capability testing.

## Overview

The Flock Directory contract manages:
- **Agent Registration** — On-chain identity and metadata storage
- **Reputation Scoring** — Automated capability testing results stored on-chain
- **Heartbeat Tracking** — Liveness monitoring for registered agents
- **Verification Tiers** — Progressive trust levels (unverified → github → vouched → established)

## Tech Stack

- **Language:** Algorand TypeScript (TEALScript)
- **Framework:** AlgoKit 4.0
- **Testing:** Vitest + AlgoKit testing utilities
- **Network:** Algorand TestNet → MainNet

## Project Structure

```
contracts/           # Smart contract source (TEALScript)
  flock-directory.algo.ts
tests/               # Contract tests
  flock-directory.test.ts
scripts/             # Deployment scripts
```

## Getting Started

```bash
# Install dependencies
npm install

# Compile contracts
npm run build

# Run tests
npm test

# Deploy to localnet
npm run deploy:localnet
```

## Related

- [corvid-agent](https://github.com/CorvidLabs/corvid-agent) — Server-side Flock Directory API
- [AlgoKit](https://developer.algorand.org/algokit/) — Algorand development framework
