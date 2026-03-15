/**
 * Contract Monitor — polls the Algorand indexer for new Flock Directory
 * transactions and emits typed events through a callback interface.
 *
 * The monitor maintains a `lastProcessedRound` watermark and only fetches
 * transactions confirmed after that round. On cold start, it looks back
 * a configurable number of rounds to catch up on recent activity.
 */

import algosdk from 'algosdk';
import type { BridgeConfig } from './config.js';
import type {
    FlockEvent,
    FlockTier,
    IndexerSearchResponse,
    MonitorState,
    OnChainAgentRecord,
    TierChangedEvent,
    TestResultRecordedEvent,
} from './types.js';
import { parseTransactions } from './event-parser.js';
import { createBridgeLogger } from './utils.js';

const log = createBridgeLogger('ContractMonitor');

export type EventCallback = (events: FlockEvent[]) => void | Promise<void>;

export class ContractMonitor {
    private config: BridgeConfig;
    private algod: algosdk.Algodv2;
    private state: MonitorState;
    private eventCallbacks: Set<EventCallback> = new Set();
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private running = false;

    constructor(config: BridgeConfig) {
        this.config = config;
        this.algod = new algosdk.Algodv2(config.algodToken, config.algodUrl, '');
        this.state = {
            lastProcessedRound: 0,
            agentTiers: new Map(),
        };
    }

    /**
     * Register a callback to receive batches of events after each poll cycle.
     * Returns an unsubscribe function.
     */
    onEvents(callback: EventCallback): () => void {
        this.eventCallbacks.add(callback);
        return () => { this.eventCallbacks.delete(callback); };
    }

    /**
     * Start the polling loop. Performs an initial catch-up poll, then
     * schedules recurring polls at the configured interval.
     */
    async start(): Promise<void> {
        if (this.running) return;
        this.running = true;

        log.info('Starting contract monitor', {
            appId: this.config.appId,
            pollInterval: this.config.pollIntervalMs,
        });

        // Determine starting round
        try {
            const status = await this.algod.status().do();
            const currentRound = Number(status.lastRound);
            this.state.lastProcessedRound = Math.max(
                0,
                currentRound - this.config.coldStartLookbackRounds,
            );
            log.info('Cold start catch-up', {
                currentRound,
                startingFrom: this.state.lastProcessedRound,
            });
        } catch (err) {
            log.warn('Failed to get current round, starting from 0', {
                error: err instanceof Error ? err.message : String(err),
            });
        }

        // Initial poll
        await this.poll();

        // Schedule recurring polls
        this.pollTimer = setInterval(() => {
            this.poll().catch((err) => {
                log.error('Poll cycle failed', {
                    error: err instanceof Error ? err.message : String(err),
                });
            });
        }, this.config.pollIntervalMs);
    }

    /**
     * Stop the polling loop and clean up.
     */
    stop(): void {
        this.running = false;
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
        log.info('Contract monitor stopped');
    }

    /**
     * Get the current monitor state (for persistence or debugging).
     */
    getState(): Readonly<MonitorState> {
        return this.state;
    }

    /**
     * Force a manual poll cycle. Useful for testing or on-demand refresh.
     */
    async poll(): Promise<FlockEvent[]> {
        const minRound = this.state.lastProcessedRound + 1;

        try {
            const transactions = await this.fetchTransactions(minRound);

            if (transactions.length === 0) {
                log.debug('No new transactions', { minRound });
                return [];
            }

            log.info('Fetched transactions', {
                count: transactions.length,
                minRound,
            });

            // Parse transactions into events
            const events = parseTransactions(
                transactions,
                this.state,
                this.config.appId,
            );

            // Enrich test result events with tier change detection
            const enrichedEvents = await this.enrichWithTierChanges(events);

            // Update watermark to the highest round we processed
            const maxRound = Math.max(
                ...transactions.map((tx) => tx['confirmed-round']),
            );
            this.state.lastProcessedRound = maxRound;

            // Notify callbacks
            if (enrichedEvents.length > 0) {
                log.info('Emitting events', {
                    count: enrichedEvents.length,
                    types: enrichedEvents.map((e) => e.type),
                });

                for (const callback of this.eventCallbacks) {
                    try {
                        await callback(enrichedEvents);
                    } catch (err) {
                        log.error('Event callback failed', {
                            error: err instanceof Error ? err.message : String(err),
                        });
                    }
                }
            }

            return enrichedEvents;
        } catch (err) {
            log.error('Failed to fetch/process transactions', {
                error: err instanceof Error ? err.message : String(err),
                minRound,
            });
            return [];
        }
    }

    // ─── Private ────────────────────────────────────────────────────────────

    /**
     * Fetch application transactions from the indexer starting from minRound.
     * Handles pagination via next-token.
     */
    private async fetchTransactions(
        minRound: number,
    ): Promise<IndexerSearchResponse['transactions']> {
        const allTransactions: IndexerSearchResponse['transactions'] = [];
        let nextToken: string | undefined;
        const limit = 100;

        do {
            const url = new URL(`${this.config.indexerUrl}/v2/transactions`);
            url.searchParams.set('application-id', String(this.config.appId));
            url.searchParams.set('min-round', String(minRound));
            url.searchParams.set('limit', String(limit));
            if (nextToken) {
                url.searchParams.set('next', nextToken);
            }

            const headers: Record<string, string> = {};
            if (this.config.indexerToken) {
                headers['X-Algo-API-Token'] = this.config.indexerToken;
            }

            const response = await fetch(url.toString(), {
                headers,
                signal: AbortSignal.timeout(30_000),
            });

            if (!response.ok) {
                throw new Error(
                    `Indexer request failed: ${response.status} ${response.statusText}`,
                );
            }

            const data = (await response.json()) as IndexerSearchResponse;
            allTransactions.push(...(data.transactions ?? []));
            nextToken = data['next-token'];
        } while (nextToken);

        return allTransactions;
    }

