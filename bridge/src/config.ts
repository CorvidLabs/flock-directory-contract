/**
 * Bridge configuration — network endpoints, app ID, and polling intervals.
 *
 * Values are resolved from environment variables with sensible defaults
 * for Algorand TestNet. Override via .env or process environment.
 */

export interface BridgeConfig {
    /** Flock Directory application ID on-chain. */
    appId: number;
    /** Algod REST API base URL. */
    algodUrl: string;
    /** Algod API token (empty string for public nodes). */
    algodToken: string;
    /** Indexer REST API base URL. */
    indexerUrl: string;
    /** Indexer API token (empty string for public nodes). */
    indexerToken: string;
    /** Milliseconds between indexer polls for new transactions. */
    pollIntervalMs: number;
    /** Number of rounds to look back on first poll (cold start catch-up). */
    coldStartLookbackRounds: number;
    /**
     * Optional AlgoChat broadcast callback. When set, the bridge calls this
     * function for every detected event so the host application can route it
     * through its existing AlgoChat infrastructure.
     */
    broadcastFn?: (message: string) => Promise<void>;
    /**
     * Optional query handler callback. When set, the bridge registers this
     * as the handler for incoming `/flock` commands via AlgoChat.
     */
    queryFn?: (command: string, args: string) => Promise<string>;
}

/** Default configuration targeting Algorand TestNet. */
export const DEFAULT_CONFIG: Readonly<BridgeConfig> = {
    appId: 757178329,
    algodUrl: 'https://testnet-api.4160.nodely.dev',
    algodToken: '',
    indexerUrl: 'https://testnet-idx.4160.nodely.dev',
    indexerToken: '',
    pollIntervalMs: 15_000,
    coldStartLookbackRounds: 1000,
};

/**
 * Load bridge configuration from environment variables, falling back to defaults.
 */
export function loadBridgeConfig(overrides?: Partial<BridgeConfig>): BridgeConfig {
    return {
        appId: overrides?.appId
            ?? (process.env.FLOCK_APP_ID ? parseInt(process.env.FLOCK_APP_ID, 10) : DEFAULT_CONFIG.appId),
        algodUrl: overrides?.algodUrl
            ?? process.env.FLOCK_ALGOD_URL
            ?? DEFAULT_CONFIG.algodUrl,
        algodToken: overrides?.algodToken
            ?? process.env.FLOCK_ALGOD_TOKEN
            ?? DEFAULT_CONFIG.algodToken,
        indexerUrl: overrides?.indexerUrl
            ?? process.env.FLOCK_INDEXER_URL
            ?? DEFAULT_CONFIG.indexerUrl,
        indexerToken: overrides?.indexerToken
            ?? process.env.FLOCK_INDEXER_TOKEN
            ?? DEFAULT_CONFIG.indexerToken,
        pollIntervalMs: overrides?.pollIntervalMs
            ?? (process.env.FLOCK_POLL_INTERVAL_MS ? parseInt(process.env.FLOCK_POLL_INTERVAL_MS, 10) : DEFAULT_CONFIG.pollIntervalMs),
        coldStartLookbackRounds: overrides?.coldStartLookbackRounds
            ?? (process.env.FLOCK_COLD_START_LOOKBACK ? parseInt(process.env.FLOCK_COLD_START_LOOKBACK, 10) : DEFAULT_CONFIG.coldStartLookbackRounds),
        broadcastFn: overrides?.broadcastFn,
        queryFn: overrides?.queryFn,
    };
}
