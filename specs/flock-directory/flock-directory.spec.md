---
module: flock-directory
version: 3
status: active
files:
  - contracts/flock-directory.algo.ts
  - bridge/src/algochat-broadcaster.ts
  - bridge/src/config.ts
  - bridge/src/contract-monitor.ts
  - bridge/src/event-parser.ts
  - bridge/src/index.ts
  - bridge/src/query-handler.ts
  - bridge/src/reputation-mapper.ts
  - bridge/src/types.ts
  - bridge/src/utils.ts
  - dashboard/src/index.html
  - dashboard/src/main.ts
  - dashboard/src/styles.css
  - dashboard/src/app/algorand.service.ts
  - dashboard/src/app/app.config.ts
  - dashboard/src/app/app.css
  - dashboard/src/app/app.html
  - dashboard/src/app/app.ts
  - dashboard/src/app/config.ts
  - dashboard/src/app/types.ts
  - dashboard/src/app/components/agent-card/agent-card.ts
  - dashboard/src/app/components/agent-list/agent-list.ts
  - dashboard/src/app/components/challenge-list/challenge-list.ts
  - dashboard/src/app/components/header/header.ts
  - dashboard/src/app/components/reputation-chart/reputation-chart.ts
  - scripts/deploy-testnet.ts
  - scripts/register-agent.ts
  - scripts/test-runner.ts
  - scripts/test-testnet.ts
  - scripts/update-agent.ts
  - scripts/verify-artifacts.ts

db_tables: []
depends_on: []
---

# Flock Directory Contract

## Purpose

Define the existing Algorand on-chain directory for agent registration, staking, capability challenges, test results, and reputation tiers, together with its read-only bridge and dashboard consumers and explicitly authorized TestNet operations.

## Public API

### Contract Interface

The contract stores agents, challenge definitions, and per-agent test results in boxes. It exposes registration, profile update, heartbeat, deregistration, challenge administration, bounded result recording, reputation queries, stake administration, registration control, agent removal, and admin transfer.

- `FlockDirectory` is the canonical TEALScript application contract.

### Exported Symbols

