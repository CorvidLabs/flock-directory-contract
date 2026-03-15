/**
 * Reputation Mapper — converts Flock Directory on-chain tier/score data into
 * the corvid-agent ReputationScore format.
 *
 * Mapping strategy:
 * - Flock Tier -> TrustLevel
 * - On-chain score percentage -> taskCompletion component
 * - Test count -> activityLevel component
 * - Heartbeat recency -> activityLevel boost
 * - Remaining components use sensible defaults from on-chain data
 */

import type {
    FlockTier,
    OnChainAgentRecord,
    ReputationComponents,
    ReputationScore,
    TrustLevel,
} from './types.js';
import {
    FLOCK_TIER_REGISTERED,
    FLOCK_TIER_TESTED,
    FLOCK_TIER_ESTABLISHED,
    FLOCK_TIER_TRUSTED,
} from './types.js';

// ─── Tier -> TrustLevel Mapping ─────────────────────────────────────────────

const TIER_TO_TRUST_LEVEL: Record<FlockTier, TrustLevel> = {
    [FLOCK_TIER_REGISTERED]: 'low',
    [FLOCK_TIER_TESTED]: 'medium',
    [FLOCK_TIER_ESTABLISHED]: 'high',
    [FLOCK_TIER_TRUSTED]: 'verified',
};

/**
 * Map a Flock Directory tier to the corvid-agent TrustLevel.
 */
export function tierToTrustLevel(tier: FlockTier): TrustLevel {
    return TIER_TO_TRUST_LEVEL[tier] ?? 'untrusted';
}

// ─── Score Baselines per Tier ───────────────────────────────────────────────

interface TierScoreRange {
    baseScore: number;
    maxScore: number;
}

const TIER_SCORE_RANGES: Record<FlockTier, TierScoreRange> = {
    [FLOCK_TIER_REGISTERED]: { baseScore: 15, maxScore: 30 },
    [FLOCK_TIER_TESTED]: { baseScore: 30, maxScore: 60 },
    [FLOCK_TIER_ESTABLISHED]: { baseScore: 60, maxScore: 80 },
    [FLOCK_TIER_TRUSTED]: { baseScore: 80, maxScore: 100 },
};

// ─── Component Mapping ──────────────────────────────────────────────────────

/**
 * Compute the on-chain score percentage.
 * Returns 0-100, or 0 if no tests have been taken.
 */
function computeOnChainScorePercent(record: OnChainAgentRecord): number {
    if (record.totalMaxScore === 0) return 0;
    return Math.round((record.totalScore * 100) / record.totalMaxScore);
}

/**
 * Map on-chain test data to the taskCompletion component.
 *
 * The on-chain score percentage directly maps to task completion,
 * since tests are the on-chain equivalent of task performance.
 * For agents with no tests, default to the tier baseline.
 */
function mapTaskCompletion(record: OnChainAgentRecord): number {
    const scorePercent = computeOnChainScorePercent(record);
    if (record.testCount === 0) {
        // No tests taken — use tier-based default
        return record.tier === FLOCK_TIER_REGISTERED ? 20 : 50;
    }
    return Math.min(100, scorePercent);
}

/**
 * Map test count and heartbeat recency to activityLevel.
 *
 * Base: 10 points per test, capped at 70.
 * Heartbeat recency bonus: up to 30 points based on how recently
 * the agent sent a heartbeat (relative to current round).
 */
function mapActivityLevel(
    record: OnChainAgentRecord,
    currentRound?: number,
): number {
    // Base from test count
    const testActivity = Math.min(70, record.testCount * 10);

    // Heartbeat recency bonus
    let heartbeatBonus = 0;
    if (currentRound && record.lastHeartbeatRound > 0) {
        const roundsSinceHeartbeat = currentRound - record.lastHeartbeatRound;
        // ~4.5s per round on Algorand -> 1000 rounds ~= 75 minutes
        // Full bonus if heartbeat within 1000 rounds, decaying to 0 at 10000 rounds
        if (roundsSinceHeartbeat <= 1000) {
            heartbeatBonus = 30;
        } else if (roundsSinceHeartbeat < 10000) {
            heartbeatBonus = Math.round(30 * (1 - (roundsSinceHeartbeat - 1000) / 9000));
        }
    }

    return Math.min(100, testActivity + heartbeatBonus);
}

/**
 * Derive a peer rating estimate from on-chain data.
 *
 * Since the Flock Directory doesn't have explicit peer ratings,
 * we estimate based on tier and score consistency. Higher tiers
 * with consistent scores suggest positive peer perception.
 */
