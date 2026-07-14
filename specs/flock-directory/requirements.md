---
spec: flock-directory.spec.md
---

## Requirements

- **REQ-flock-directory-001** (stable): Application creation shall set the creator as administrator, set the minimum stake to one ALGO, open registration, and initialize agent and challenge counts to zero.
- **REQ-flock-directory-002** (stable): Registration shall require registration to be open, a payment to the application of at least the configured minimum, and no existing record for the sender; the stored record shall begin at Registered tier with zero results and the current registration and heartbeat round.
- **REQ-flock-directory-003** (stable): An existing agent owner shall be able to replace name, endpoint, and metadata without changing stake, score totals, tier, test count, or registration and heartbeat rounds.
- **REQ-flock-directory-004** (stable): An existing agent owner shall be able to update only the last-heartbeat round to the current round.
- **REQ-flock-directory-005** (stable): Owner deregistration and administrator removal shall delete the agent, decrement the agent count, and return the recorded stake to that agent address.
- **REQ-flock-directory-006** (stable): Only the administrator shall create a uniquely identified active challenge, preserving category, description, and maximum score and incrementing the challenge count.
- **REQ-flock-directory-007** (stable): Only the administrator shall deactivate an existing challenge, preserving its category, description, and maximum score.
- **REQ-flock-directory-008** (stable): Only the administrator shall record a result for an existing agent and active challenge, and the score shall not exceed that challenge's maximum.
- **REQ-flock-directory-009** (stable): Recording a result shall persist its score, maximum, category, and round and add those score values and one test to the agent aggregates.
- **REQ-flock-directory-010** (stable): Tier calculation shall return Registered for zero tests, Trusted for at least five tests and at least 80 percent, Established for at least three tests and at least 60 percent, and Tested otherwise.
- **REQ-flock-directory-011** (stable): Agent, tier, score-percentage, test-count, and challenge queries shall reject missing records; score percentage shall be zero when total maximum score is zero.
- **REQ-flock-directory-012** (stable): Only the current administrator shall change minimum stake, registration-open state, or administrator address.
- **REQ-flock-directory-013** (stable): Bridge configuration shall resolve explicit overrides before environment values and documented TestNet defaults, including application ID, node endpoints, API tokens, poll interval, lookback, and optional callbacks.
- **REQ-flock-directory-014** (stable): The contract monitor shall cold-start from the configured lookback, paginate configured-application indexer queries from the next unprocessed round, process transactions in round order, and retain a monotonically advancing processed-round watermark.
- **REQ-flock-directory-015** (stable): Monitor polling shall isolate fetch, decode, tier-enrichment, and callback failures through existing logging and return behavior, and stopping shall clear its recurring timer.
- **REQ-flock-directory-016** (stable): Event parsing shall ignore other applications, empty arguments, and unknown selectors and shall decode recognized registration, deregistration, heartbeat, result, and challenge calls into their typed event shapes.
- **REQ-flock-directory-017** (stable): A recorded-result event shall be enriched with the current box tier when readable and shall produce a TierChanged event only when a cached previous tier exists and differs.
- **REQ-flock-directory-018** (stable): AlgoChat broadcasting shall format supported event types, honor configured filters and batching, and deliver only through the supplied asynchronous broadcast callback.
- **REQ-flock-directory-019** (stable): `/flock` query routing shall reject non-Flock messages, validate status addresses, and provide status, score-sorted top-ten leaderboard, active/inactive challenge, help, and error responses from decoded chain data.
- **REQ-flock-directory-020** (stable): Bridge ABI helpers shall map the contract's method signatures to selectors and decode ABI strings, uint64 values, and addresses consistently with the generated contract interface.
- **REQ-flock-directory-021** (stable): Reputation mapping shall deterministically derive trust level and bounded task, peer, credit, security, activity, and tier-constrained overall scores from an on-chain agent record.
- **REQ-flock-directory-022** (stable): Dashboard decoding shall interpret the contract's agent, challenge, test-result, and global-state binary layouts and box prefixes and return a single directory snapshot.
- **REQ-flock-directory-023** (stable): The dashboard shall refresh on initialization and its configured interval, cancel the interval on destruction, and expose loading, empty, summary, error, agent, challenge, and reputation presentation states through its components and templates.
- **REQ-flock-directory-024** (stable): TestNet deployment, registration, update, and exercise scripts shall require operator credentials and explicit invocation and shall target the configured TestNet application or deployment flow rather than run in the blocking pull-request gate.
- **REQ-flock-directory-025** (stable): The native verification lane shall typecheck root and bridge source, build the dashboard, compile the canonical TEALScript contract into a temporary verification directory, and execute the existing localnet suite without mutating tracked artifacts.
- **REQ-flock-directory-026** (stable): Blocking verification shall not deploy to TestNet, submit remote application calls, contact remote agent endpoints, open browser sessions, or claim WebSocket delivery; those behaviors remain source-reviewed or separately authorized integration evidence.
- **REQ-flock-directory-027** (stable): Verification shall compare newly compiled approval, clear, source-map, and ARC artifacts with committed artifacts, ignoring only the local Algod compiler identity embedded in ARC-56 metadata.

## Constraints

- Contract integration tests require Docker-backed AlgoKit localnet.
- Deployment and remote capability tests require separately supplied credentials and authorization.
- Dashboard browser rendering, bridge polling, and AlgoChat/WebSocket delivery require separately provisioned network or browser integration environments.

## Out of Scope

- Changing contract methods, deployed application state, reputation formulas, or public dashboard behavior.
- Claiming that source review proves remote TestNet, browser, or WebSocket execution.
