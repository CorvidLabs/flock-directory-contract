/**
 * Utility functions — ABI method selector computation, ABI decoding helpers,
 * and address formatting.
 */

import algosdk from 'algosdk';

// ─── ABI Method Selectors ───────────────────────────────────────────────────
//
// ARC-4 method selectors are the first 4 bytes of SHA-512/256 of the method
// signature string. We pre-compute the selectors for all Flock Directory
// methods that we need to detect as events.

/** ABI method definitions matching the FlockDirectory contract. */
const METHOD_SIGNATURES: Record<string, string> = {
    registerAgent: 'registerAgent(string,string,string,pay)void',
    updateAgent: 'updateAgent(string,string,string)void',
    heartbeat: 'heartbeat()void',
    deregister: 'deregister()void',
    createChallenge: 'createChallenge(string,string,string,uint64)void',
    deactivateChallenge: 'deactivateChallenge(string)void',
    recordTestResult: 'recordTestResult(address,string,uint64)void',
    getAgentTier: 'getAgentTier(address)uint64',
    getAgentScore: 'getAgentScore(address)uint64',
    getAgentTestCount: 'getAgentTestCount(address)uint64',
    getAgentInfo: 'getAgentInfo(address)(string,string,string,uint64,uint64,uint64,uint64,uint64,uint64,uint64)',
    getChallengeInfo: 'getChallengeInfo(string)(string,string,uint64,uint64)',
    updateMinStake: 'updateMinStake(uint64)void',
    transferAdmin: 'transferAdmin(address)void',
    setRegistrationOpen: 'setRegistrationOpen(uint64)void',
    adminRemoveAgent: 'adminRemoveAgent(address)void',
};

/**
 * Compute the 4-byte ARC-4 method selector for a given method signature.
 * Uses the algosdk ABIMethod utility to produce the canonical selector.
 */
function computeSelector(signature: string): string {
    // Parse the signature to extract name, arg types, and return type
    const parenStart = signature.indexOf('(');
    const name = signature.slice(0, parenStart);

    // Find the matching closing paren for the args, handling nested parens
    let depth = 0;
    let argsEnd = -1;
    for (let i = parenStart; i < signature.length; i++) {
        if (signature[i] === '(') depth++;
        if (signature[i] === ')') {
            depth--;
            if (depth === 0) { argsEnd = i; break; }
        }
    }

    const argsStr = signature.slice(parenStart + 1, argsEnd);
    const returnType = signature.slice(argsEnd + 1);

    // Split args respecting nested parens
    const args: string[] = [];
    if (argsStr.length > 0) {
        let current = '';
        let parenDepth = 0;
        for (const ch of argsStr) {
            if (ch === '(') parenDepth++;
            if (ch === ')') parenDepth--;
            if (ch === ',' && parenDepth === 0) {
                args.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
        if (current.trim()) args.push(current.trim());
    }

    const method = new algosdk.ABIMethod({
        name,
        args: args.map((type, i) => ({ name: `arg${i}`, type })),
        returns: { type: returnType || 'void' },
    });

    return Buffer.from(method.getSelector()).toString('base64');
}

/** Map from base64-encoded 4-byte selector to method name. */
const SELECTOR_TO_METHOD: Map<string, string> = new Map();

/** Map from method name to base64-encoded selector. */
const METHOD_TO_SELECTOR: Map<string, string> = new Map();

// Pre-compute all selectors
for (const [name, signature] of Object.entries(METHOD_SIGNATURES)) {
    const sel = computeSelector(signature);
    SELECTOR_TO_METHOD.set(sel, name);
    METHOD_TO_SELECTOR.set(name, sel);
}

/**
 * Identify which ABI method was called from the first app arg (base64-encoded).
 * Returns the method name or null if unrecognized.
 */
export function identifyMethod(firstAppArgBase64: string): string | null {
    return SELECTOR_TO_METHOD.get(firstAppArgBase64) ?? null;
}

/**
 * Get the base64-encoded selector for a known method name.
 */
export function getMethodSelector(methodName: string): string | null {
    return METHOD_TO_SELECTOR.get(methodName) ?? null;
}

// ─── ABI Argument Decoding ──────────────────────────────────────────────────

/**
 * Decode a base64-encoded ABI string argument.
 * ABI strings are length-prefixed (2-byte uint16 length, then UTF-8 bytes).
 */
export function decodeABIString(base64Arg: string): string {
    const bytes = Buffer.from(base64Arg, 'base64');
    if (bytes.length < 2) return '';
    const length = bytes.readUInt16BE(0);
    return bytes.subarray(2, 2 + length).toString('utf-8');
}

/**
 * Decode a base64-encoded ABI uint64 argument.
 */
export function decodeABIUint64(base64Arg: string): number {
    const bytes = Buffer.from(base64Arg, 'base64');
    if (bytes.length < 8) return 0;
    // Read as BigInt then convert (safe for values < Number.MAX_SAFE_INTEGER)
    const value = bytes.readBigUInt64BE(0);
    return Number(value);
}

/**
 * Decode a base64-encoded ABI address argument (32 bytes).
 */
export function decodeABIAddress(base64Arg: string): string {
    const bytes = Buffer.from(base64Arg, 'base64');
    if (bytes.length < 32) return '';
    return algosdk.encodeAddress(bytes.subarray(0, 32));
}

// ─── Address Formatting ─────────────────────────────────────────────────────

/**
 * Shorten an Algorand address to first 6 and last 4 characters.
 * Example: "ABCDEF...WXYZ"
 */
export function shortenAddress(address: string): string {
    if (address.length <= 12) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Format a microAlgo amount as ALGO with appropriate precision.
 */
export function formatAlgo(microAlgos: number): string {
    return (microAlgos / 1_000_000).toFixed(microAlgos % 1_000_000 === 0 ? 0 : 6);
}

// ─── Logging ────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

let currentLogLevel: LogLevel = (process.env.FLOCK_BRIDGE_LOG_LEVEL as LogLevel) ?? 'info';

export function setLogLevel(level: LogLevel): void {
    currentLogLevel = level;
}

/**
 * Create a namespaced logger for a bridge component.
 */
export function createBridgeLogger(component: string) {
    const prefix = `[FlockBridge:${component}]`;

    function shouldLog(level: LogLevel): boolean {
        return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLogLevel];
    }

    return {
        debug(msg: string, data?: Record<string, unknown>) {
            if (shouldLog('debug')) console.debug(prefix, msg, data ?? '');
        },
        info(msg: string, data?: Record<string, unknown>) {
            if (shouldLog('info')) console.info(prefix, msg, data ?? '');
        },
        warn(msg: string, data?: Record<string, unknown>) {
            if (shouldLog('warn')) console.warn(prefix, msg, data ?? '');
        },
        error(msg: string, data?: Record<string, unknown>) {
            if (shouldLog('error')) console.error(prefix, msg, data ?? '');
        },
    };
}
