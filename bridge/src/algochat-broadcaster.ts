/**
 * AlgoChat Broadcaster — formats Flock Directory events into human-readable
 * messages and broadcasts them through the AlgoChat network.
 *
 * The broadcaster accepts a `broadcastFn` callback from the host application,
 * which handles the actual AlgoChat message delivery. This keeps the bridge
 * decoupled from AlgoChat transport internals.
 */

import type {
    FlockEvent,
    AgentRegisteredEvent,
    AgentDeregisteredEvent,
    TestResultRecordedEvent,
    TierChangedEvent,
    HeartbeatReceivedEvent,
    ChallengeCreatedEvent,
    FlockTier,
} from './types.js';
import { TIER_NAMES } from './types.js';
import { shortenAddress, formatAlgo, createBridgeLogger } from './utils.js';

const log = createBridgeLogger('Broadcaster');

export type BroadcastFn = (message: string) => Promise<void>;

export interface BroadcasterOptions {
    /** The function that actually sends AlgoChat messages. */
    broadcastFn: BroadcastFn;
    /**
     * Event types to broadcast. Defaults to all types.
     * Set to a subset to reduce noise (e.g., skip heartbeats).
     */
    enabledEvents?: Set<FlockEvent['type']>;
    /** Whether to suppress heartbeat events from broadcast. Default: true */
    suppressHeartbeats?: boolean;
}

const ALL_EVENT_TYPES = new Set<FlockEvent['type']>([
    'AgentRegistered',
    'AgentDeregistered',
    'TestResultRecorded',
    'TierChanged',
    'HeartbeatReceived',
    'ChallengeCreated',
]);

export class AlgoChatBroadcaster {
    private broadcastFn: BroadcastFn;
    private enabledEvents: Set<FlockEvent['type']>;
    private broadcastCount = 0;
    private errorCount = 0;

    constructor(options: BroadcasterOptions) {
        this.broadcastFn = options.broadcastFn;

        if (options.enabledEvents) {
            this.enabledEvents = options.enabledEvents;
        } else {
            // Default: all events except heartbeats (too noisy)
            this.enabledEvents = new Set(ALL_EVENT_TYPES);
            if (options.suppressHeartbeats !== false) {
                this.enabledEvents.delete('HeartbeatReceived');
            }
        }
    }

    /**
     * Broadcast a batch of events. Each event is formatted and sent individually.
     * Errors on individual sends are logged but don't halt the batch.
     */
    async broadcastEvents(events: FlockEvent[]): Promise<void> {
        for (const event of events) {
            if (!this.enabledEvents.has(event.type)) {
                log.debug('Skipping disabled event type', { type: event.type });
                continue;
            }

            const message = this.formatEvent(event);
            if (!message) continue;

            try {
                await this.broadcastFn(message);
                this.broadcastCount++;
                log.debug('Broadcast sent', { type: event.type, txId: event.txId });
            } catch (err) {
                this.errorCount++;
                log.error('Broadcast failed', {
                    type: event.type,
                    txId: event.txId,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
    }

    /**
     * Get broadcast statistics.
     */
    getStats(): { broadcastCount: number; errorCount: number } {
        return {
            broadcastCount: this.broadcastCount,
            errorCount: this.errorCount,
        };
    }

    // ─── Event Formatting ───────────────────────────────────────────────────

    /**
     * Format a FlockEvent into an AlgoChat message string.
     * Returns null if the event type is not supported for formatting.
     */
    formatEvent(event: FlockEvent): string | null {
        switch (event.type) {
            case 'AgentRegistered':
                return this.formatRegistration(event);
            case 'AgentDeregistered':
                return this.formatDeregistration(event);
            case 'TestResultRecorded':
                return this.formatTestResult(event);
            case 'TierChanged':
                return this.formatTierChange(event);
            case 'HeartbeatReceived':
                return this.formatHeartbeat(event);
            case 'ChallengeCreated':
                return this.formatChallenge(event);
            default:
                return null;
        }
    }

    private formatRegistration(event: AgentRegisteredEvent): string {
        const addrShort = shortenAddress(event.agentAddress);
        const stakeStr = event.stake > 0 ? ` | Stake: ${formatAlgo(event.stake)} ALGO` : '';
        return [
            `[FLOCK] AgentRegistered: ${event.agentName} (${addrShort})`,
            `Tier: ${TIER_NAMES[1]} | Score: 0% | Tests: 0${stakeStr}`,
        ].join('\n');
    }

    private formatDeregistration(event: AgentDeregisteredEvent): string {
        const addrShort = shortenAddress(event.agentAddress);
        return `[FLOCK] AgentDeregistered: ${addrShort} has left the directory`;
    }

    private formatTestResult(event: TestResultRecordedEvent): string {
        const addrShort = shortenAddress(event.agentAddress);
        const tierName = event.currentTier ? TIER_NAMES[event.currentTier] : 'Unknown';
        return [
            `[FLOCK] TestResultRecorded: ${addrShort}`,
            `Challenge: ${event.challengeId} | Score: ${event.score}`,
            event.currentTier ? `Tier: ${tierName}` : '',
        ].filter(Boolean).join('\n');
    }

    private formatTierChange(event: TierChangedEvent): string {
        const addrShort = shortenAddress(event.agentAddress);
        const direction = event.newTier > event.previousTier ? 'promoted' : 'demoted';
        const emoji = event.newTier > event.previousTier ? '[UP]' : '[DOWN]';
        return [
            `[FLOCK] TierChanged: ${addrShort} ${emoji}`,
            `${TIER_NAMES[event.previousTier]} -> ${TIER_NAMES[event.newTier]} (${direction})`,
        ].join('\n');
    }

    private formatHeartbeat(event: HeartbeatReceivedEvent): string {
        const addrShort = shortenAddress(event.agentAddress);
        return `[FLOCK] HeartbeatReceived: ${addrShort} is alive (round ${event.round})`;
    }

    private formatChallenge(event: ChallengeCreatedEvent): string {
        return [
            `[FLOCK] ChallengeCreated: ${event.challengeId}`,
            `Category: ${event.category} | Max Score: ${event.maxScore}`,
            event.description ? `Description: ${event.description}` : '',
        ].filter(Boolean).join('\n');
    }
}