function mapPeerRating(record: OnChainAgentRecord): number {
    const scorePercent = computeOnChainScorePercent(record);
    const tierBaseline: Record<FlockTier, number> = {
        [FLOCK_TIER_REGISTERED]: 40,
        [FLOCK_TIER_TESTED]: 50,
        [FLOCK_TIER_ESTABLISHED]: 65,
        [FLOCK_TIER_TRUSTED]: 80,
    };

    const base = tierBaseline[record.tier] ?? 40;

    // Blend in score performance (if any tests taken)
    if (record.testCount > 0) {
        return Math.round(base * 0.6 + scorePercent * 0.4);
    }
    return base;
}

/**
 * Security compliance derived from on-chain data.
 *
 * Agents that are registered and have passed tests demonstrate compliance.
 * Higher tiers suggest better compliance history. We start at a high baseline
 * since on-chain registration itself is a compliance signal.
 */
function mapSecurityCompliance(record: OnChainAgentRecord): number {
    const baselines: Record<FlockTier, number> = {
        [FLOCK_TIER_REGISTERED]: 70,
        [FLOCK_TIER_TESTED]: 80,
        [FLOCK_TIER_ESTABLISHED]: 90,
        [FLOCK_TIER_TRUSTED]: 95,
    };
    return baselines[record.tier] ?? 50;
}

/**
 * Credit pattern derived from stake amount.
 *
 * Agents that stake more demonstrate financial responsibility.
 * Base score of 50, with bonus for stake above minimum (1 ALGO).
 */
function mapCreditPattern(record: OnChainAgentRecord): number {
    const MIN_STAKE_MICRO = 1_000_000;
    if (record.stake <= 0) return 30;

    const stakeRatio = record.stake / MIN_STAKE_MICRO;
    // 1x stake = 50, 2x = 65, 5x = 80, 10x+ = 95
    const score = Math.min(95, 50 + Math.log2(stakeRatio) * 15);
    return Math.round(Math.max(30, score));
}

// ─── Main Mapping Function ──────────────────────────────────────────────────

/**
 * Convert a Flock Directory on-chain agent record into a ReputationScore
 * compatible with the corvid-agent reputation system.
 *
 * @param agentAddress   Algorand address of the agent (used as agentId).
 * @param record         On-chain agent data from the Flock Directory box.
 * @param currentRound   Current Algorand round (for heartbeat recency).
 */
export function mapToReputationScore(
    agentAddress: string,
    record: OnChainAgentRecord,
    currentRound?: number,
): ReputationScore {
    const components: ReputationComponents = {
        taskCompletion: mapTaskCompletion(record),
        peerRating: mapPeerRating(record),
        creditPattern: mapCreditPattern(record),
        securityCompliance: mapSecurityCompliance(record),
        activityLevel: mapActivityLevel(record, currentRound),
    };

    // Compute weighted overall score using the standard weights:
    // taskCompletion(30%), peerRating(25%), creditPattern(15%),
    // securityCompliance(20%), activityLevel(10%)
    const rawScore =
        components.taskCompletion * 0.30 +
        components.peerRating * 0.25 +
        components.creditPattern * 0.15 +
        components.securityCompliance * 0.20 +
        components.activityLevel * 0.10;

    // Clamp to tier-appropriate range
    const range = TIER_SCORE_RANGES[record.tier] ?? { baseScore: 0, maxScore: 100 };
    const overallScore = Math.round(
        Math.max(range.baseScore, Math.min(range.maxScore, rawScore)),
    );

    const trustLevel = tierToTrustLevel(record.tier);

    return {
        agentId: agentAddress,
        overallScore,
        trustLevel,
        components,
        attestationHash: null, // On-chain registration txn could serve as attestation
        computedAt: new Date().toISOString(),
    };
}

/**
 * Quick-map a Flock tier + score percentage to an approximate ReputationScore.
 * Useful when full agent record is not available (e.g., from events only).
 */
export function quickMapFromTierAndScore(
    agentAddress: string,
    tier: FlockTier,
    scorePercent: number,
    testCount: number,
): ReputationScore {
    const record: OnChainAgentRecord = {
        name: '',
        endpoint: '',
        metadata: '',
        tier,
        totalScore: scorePercent,
        totalMaxScore: 100,
        testCount,
        lastHeartbeatRound: 0,
        registrationRound: 0,
        stake: 1_000_000, // Assume minimum stake
    };
    return mapToReputationScore(agentAddress, record);
}
