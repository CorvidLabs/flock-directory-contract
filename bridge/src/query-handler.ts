/**
 * Query Handler — processes incoming AlgoChat `/flock` commands and returns
 * formatted responses with agent reputation data from the Flock Directory.
 *
 * Supported commands:
 *   /flock status {address}   - Get agent's current tier, score, test count
 *   /flock leaderboard        - Top agents by score
 *   /flock challenges         - List active challenges
 *   /flock help               - Show available commands
 */

import algosdk from 'algosdk';
import type { BridgeConfig } from './config.js';
import type {
    OnChainAgentRecord,
    OnChainChallenge,
    FlockTier,
} from './types.js';
import { TIER_NAMES } from './types.js';
import { mapToReputationScore } from './reputation-mapper.js';
import { shortenAddress, formatAlgo, createBridgeLogger } from './utils.js';

const log = createBridgeLogger('QueryHandler');

export class QueryHandler {
    private config: BridgeConfig;
    private algod: algosdk.Algodv2;

    constructor(config: BridgeConfig) {
        this.config = config;
        this.algod = new algosdk.Algodv2(config.algodToken, config.algodUrl, '');
    }

    /**
     * Handle an incoming `/flock` command.
     *
     * @param command  The subcommand (e.g., "status", "leaderboard").
     * @param args     Remaining arguments after the subcommand.
     * @returns        Formatted response string.
     */
    async handleCommand(command: string, args: string): Promise<string> {
        const subcommand = command.toLowerCase().trim();

        try {
            switch (subcommand) {
                case 'status':
                    return await this.handleStatus(args.trim());
                case 'leaderboard':
                    return await this.handleLeaderboard();
                case 'challenges':
                    return await this.handleChallenges();
                case 'help':
                case '':
                    return this.handleHelp();
                default:
                    return `Unknown command: /flock ${subcommand}\n${this.handleHelp()}`;
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.error('Command failed', { command: subcommand, args, error: msg });
            return `Error processing /flock ${subcommand}: ${msg}`;
        }
    }

    /**
     * Parse a raw message string and route to handleCommand if it's a /flock command.
     * Returns null if the message is not a /flock command.
     */
    parseAndHandle(message: string): Promise<string> | null {
        const trimmed = message.trim();
        if (!trimmed.startsWith('/flock')) return null;

        const parts = trimmed.slice('/flock'.length).trim();
        const spaceIndex = parts.indexOf(' ');

        if (spaceIndex === -1) {
            return this.handleCommand(parts, '');
        }

        const command = parts.slice(0, spaceIndex);
        const args = parts.slice(spaceIndex + 1);
        return this.handleCommand(command, args);
    }

    // ─── Command Handlers ───────────────────────────────────────────────────

    private async handleStatus(address: string): Promise<string> {
        if (!address) {
            return 'Usage: /flock status {algorand_address}';
        }

        // Validate address
        if (!algosdk.isValidAddress(address)) {
            return `Invalid Algorand address: ${address}`;
        }

        const record = await this.readAgentRecord(address);
        if (!record) {
            return `Agent ${shortenAddress(address)} is not registered in the Flock Directory.`;
        }

        const scorePercent = record.totalMaxScore > 0
            ? Math.round((record.totalScore * 100) / record.totalMaxScore)
            : 0;

        // Get current round for reputation mapping
        let currentRound: number | undefined;
        try {
            const status = await this.algod.status().do();
            currentRound = Number(status.lastRound);
        } catch {
            // Non-critical — proceed without round info
        }

        const reputation = mapToReputationScore(address, record, currentRound);

        const lines = [
            `--- Flock Directory Status ---`,
            `Agent: ${record.name} (${shortenAddress(address)})`,
            `Tier: ${TIER_NAMES[record.tier as FlockTier]} (${record.tier}/4)`,
            `Score: ${scorePercent}% (${record.totalScore}/${record.totalMaxScore})`,
            `Tests: ${record.testCount}`,
            `Stake: ${formatAlgo(record.stake)} ALGO`,
            `Endpoint: ${record.endpoint}`,
            ``,
            `--- Reputation Mapping ---`,
            `Trust Level: ${reputation.trustLevel}`,
            `Overall Score: ${reputation.overallScore}/100`,
            `  Task Completion: ${reputation.components.taskCompletion}`,
            `  Peer Rating: ${reputation.components.peerRating}`,
            `  Credit Pattern: ${reputation.components.creditPattern}`,
            `  Security Compliance: ${reputation.components.securityCompliance}`,
            `  Activity Level: ${reputation.components.activityLevel}`,
        ];

        if (record.metadata) {
            lines.push(`Metadata: ${record.metadata}`);
        }

        return lines.join('\n');
    }

    private async handleLeaderboard(): Promise<string> {
        // Read all agent boxes. The indexer can list boxes for the app.
        const agents = await this.fetchAllAgents();

        if (agents.length === 0) {
            return 'No agents registered in the Flock Directory.';
        }

        // Sort by score descending
        agents.sort((a, b) => {
            const scoreA = a.record.totalMaxScore > 0
                ? (a.record.totalScore * 100) / a.record.totalMaxScore
                : 0;
            const scoreB = b.record.totalMaxScore > 0
                ? (b.record.totalScore * 100) / b.record.totalMaxScore
                : 0;
            return scoreB - scoreA;
        });

        const top = agents.slice(0, 10);

        const lines = ['--- Flock Directory Leaderboard ---', ''];
        for (let i = 0; i < top.length; i++) {
            const { address, record } = top[i];
            const scorePercent = record.totalMaxScore > 0
                ? Math.round((record.totalScore * 100) / record.totalMaxScore)
                : 0;
            const tierName = TIER_NAMES[record.tier as FlockTier] ?? 'Unknown';

            lines.push(
                `${i + 1}. ${record.name} (${shortenAddress(address)})`,
                `   Tier: ${tierName} | Score: ${scorePercent}% | Tests: ${record.testCount}`,
            );
        }

        lines.push('', `Total agents: ${agents.length}`);
        return lines.join('\n');
    }

    private async handleChallenges(): Promise<string> {
        const challenges = await this.fetchAllChallenges();

        if (challenges.length === 0) {
            return 'No challenges found in the Flock Directory.';
        }

        const active = challenges.filter((c) => c.challenge.active);
        const inactive = challenges.filter((c) => !c.challenge.active);

        const lines = ['--- Flock Directory Challenges ---', ''];

        if (active.length > 0) {
            lines.push('Active:');
            for (const { id, challenge } of active) {
                lines.push(
                    `  ${id} [${challenge.category}]`,
                    `    Max Score: ${challenge.maxScore}`,
                    challenge.description ? `    ${challenge.description}` : '',
                );
            }
        }

        if (inactive.length > 0) {
            lines.push('', 'Inactive:');
            for (const { id, challenge } of inactive) {
                lines.push(`  ${id} [${challenge.category}] (deactivated)`);
            }
        }

        lines.push('', `Total: ${active.length} active, ${inactive.length} inactive`);
        return lines.filter(Boolean).join('\n');
    }

    private handleHelp(): string {
        return [
            '--- Flock Directory Commands ---',
            '/flock status {address}  - Get agent tier, score, and reputation',
            '/flock leaderboard       - Top agents by score',
            '/flock challenges        - List active challenges',
            '/flock help              - Show this help message',
        ].join('\n');
    }

    // ─── On-Chain Data Reading ──────────────────────────────────────────────

    /**
     * Read an agent's record from the Flock Directory box storage.
     */
    private async readAgentRecord(address: string): Promise<OnChainAgentRecord | null> {
        try {
            const addressBytes = algosdk.decodeAddress(address).publicKey;
            const boxName = new Uint8Array([0x61, ...addressBytes]); // 'a' prefix
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
            return this.decodeAgentRecord(Buffer.from(data.value, 'base64'));
        } catch (err) {
            log.debug('Failed to read agent record', {
                address,
                error: err instanceof Error ? err.message : String(err),
            });
            return null;
        }
    }

    /**
     * Fetch all agent records by listing application boxes.
     */
    private async fetchAllAgents(): Promise<Array<{ address: string; record: OnChainAgentRecord }>> {
        const agents: Array<{ address: string; record: OnChainAgentRecord }> = [];

        try {
            const url = `${this.config.algodUrl}/v2/applications/${this.config.appId}/boxes?max=100`;
            const headers: Record<string, string> = {};
            if (this.config.algodToken) {
                headers['X-Algo-API-Token'] = this.config.algodToken;
            }

            const response = await fetch(url, {
                headers,
                signal: AbortSignal.timeout(30_000),
            });

            if (!response.ok) return agents;

            const data = (await response.json()) as { boxes: Array<{ name: string }> };

            for (const box of data.boxes ?? []) {
                const nameBytes = Buffer.from(box.name, 'base64');
                // Agent boxes have 'a' prefix (0x61) followed by 32-byte address
                if (nameBytes[0] !== 0x61 || nameBytes.length !== 33) continue;

                const address = algosdk.encodeAddress(nameBytes.subarray(1));

                // Read the full box
                const record = await this.readAgentRecord(address);
                if (record) {
                    agents.push({ address, record });
                }
            }
        } catch (err) {
            log.error('Failed to fetch all agents', {
                error: err instanceof Error ? err.message : String(err),
            });
        }

        return agents;
    }

    /**
     * Fetch all challenge records by listing application boxes.
     */
    private async fetchAllChallenges(): Promise<Array<{ id: string; challenge: OnChainChallenge }>> {
        const challenges: Array<{ id: string; challenge: OnChainChallenge }> = [];

        try {
            const url = `${this.config.algodUrl}/v2/applications/${this.config.appId}/boxes?max=100`;
            const headers: Record<string, string> = {};
            if (this.config.algodToken) {
                headers['X-Algo-API-Token'] = this.config.algodToken;
            }

            const response = await fetch(url, {
                headers,
                signal: AbortSignal.timeout(30_000),
            });

            if (!response.ok) return challenges;

            const data = (await response.json()) as { boxes: Array<{ name: string }> };

            for (const box of data.boxes ?? []) {
                const nameBytes = Buffer.from(box.name, 'base64');
                // Challenge boxes have 'c' prefix (0x63)
                if (nameBytes[0] !== 0x63) continue;

                const challengeId = nameBytes.subarray(1).toString('utf-8');

                try {
                    const boxNameB64 = Buffer.from(nameBytes).toString('base64');
                    const boxUrl = `${this.config.algodUrl}/v2/applications/${this.config.appId}/box?name=b64:${boxNameB64}`;

                    const boxResponse = await fetch(boxUrl, {
                        headers,
                        signal: AbortSignal.timeout(10_000),
                    });

                    if (!boxResponse.ok) continue;

                    const boxData = (await boxResponse.json()) as { value: string };
                    const challenge = this.decodeChallengeRecord(Buffer.from(boxData.value, 'base64'));
                    if (challenge) {
                        challenges.push({ id: challengeId, challenge });
                    }
                } catch {
                    // Skip unreadable boxes
                }
            }
        } catch (err) {
            log.error('Failed to fetch challenges', {
                error: err instanceof Error ? err.message : String(err),
            });
        }

        return challenges;
    }

    // ─── ABI Decoding ───────────────────────────────────────────────────────

    /**
     * Decode an ABI-encoded AgentRecord tuple from box value bytes.
     *
     * Tuple: (string, string, string, uint64, uint64, uint64, uint64, uint64, uint64, uint64)
     *
     * ARC-4 tuple encoding:
     * - Head: 3 x 2-byte offsets (for dynamic strings) + 7 x 8-byte uint64 values
     * - Tail: each string as 2-byte-length-prefixed UTF-8
     */
    private decodeAgentRecord(bytes: Buffer): OnChainAgentRecord | null {
        try {
            // Head = 3 offsets (2 bytes each) + 7 uint64s (8 bytes each) = 6 + 56 = 62 bytes
            if (bytes.length < 62) return null;

            // Read string offsets (relative to start of tuple)
            const nameOffset = bytes.readUInt16BE(0);
            const endpointOffset = bytes.readUInt16BE(2);
            const metadataOffset = bytes.readUInt16BE(4);

            // Read uint64 values starting at byte 6
            const tier = Number(bytes.readBigUInt64BE(6));
            const totalScore = Number(bytes.readBigUInt64BE(14));
            const totalMaxScore = Number(bytes.readBigUInt64BE(22));
            const testCount = Number(bytes.readBigUInt64BE(30));
            const lastHeartbeatRound = Number(bytes.readBigUInt64BE(38));
            const registrationRound = Number(bytes.readBigUInt64BE(46));
            const stake = Number(bytes.readBigUInt64BE(54));

            // Decode strings from tail
            const name = this.decodeStringAt(bytes, nameOffset);
            const endpoint = this.decodeStringAt(bytes, endpointOffset);
            const metadata = this.decodeStringAt(bytes, metadataOffset);

            return {
                name,
                endpoint,
                metadata,
                tier: tier as FlockTier,
                totalScore,
                totalMaxScore,
                testCount,
                lastHeartbeatRound,
                registrationRound,
                stake,
            };
        } catch (err) {
            log.debug('Failed to decode agent record', {
                error: err instanceof Error ? err.message : String(err),
                bytesLength: bytes.length,
            });
            return null;
        }
    }

    /**
     * Decode an ABI-encoded Challenge tuple from box value bytes.
     *
     * Tuple: (string, string, uint64, uint64)
     * Head: 2 x 2-byte offsets + 2 x 8-byte uint64 = 4 + 16 = 20 bytes
     */
    private decodeChallengeRecord(bytes: Buffer): OnChainChallenge | null {
        try {
            if (bytes.length < 20) return null;

            const categoryOffset = bytes.readUInt16BE(0);
            const descriptionOffset = bytes.readUInt16BE(2);
            const maxScore = Number(bytes.readBigUInt64BE(4));
            const active = Number(bytes.readBigUInt64BE(12));

            const category = this.decodeStringAt(bytes, categoryOffset);
            const description = this.decodeStringAt(bytes, descriptionOffset);

            return {
                category,
                description,
                maxScore,
                active: active === 1,
            };
        } catch {
            return null;
        }
    }

    /**
     * Read a length-prefixed string from a buffer at the given offset.
     */
    private decodeStringAt(bytes: Buffer, offset: number): string {
        if (offset + 2 > bytes.length) return '';
        const length = bytes.readUInt16BE(offset);
        if (offset + 2 + length > bytes.length) return '';
        return bytes.subarray(offset + 2, offset + 2 + length).toString('utf-8');
    }
}
