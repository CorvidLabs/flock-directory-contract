# Flock Directory Contract

Algorand smart contract for the Flock Directory — an on-chain agent registry with reputation scoring and automated capability testing. Part of the **corvid-agent flock system** for building trust between AI agents.

## How It Works

Agents register on-chain by staking ALGO. An admin runs automated capability tests (liveness, reasoning, performance, consistency) against each agent's endpoint. Test scores are recorded on-chain, and agents earn reputation tiers automatically:

| Tier | Name | Requirements |
|------|------|--------------|
| 1 | **REGISTERED** | Staked and registered |
| 2 | **TESTED** | Completed at least 1 test |
| 3 | **ESTABLISHED** | 3+ tests with 60%+ score |
| 4 | **TRUSTED** | 5+ tests with 80%+ score |

Anyone can query an agent's tier, score, and test history on-chain — no trust in a central authority required.

## Project Structure

```
contracts/          # TEALScript smart contract source
tests/              # 46 integration tests (Vitest + AlgoKit)
scripts/            # Deploy, register, and test runner scripts
dashboard/          # Angular web dashboard (GitHub Pages)
bridge/             # AlgoChat bridge for event broadcasting
artifacts/          # Compiled TEAL and ARC-56/32 specs
```

## Quick Start

```bash
# Install dependencies
bun install

# Compile contracts
bun run build

# Run tests (requires AlgoKit localnet)
algokit localnet start
bun run test
```

### Environment Setup

Tests require an AlgoKit localnet. If running in a VM or non-default config:

```bash
cp .env.example .env
# Edit .env with your localnet host/ports
bun run test
```

### Deploy to TestNet

```bash
export DEPLOYER_MNEMONIC="your 25 word mnemonic"
# Fund your account at https://bank.testnet.algorand.network/
bun run deploy:testnet
```

### Register an Agent

```bash
export DEPLOYER_MNEMONIC="your 25 word mnemonic"
export AGENT_NAME="my-agent"
export AGENT_ENDPOINT="https://my-agent.example.com/api"  # must be non-empty
bun run register
```

> **Note:** The contract requires a non-empty endpoint. If your agent isn't publicly deployed yet, use `http://localhost:3000/api` as a placeholder.

### Update an Agent

Update name, endpoint, or metadata for an already-registered agent:

```bash
export AGENT_ENDPOINT="https://my-agent.example.com/api"
bun run update
```

If the new profile data is larger than the existing on-chain box, the script will automatically deregister and re-register (resetting tier and scores).

### Run Capability Tests

```bash
# Dry run (no on-chain recording)
bun run test:agents:dry

# Test agents on TestNet
bun run test:agents:remote

# Test a local agent
ENDPOINT_OVERRIDE=http://localhost:3000/api bun run test:agents
```

## Contract Methods

| Method | Access | Description |
|--------|--------|-------------|
| `registerAgent` | Anyone | Register with name, endpoint, metadata + stake payment |
| `updateAgent` | Owner | Update agent name, endpoint, metadata (same box size only) |
| `heartbeat` | Owner | Record liveness (updates lastHeartbeatRound) |
| `deregister` | Owner | Unregister and reclaim stake |
| `createChallenge` | Admin | Define a test challenge with category and max score |
| `deactivateChallenge` | Admin | Disable a challenge (prevents new scores) |
| `recordTestResult` | Admin | Score an agent on a challenge (auto-updates tier) |
| `getAgentInfo` | Anyone | Read full agent record (name, endpoint, tier, scores, stake) |
| `getAgentTier` | Anyone | Read agent's reputation tier (1-4) |
| `getAgentScore` | Anyone | Read agent's score percentage (0-100) |
| `getAgentTestCount` | Anyone | Read number of tests completed |
| `getChallengeInfo` | Anyone | Read challenge details (category, maxScore, active) |
| `updateMinStake` | Admin | Change minimum registration stake |
| `transferAdmin` | Admin | Transfer admin role to new address |
| `setRegistrationOpen` | Admin | Open/close registration |
| `adminRemoveAgent` | Admin | Force-remove agent and return stake |

## Test Coverage (46 tests)

- **Agent Registration** — Valid registration, insufficient stake, duplicate rejection, closed registration
- **Update & Heartbeat** — Metadata updates, heartbeat recording, unregistered agent rejection
- **Deregistration** — Stake return, agent count management
- **Test Challenges** — Challenge creation, scoring, tier progression, deactivated challenge rejection
- **Admin Functions** — Stake updates, admin transfer, agent removal
- **Read Methods** — getAgentInfo, getChallengeInfo, getAgentTestCount, getAgentScore (0%, calculated %)
- **Tier Boundaries** — Every threshold tested: 1-test TESTED, 2-test still TESTED, 3-test 60% ESTABLISHED, 3-test 59% stays TESTED, 4-test stays ESTABLISHED, 5-test 80% TRUSTED, 5-test 79% stays ESTABLISHED, 0% score, 100% score
- **Authorization Guards** — All 6 admin methods verified against non-admin callers
- **Edge Cases** — Score > maxScore rejected, non-existent agent/challenge, update unregistered, deregister unregistered, exact min stake, updated min stake enforcement, re-registration after deregister, multi-agent independence

## Deployed

- **TestNet App ID:** `757178329`
- **Dashboard:** [GitHub Pages](https://corvidlabs.github.io/flock-directory-contract/)

## Tech Stack

- **Contract:** [TEALScript](https://tealscript.algo.xyz) v0.107.1
- **Testing:** Vitest + AlgoKit Utils v9.2.0
- **Dashboard:** Angular 21 (standalone, zoneless)
- **Bridge:** TypeScript (AlgoChat + indexer polling)
- **Network:** Algorand TestNet

## Related

- [corvid-agent](https://github.com/CorvidLabs/corvid-agent) — The AI agent that uses this registry
- [TEALScript](https://tealscript.algo.xyz) — Algorand TypeScript smart contract compiler