| Symbol | Contract |
|--------|----------|
| `FlockDirectory` | Canonical TEALScript application contract |
| `BroadcastFn` | Asynchronous AlgoChat delivery callback |
| `BroadcasterOptions` | Event filtering and batching options |
| `AlgoChatBroadcaster` | Typed event formatter and callback broadcaster |
| `BridgeConfig` | Bridge network, polling, and callback configuration |
| `DEFAULT_CONFIG` | Documented TestNet bridge defaults |
| `loadBridgeConfig` | Override, environment, and default configuration resolver |
| `EventCallback` | Monitor batch callback |
| `ContractMonitor` | Application transaction polling lifecycle |
| `parseTransaction` | Single-transaction event decoder |
| `parseTransactions` | Ordered batch event decoder |
| `FlockBridgeOptions` | Composed bridge options |
| `FlockBridge` | Monitor, broadcast, and query composition root |
| `QueryHandler` | `/flock` command router and formatter |
| `mapToReputationScore` | Full on-chain record reputation mapper |
| `quickMapFromTierAndScore` | Partial event reputation mapper |
| `tierToTrustLevel` | Flock-tier to trust-level mapping |
| `identifyMethod` | ARC-4 selector lookup |
| `getMethodSelector` | Contract method selector lookup |
| `decodeABIString` | ABI string decoder |
| `decodeABIUint64` | ABI unsigned-integer decoder |
| `decodeABIAddress` | ABI Algorand-address decoder |
| `shortenAddress` | Display address formatter |
| `formatAlgo` | MicroALGO display formatter |
| `setLogLevel` | Bridge log-threshold setter |
| `FLOCK_TIER_REGISTERED` | Registered-tier constant |
| `FLOCK_TIER_TESTED` | Tested-tier constant |
| `FLOCK_TIER_ESTABLISHED` | Established-tier constant |
| `FLOCK_TIER_TRUSTED` | Trusted-tier constant |
| `FlockTier` | Four-value tier type |
| `TIER_NAMES` | Human-readable tier names |
| `OnChainAgentRecord` | Decoded agent box record |
| `OnChainChallenge` | Decoded challenge box record |
| `FlockEventType` | Supported event discriminants |
| `FlockEventBase` | Shared event transaction metadata |
| `AgentRegisteredEvent` | Registration event shape |
| `AgentDeregisteredEvent` | Deregistration event shape |
| `TestResultRecordedEvent` | Recorded-result event shape |
| `TierChangedEvent` | Derived tier-change event shape |
| `HeartbeatReceivedEvent` | Heartbeat event shape |
| `ChallengeCreatedEvent` | Challenge-creation event shape |
| `FlockEvent` | Complete event union |
| `TrustLevel` | Mapped trust-level union |
| `ReputationComponents` | Five reputation components |
| `ReputationScore` | Mapped reputation output |
| `IndexerTransaction` | Relevant indexer transaction shape |
| `IndexerSearchResponse` | Paginated indexer response shape |
| `MonitorState` | Poll watermark and tier cache |
| `LogLevel` | Bridge logging levels |
| `createBridgeLogger` | Component-scoped logger factory |
| `AlgorandService` | Dashboard global-state and box reader |
| `appConfig` | Angular application configuration |
| `App` | Dashboard root refresh lifecycle |
| `APP_ID` | Dashboard application identifier |
| `ALGOD_URL` | Dashboard Algod endpoint |
| `ALGOD_TOKEN` | Dashboard Algod token |
| `INDEXER_URL` | Dashboard indexer endpoint |
| `INDEXER_TOKEN` | Dashboard indexer token |
| `REFRESH_INTERVAL_MS` | Dashboard polling interval |
| `TIER_LABELS` | Dashboard tier labels |
| `TIER_COLORS` | Dashboard tier colors |
| `AgentRecord` | Dashboard agent view model |
| `Challenge` | Dashboard challenge view model |
| `TestResult` | Dashboard test-result view model |
| `GlobalState` | Dashboard global-state view model |
| `DirectoryData` | Combined dashboard snapshot |
| `AgentCardComponent` | Agent detail presentation |
| `AgentListComponent` | Agent collection presentation |
| `ChallengeListComponent` | Challenge collection presentation |
| `HeaderComponent` | Directory summary header |
| `ReputationChartComponent` | Tier distribution presentation |

### Bridge Interface

The bridge loads explicit overrides before environment variables and TestNet defaults, polls application transactions from an indexer using a round watermark, parses recognized ARC-4 calls into typed events, optionally broadcasts formatted events, and answers `/flock` queries from decoded box state. Network failures are logged or returned as user-facing errors according to each interface; they do not synthesize on-chain success.

- `BridgeConfig`, `DEFAULT_CONFIG`, and `loadBridgeConfig` define and resolve bridge configuration.
- `EventCallback` and `ContractMonitor` expose monitored event delivery and polling lifecycle.
- `BroadcastFn`, `BroadcasterOptions`, and `AlgoChatBroadcaster` expose filtered or batched message delivery through a supplied callback.
- `FlockBridgeOptions` and `FlockBridge` compose monitoring, broadcasting, and query handling.
- `QueryHandler` routes and formats `/flock` queries.
- `parseTransaction` and `parseTransactions` decode configured-application calls into ordered events.
- `mapToReputationScore`, `quickMapFromTierAndScore`, and `tierToTrustLevel` expose deterministic reputation conversion.
- `identifyMethod`, `getMethodSelector`, `decodeABIString`, `decodeABIUint64`, and `decodeABIAddress` expose ARC-4 selector and argument utilities.
- `shortenAddress` and `formatAlgo` provide display-safe address and microALGO formatting.
- `LogLevel`, `setLogLevel`, and `createBridgeLogger` define bridge logging controls.
- `FLOCK_TIER_REGISTERED`, `FLOCK_TIER_TESTED`, `FLOCK_TIER_ESTABLISHED`, `FLOCK_TIER_TRUSTED`, `FlockTier`, and `TIER_NAMES` define the four on-chain tiers.
- `OnChainAgentRecord` and `OnChainChallenge` model decoded contract boxes.
- `FlockEventType`, `FlockEventBase`, `AgentRegisteredEvent`, `AgentDeregisteredEvent`, `TestResultRecordedEvent`, `TierChangedEvent`, `HeartbeatReceivedEvent`, `ChallengeCreatedEvent`, and `FlockEvent` define the typed event union.
- `TrustLevel`, `ReputationComponents`, and `ReputationScore` define mapped reputation output.
- `IndexerTransaction`, `IndexerSearchResponse`, and `MonitorState` define indexer input and polling state.