    /**
     * For TestResultRecorded events, read the agent's current on-chain tier
     * and emit TierChanged events if the tier differs from the cached value.
     */
    private async enrichWithTierChanges(
        events: FlockEvent[],
    ): Promise<FlockEvent[]> {
        const enriched: FlockEvent[] = [];

        for (const event of events) {
            enriched.push(event);

            if (event.type === 'TestResultRecorded') {
                const testEvent = event as TestResultRecordedEvent;
                const previousTier = testEvent.previousTier;

                // Try to read the agent's current tier from the box
                try {
                    const currentTier = await this.readAgentTier(testEvent.agentAddress);
                    if (currentTier !== null) {
                        testEvent.currentTier = currentTier;

                        // Emit TierChanged if we have a previous tier and it changed
                        if (previousTier !== undefined && previousTier !== currentTier) {
                            const tierChangedEvent: TierChangedEvent = {
                                type: 'TierChanged',
                                txId: testEvent.txId,
                                round: testEvent.round,
                                sender: testEvent.sender,
                                timestamp: testEvent.timestamp,
                                agentAddress: testEvent.agentAddress,
                                previousTier,
                                newTier: currentTier,
                            };
                            enriched.push(tierChangedEvent);

                            log.info('Tier change detected', {
                                agent: testEvent.agentAddress,
                                from: previousTier,
                                to: currentTier,
                            });
                        }

                        // Update cached tier
                        this.state.agentTiers.set(testEvent.agentAddress, currentTier);
                    }
                } catch (err) {
                    log.debug('Could not read agent tier for enrichment', {
                        agent: testEvent.agentAddress,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
        }

        return enriched;
    }

    /**
     * Read an agent's current tier from the on-chain box.
     * Uses the algod REST API to read the box value.
     * Returns null if the box doesn't exist or can't be read.
     */
    private async readAgentTier(agentAddress: string): Promise<FlockTier | null> {
        try {
            // Box key for agents is: 'a' prefix + 32-byte address
            const addressBytes = algosdk.decodeAddress(agentAddress).publicKey;
            const boxName = new Uint8Array([0x61, ...addressBytes]); // 'a' = 0x61
            const boxNameB64 = Buffer.from(boxName).toString('base64');

            const url = `${this.config.algodUrl}/v2/applications/${this.config.appId}/box?name=b64:${boxNameB64}`;

            const headers: Record<string, string> = {};
            if (this.config.algodToken) {
                headers['X-Algo-API-Token'] = this.config.algodToken;
            }

            const response = await fetch(url, {
                headers,
                signal: AbortSignal.timeout(10_000),
            });

            if (!response.ok) return null;

            const data = (await response.json()) as { value: string };
            const boxValue = Buffer.from(data.value, 'base64');

            // The AgentRecord is an ABI tuple:
            // (string, string, string, uint64, uint64, uint64, uint64, uint64, uint64, uint64)
            // We need the 4th field (tier), which is a uint64.
            // ABI encoding: strings are dynamic, uint64s are 8 bytes each.
            // The tuple starts with offsets for dynamic fields.
            // For simplicity, we decode the tier field using the ABI codec.
            const agentRecord = this.decodeAgentRecordTier(boxValue);
            return agentRecord;
        } catch {
            return null;
        }
    }

    /**
     * Decode the tier field from an ABI-encoded AgentRecord tuple.
     *
     * The tuple layout is: (string, string, string, uint64 x7)
     * ABI head section has 10 words (32 bytes each for static, offset for dynamic):
     * - Offsets for 3 dynamic strings (3 x 32 bytes)
     * - 7 static uint64 values (7 x 32 bytes each)
     *
     * Actually, ABI encoding puts offsets for dynamic types and values for static.
     * Strings are dynamic; uint64 is static (padded to 32 bytes in head? No.)
     *
     * In ARC-4 ABI encoding for tuples, each element occupies:
     * - Static types: their natural size in the head
     * - Dynamic types: a 2-byte offset in the head
     *
     * For this tuple: 3 strings (dynamic) + 7 uint64 (static, 8 bytes each)
     * Head = 3 x 2 (offsets) + 7 x 8 (uint64s) = 6 + 56 = 62 bytes
     * The tier is the 4th element (index 3), which is the 1st uint64.
     * Head position = 3 x 2 = 6 bytes offset, then 8 bytes for the uint64.
     */
    private decodeAgentRecordTier(boxValue: Buffer): FlockTier | null {
        try {
            // Head layout for (string, string, string, uint64, uint64, uint64, uint64, uint64, uint64, uint64):
            // 3 dynamic offsets (2 bytes each) = 6 bytes
            // 7 uint64 values (8 bytes each) = 56 bytes
            // Total head = 62 bytes
            const tierOffset = 6; // After 3 x 2-byte offsets
            if (boxValue.length < tierOffset + 8) return null;

            const tier = Number(boxValue.readBigUInt64BE(tierOffset));
            if (tier >= 1 && tier <= 4) return tier as FlockTier;
            return null;
        } catch {
            return null;
        }
    }
}
