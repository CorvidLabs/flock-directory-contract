/**
 * Bridge-specific types — on-chain event representations, agent state snapshots,
 * and the shared interfaces that flow between the contract monitor, event parser,
 * reputation mapper, and AlgoChat broadcaster.
 */

// ─── Flock Directory Tiers ──────────────────────────────────────────────────

export const FLOCK_TIER_REGISTERED = 1;
export const FLOCK_TIER_TESTED = 2;
export const FLOCK_TIER_ESTABLISHED = 3;
export const FLOCK_TIER_TRUSTED = 4;

export type FlockTier = 1 | 2 | 3 | 4;

export const TIER_NAMES: Record<FlockTier, string> = {
    [FLOCK_TIER_REGISTERED]: 'Registered',
    [FLOCK_TIER_TESTED]: 'Tested',
    [FLOCK_TIER_ESTABLISHED]: 'Established',
    [FLOCK_TIER_TRUSTED]: 'Trusted',
};

// ─── On-Chain Agent Record ──────────────────────────────────────────────────

export interface OnChainAgentRecord {
    name: string;
    endpoint: string;
    metadata: string;
    tier: FlockTier;
    totalScore: number;
    totalMaxScore: number;
    testCount: number;
    lastHeartbeatRound: number;
    registrationRound: number;
    stake: number;
}

// ─── On-Chain Challenge Record ──────────────────────────────────────────────

export interface OnChainChallenge {
    category: string;
    description: string;
    maxScore: number;
    active: boolean;
}

// ─── Event Types ────────────────────────────────────────────────────────────

export type FlockEventType =
    | 'AgentRegistered'
    | 'AgentDeregistered'
    | 'TestResultRecorded'
    | 'TierChanged'
    | 'HeartbeatReceived'
    | 'ChallengeCreated';

export interface FlockEventBase {
    type: FlockEventType;
    /** Transaction ID that triggered the event. */
    txId: string;
    /** Confirmed round number. */
    round: number;
    /** Sender address of the transaction. */
    sender: string;
    /** ISO-8601 timestamp (derived from round time). */
    timestamp: string;
}

export interface AgentRegisteredEvent extends FlockEventBase {
    type: 'AgentRegistered';
    agentAddress: string;
    agentName: string;
    endpoint: string;
    metadata: string;
    stake: number;
}

export interface AgentDeregisteredEvent extends FlockEventBase {
    type: 'AgentDeregistered';
    agentAddress: string;
}

export interface TestResultRecordedEvent extends FlockEventBase {
    type: 'TestResultRecorded';
    agentAddress: string;
    challengeId: string;
    score: number;
    /** Previous tier before this test (if known). */
    previousTier?: FlockTier;
    /** Current tier after this test (if known). */
    currentTier?: FlockTier;
}

export interface TierChangedEvent extends FlockEventBase {
    type: 'TierChanged';
    agentAddress: string;
    previousTier: FlockTier;
    newTier: FlockTier;
}

export interface HeartbeatReceivedEvent extends FlockEventBase {
    type: 'HeartbeatReceived';
    agentAddress: string;
}

export interface ChallengeCreatedEvent extends FlockEventBase {
    type: 'ChallengeCreated';
    challengeId: string;
    category: string;
    description: string;
    maxScore: number;
}

export type FlockEvent =
    | AgentRegisteredEvent
    | AgentDeregisteredEvent
    | TestResultRecordedEvent
    | TierChangedEvent
    | HeartbeatReceivedEvent
    | ChallengeCreatedEvent;

// ─── Reputation System Compatibility Types ──────────────────────────────────
//
// These mirror the corvid-agent reputation system types so the bridge module
// can be used standalone without importing from the corvid-agent server.
// When integrated, the host application should use its own canonical types.

export type TrustLevel = 'untrusted' | 'low' | 'medium' | 'high' | 'verified';

export interface ReputationComponents {
    /** Task completion rate (0-100). */
    taskCompletion: number;
    /** Average peer ratings (0-100). */
    peerRating: number;
    /** Credit spending patterns score (0-100). */
    creditPattern: number;
    /** Security compliance score (0-100). */
    securityCompliance: number;
    /** Activity level score (0-100). */
    activityLevel: number;
}

export interface ReputationScore {
    agentId: string;
    overallScore: number;
    trustLevel: TrustLevel;
    components: ReputationComponents;
    attestationHash: string | null;
    computedAt: string;
}

// ─── Indexer Transaction Types ──────────────────────────────────────────────

export interface IndexerTransaction {
    id: string;
    'confirmed-round': number;
    'round-time': number;
    sender: string;
    'tx-type': string;
    'application-transaction'?: {
        'application-id': number;
        'application-args'?: string[];
        'on-completion': string;
        'accounts'?: string[];
    };
    'payment-transaction'?: {
        amount: number;
        receiver: string;
    };
    'inner-txns'?: IndexerTransaction[];
    group?: string;
}

export interface IndexerSearchResponse {
    transactions: IndexerTransaction[];
    'current-round': number;
    'next-token'?: string;
}

// ─── Monitor State ──────────────────────────────────────────────────────────

export interface MonitorState {
    /** Last round we successfully processed up to. */
    lastProcessedRound: number;
    /** Tracks the previous tier for each agent address to detect tier changes. */
    agentTiers: Map<string, FlockTier>;
}
