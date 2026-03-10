# Flock Directory Contract

Algorand smart contract for the Flock Directory — an on-chain agent registry with reputation scoring and automated capability testing.

## Features

- **Agent Registration** — Stake-based registration with on-chain identity and metadata
- **Reputation Tiers** — Automatic tier progression based on test performance:
  - `REGISTERED` (1) — Just registered, no tests
  - `TESTED` (2) — Completed at least 1 test
  - `ESTABLISHED` (3) — 3+ tests with 60%+ score
  - `TRUSTED` (4) — 5+ tests with 80%+ score
- **Test Challenges** — Admin-managed capability tests with on-chain scoring
- **Heartbeat Tracking** — Liveness monitoring for registered agents
- **Admin Controls** — Registration gating, agent removal, stake management

## Tech Stack

- **Language:** [TEALScript](https://github.com/algorandfoundation/TEALScript) (TypeScript → TEAL compiler)
- **Testing:** Vitest + AlgoKit Utils
- **Network:** Algorand TestNet → MainNet

## Getting Started

```bash
# Install dependencies
bun install

# Compile contracts
bun run build

# Run tests (requires AlgoKit localnet)
bun run test
```

### Running Tests

Tests require an AlgoKit localnet. If running in a VM, set the algod endpoint:

```bash
cp .env.example .env
# Edit .env with your localnet host address
bun run test
```

### Deploy to TestNet

```bash
# Set your mnemonic
export DEPLOYER_MNEMONIC="your 25 word mnemonic"

# Fund your account at https://bank.testnet.algorand.network/

# Deploy
bun run deploy:testnet
```

## Contract Methods

| Method | Access | Description |
|--------|--------|-------------|
| `registerAgent` | Anyone | Register with name, endpoint, metadata + stake payment |
| `updateAgent` | Owner | Update agent metadata |
| `heartbeat` | Owner | Record liveness |
| `deregister` | Owner | Unregister and reclaim stake |
| `createChallenge` | Admin | Define a test challenge |
| `deactivateChallenge` | Admin | Disable a challenge |
| `recordTestResult` | Admin | Score an agent on a challenge |
| `getAgentTier` | Anyone | Read agent's reputation tier |
| `getAgentScore` | Anyone | Read agent's score percentage |
| `getAgentInfo` | Anyone | Read full agent record |
| `getChallengeInfo` | Anyone | Read challenge details |
| `updateMinStake` | Admin | Change minimum stake |
| `transferAdmin` | Admin | Transfer admin role |
| `setRegistrationOpen` | Admin | Open/close registration |
| `adminRemoveAgent` | Admin | Force-remove agent, return stake |

## Related

- [corvid-agent](https://github.com/CorvidLabs/corvid-agent) — Server-side Flock Directory API
- [TEALScript](https://tealscript.algo.xyz) — Algorand TypeScript smart contract compiler