### Dashboard Interface

The Angular dashboard decodes the contract's global state and box layouts, periodically refreshes a directory snapshot, and presents summary, agent, challenge, and reputation views. Empty, loading, and error states remain visible to the user.

- `AlgorandService` reads global state and decodes directory boxes.
- `appConfig` provides the Angular application configuration.
- `App` owns refresh lifecycle and top-level view state.
- `APP_ID`, `ALGOD_URL`, `ALGOD_TOKEN`, `INDEXER_URL`, `INDEXER_TOKEN`, and `REFRESH_INTERVAL_MS` define the dashboard's chain and refresh configuration.
- `TIER_LABELS` and `TIER_COLORS` define tier presentation metadata.
- `AgentRecord`, `Challenge`, `TestResult`, `GlobalState`, and `DirectoryData` define dashboard data shapes.
- `AgentCardComponent`, `AgentListComponent`, `ChallengeListComponent`, `HeaderComponent`, and `ReputationChartComponent` render the directory's component views.

### Operational Scripts

The deployment, registration, update, TestNet exercise, and agent endpoint test-runner scripts are five credentialed, potentially mutating operator tools. `scripts/verify-artifacts.ts` is a deterministic verifier for temporary compilation output. The Fledge-invoked Vitest suite, not `scripts/test-runner.ts`, is the local verification entry point; the test runner can contact remote agent endpoints. Pull-request verification may compile and inspect the operator scripts but must not execute TestNet mutations, remote capability endpoints, browser sessions, or WebSocket delivery.

## Invariants

1. Agent ownership and administrator authorization checks must guard their respective state-changing methods.
2. Registration requires the configured minimum stake, and deregistration or administrative removal returns stake according to the existing contract rules.
3. Test scores cannot exceed active challenge maxima, and reputation tiers derive deterministically from completed-test counts and aggregate percentages.
4. The bridge only interprets calls for the configured application, processes transactions in round order, and advances its watermark only after fetched transactions are processed.
5. Box prefixes and binary layouts used by bridge and dashboard decoders must match the contract's agent, challenge, and test-result storage layouts.
6. Reputation mapping is deterministic from tier, score totals, test count, stake, and optional heartbeat recency, with every component and overall score bounded to its documented range.
7. Generated TEAL and ARC artifacts must remain reproducible from the canonical TEALScript contract source.
8. Live TestNet deployment and remote-agent exercises remain explicitly authorized operations outside the blocking pull-request gate.

## Behavioral Examples

```
Given a registered agent completes enough active challenges at the documented score thresholds
When an authorized administrator records each result
Then the contract advances the agent to the corresponding deterministic reputation tier
```

## Error Cases

| Error | When | Behavior |
|-------|------|----------|
| Unauthorized mutation | A non-owner or non-admin calls a protected operation | Reject without changing contract state |
| Invalid stake | Registration payment is below the configured minimum | Reject registration |
| Invalid score | A result exceeds the challenge maximum | Reject the result |
| Missing record | A query or mutation targets an absent agent or challenge | Reject with the existing contract error |
| Unsupported bridge call | A transaction is not for the configured app or has an unknown method selector | Produce no Flock event |
| Unavailable chain data | A bridge query or dashboard refresh cannot read required network data | Return/log the existing error or empty result; do not report a successful mutation |

## Dependencies

- Bun and TypeScript
- TEALScript and AlgoKit localnet for compilation and integration tests
- Algorand SDK and generated ARC/TEAL artifacts
- Angular dashboard and AlgoChat bridge consumers

## Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1 | 2026-07-12 | Initial spec |
| 2 | 2026-07-14 | Map the complete contract, bridge, dashboard, and operations source surface without changing behavior |
| 3 | 2026-07-15 | CHG-0003-replace-the-rollout-false-green-with-complete-flock-directory-specification-cove: Replace the rollout false-green with complete Flock Directory specification coverage and a blocking 100% Trust contract gate |
