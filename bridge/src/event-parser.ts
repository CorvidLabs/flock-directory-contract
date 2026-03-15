/**
 * Event Parser — transforms raw indexer transactions into typed FlockEvent objects.
 *
 * Each Flock Directory app call contains an ARC-4 method selector as the first
 * application argument. The parser identifies the method, decodes the remaining
 * arguments, and produces a strongly-typed event.
 */

import type {
    FlockEvent,
    FlockTier,
    IndexerTransaction,
    MonitorState,
} from './types.js';
import {
    identifyMethod,
    decodeABIString,
    decodeABIUint64,
    decodeABIAddress,
    createBridgeLogger,
} from './utils.js';

const log = createBridgeLogger('EventParser');

/**
 * Parse a single indexer transaction into zero or more FlockEvents.
 *
 * Most transactions produce a single event, but `recordTestResult` can produce
 * both a `TestResultRecorded` and a `TierChanged` event when the agent's tier
 * changes as a result of the test.
 *
 * @param tx       The raw indexer transaction.
 * @param state    Mutable monitor state — used to track tier changes.
 * @param appId    The Flock Directory application ID (for filtering).
 */
export function parseTransaction(
    tx: IndexerTransaction,
    state: MonitorState,
    appId: number,
): FlockEvent[] {
    const appTx = tx['application-transaction'];
    if (!appTx || appTx['application-id'] !== appId) return [];

    const appArgs = appTx['application-args'];
    if (!appArgs || appArgs.length === 0) return [];

    const methodName = identifyMethod(appArgs[0]);
    if (!methodName) {
        log.debug('Unknown method selector', { txId: tx.id, selector: appArgs[0] });
        return [];
    }

    const timestamp = new Date(tx['round-time'] * 1000).toISOString();
    const round = tx['confirmed-round'];
    const sender = tx.sender;

    const events: FlockEvent[] = [];

    switch (methodName) {
        case 'registerAgent': {
            // Args: [selector, name, endpoint, metadata] (payment is a separate txn in group)
            const agentName = appArgs.length > 1 ? decodeABIString(appArgs[1]) : '';
            const endpoint = appArgs.length > 2 ? decodeABIString(appArgs[2]) : '';
            const metadata = appArgs.length > 3 ? decodeABIString(appArgs[3]) : '';

            // Determine stake from the grouped payment transaction
            let stake = 0;
            if (tx.group) {
                // The payment is in the group but we may not have it here;
                // fall back to inner txns or leave as 0
            }

            // Track this agent as Tier 1 (Registered)
            state.agentTiers.set(sender, 1);

            events.push({
                type: 'AgentRegistered',
                txId: tx.id,
                round,
                sender,
                timestamp,
                agentAddress: sender,
                agentName,
                endpoint,
                metadata,
                stake,
            });
            break;
        }

        case 'deregister': {
            const previousTier = state.agentTiers.get(sender);
            state.agentTiers.delete(sender);

            events.push({
                type: 'AgentDeregistered',
                txId: tx.id,
                round,
                sender,
                timestamp,
                agentAddress: sender,
            });
            break;
        }

        case 'adminRemoveAgent': {
            // Args: [selector, agentAddress]
            const agentAddress = appArgs.length > 1 ? decodeABIAddress(appArgs[1]) : sender;
            state.agentTiers.delete(agentAddress);

            events.push({
                type: 'AgentDeregistered',
                txId: tx.id,
                round,
                sender,
                timestamp,
                agentAddress,
            });
            break;
        }

        case 'heartbeat': {
            events.push({
                type: 'HeartbeatReceived',
                txId: tx.id,
                round,
                sender,
                timestamp,
                agentAddress: sender,
            });
            break;
        }

        case 'recordTestResult': {
            // Args: [selector, agentAddress, challengeId, score]
            const agentAddress = appArgs.length > 1 ? decodeABIAddress(appArgs[1]) : '';
            const challengeId = appArgs.length > 2 ? decodeABIString(appArgs[2]) : '';
            const score = appArgs.length > 3 ? decodeABIUint64(appArgs[3]) : 0;

            const previousTier = state.agentTiers.get(agentAddress);

            events.push({
                type: 'TestResultRecorded',
                txId: tx.id,
                round,
                sender,
                timestamp,
                agentAddress,
                challengeId,
                score,
                previousTier,
                // currentTier will be enriched by the contract monitor after reading state
            });

            // Note: TierChanged events are emitted by the contract monitor
            // after comparing pre/post state, since we need to read the
            // on-chain agent record to know the new tier.
            break;
        }

        case 'createChallenge': {
            // Args: [selector, challengeId, category, description, maxScore]
            const challengeId = appArgs.length > 1 ? decodeABIString(appArgs[1]) : '';
            const category = appArgs.length > 2 ? decodeABIString(appArgs[2]) : '';
            const description = appArgs.length > 3 ? decodeABIString(appArgs[3]) : '';
            const maxScore = appArgs.length > 4 ? decodeABIUint64(appArgs[4]) : 0;

            events.push({
                type: 'ChallengeCreated',
                txId: tx.id,
                round,
                sender,
                timestamp,
                challengeId,
                category,
                description,
                maxScore,
            });
            break;
        }

        // Methods we detect but don't emit events for (read-only or admin config)
        case 'updateAgent':
        case 'deactivateChallenge':
        case 'updateMinStake':
        case 'transferAdmin':
        case 'setRegistrationOpen':
        case 'getAgentTier':
        case 'getAgentScore':
        case 'getAgentTestCount':
        case 'getAgentInfo':
        case 'getChallengeInfo':
            log.debug('Skipping non-event method', { method: methodName, txId: tx.id });
            break;

        default:
            log.debug('Unhandled method', { method: methodName, txId: tx.id });
    }

    return events;
}

/**
 * Parse a batch of indexer transactions into events, sorted by round.
 */
export function parseTransactions(
    transactions: IndexerTransaction[],
    state: MonitorState,
    appId: number,
): FlockEvent[] {
    const allEvents: FlockEvent[] = [];

    // Sort by round to process in order
    const sorted = [...transactions].sort(
        (a, b) => a['confirmed-round'] - b['confirmed-round'],
    );

    for (const tx of sorted) {
        const events = parseTransaction(tx, state, appId);
        allEvents.push(...events);
    }

    return allEvents;
}
