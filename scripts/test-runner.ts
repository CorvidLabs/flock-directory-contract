/**
 * Automated Flock Directory Agent Test Runner
 *
 * Discovers registered agents on-chain, tests their endpoints with various
 * challenge types, measures response time, checks for anti-spoofing signals,
 * and records results on-chain.
 *
 * Usage:
 *   npx tsx scripts/test-runner.ts
 *
 * Options (env vars):
 *   DEPLOYER_MNEMONIC  - Admin mnemonic for recording results on-chain
 *   TEST_CATEGORY      - Run only a specific category (reasoning|liveness|consistency|performance)
 *   DRY_RUN=1          - Test agents but don't record results on-chain
 *   VERBOSE=1          - Show detailed output
 *   ENDPOINT_OVERRIDE  - Override all agent endpoints (e.g. http://127.0.0.1:3000/api)
 */

import algosdk from 'algosdk';

const APP_ID = 757178329;
const TESTNET_ALGOD = 'https://testnet-api.4160.nodely.dev';
const TESTNET_INDEXER = 'https://testnet-idx.4160.nodely.dev';

// ─── Challenge Definitions ───────────────────────────────────────────────────

interface ChallengeDefinition {
    id: string;
    category: string;
    description: string;
    maxScore: number;
    prompts: TestPrompt[];
}

interface TestPrompt {
    input: string;
    /** Keywords or patterns that a correct response should contain */
    expectedPatterns?: RegExp[];
    /** If set, response must NOT contain these (detect copy-paste / template responses) */
    antiPatterns?: RegExp[];
    /** Weight of this prompt in overall challenge score (default: 1) */
    weight?: number;
}

interface AgentTestResult {
    agentAddress: string;
    agentName: string;
    endpoint: string;
    challengeId: string;
    score: number;
    maxScore: number;
    responseTimeMs: number;
    details: string;
    antiSpoofFlags: string[];
}

// Challenge bank — each run picks from these
const CHALLENGE_DEFINITIONS: ChallengeDefinition[] = [
    {
        id: 'liveness',
        category: 'liveness',
        description: 'Basic endpoint health and response format check',
        maxScore: 100,
        prompts: [
            {
                input: 'ping',
                expectedPatterns: [/\w+/], // any non-empty response
                weight: 1,
            },
            {
                input: 'What is your name and what can you do?',
                expectedPatterns: [/\w{3,}/], // substantive response
                weight: 1,
            },
        ],
    },
    {
        id: 'reasoning',
        category: 'reasoning',
        description: 'Logical reasoning and problem-solving ability',
        maxScore: 100,
        prompts: [
            {
                input: 'If all roses are flowers and some flowers fade quickly, can we conclude that some roses fade quickly? Explain your reasoning briefly.',
                expectedPatterns: [/no|cannot|can't|not necessarily|invalid|fallacy/i],
                antiPatterns: [/yes.*we can conclude that some roses fade/i],
                weight: 2,
            },
            {
                input: 'What is 17 * 23?',
                expectedPatterns: [/391/],
                weight: 1,
            },
            {
                input: 'A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost?',
                expectedPatterns: [/\$?0?\.05|five cents|5 cents/i],
                antiPatterns: [/(?:costs?|is)\s+\$?0?\.10\b|(?:the ball|it) (?:costs?|is) ten cents/i],
                weight: 2,
            },
        ],
    },
    {
        id: 'performance',
        category: 'performance',
        description: 'Response time and throughput under load',
        maxScore: 100,
        prompts: [
            {
                input: 'Respond with exactly the word "acknowledged" and nothing else.',
                expectedPatterns: [/acknowledged/i],
                weight: 1,
            },
            {
                input: 'List the first 5 prime numbers separated by commas.',
                expectedPatterns: [/2.*3.*5.*7.*11/],
                weight: 1,
            },
        ],
    },
    {
        id: 'consistency',
        category: 'consistency',
        description: 'Response consistency and behavioral coherence',
        maxScore: 100,
        prompts: [
            {
                input: 'What is the capital of France?',
                expectedPatterns: [/Paris/i],
                weight: 1,
            },
            // Second prompt is the same — we compare responses for consistency
            {
                input: 'What is the capital of France?',
                expectedPatterns: [/Paris/i],
                weight: 1,
            },
            {
                input: 'Are you an AI assistant? Answer yes or no.',
                expectedPatterns: [/yes/i],
                antiPatterns: [/no.*i.*am.*human|i.*am.*not.*ai/i],
                weight: 2,
            },
        ],
    },
];

// ─── Anti-Spoofing Checks ────────────────────────────────────────────────────

interface AntiSpoofResult {
    flags: string[];
    penalty: number; // 0-1 multiplier (1 = no penalty)
}

function checkAntiSpoofing(
    responseTimes: number[],
    responses: string[],
    prompts: TestPrompt[],
): AntiSpoofResult {
    const flags: string[] = [];
    let penalty = 1.0;

    // 1. Response time analysis
    const avgTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    const minTime = Math.min(...responseTimes);
    const maxTime = Math.max(...responseTimes);

    // Too fast for all responses = likely cached/pre-computed (< 100ms for substantive answers)
    if (avgTime < 100 && responses.some(r => r.length > 50)) {
        flags.push(`SUSPICIOUS_SPEED: avg ${avgTime}ms for substantive responses`);
        penalty *= 0.7;
    }

    // Too slow = possibly human typing (> 60 seconds)
    if (avgTime > 60_000) {
        flags.push(`SLOW_RESPONSE: avg ${avgTime}ms suggests manual responses`);
        penalty *= 0.5;
    }

    // Very inconsistent timing suggests human (AI is more consistent)
    if (responseTimes.length >= 3) {
        const stdDev = Math.sqrt(
            responseTimes.reduce((sum, t) => sum + (t - avgTime) ** 2, 0) / responseTimes.length,
        );
        const cv = stdDev / avgTime; // coefficient of variation
        if (cv > 2.0) {
            flags.push(`TIMING_VARIANCE: CV=${cv.toFixed(2)}, highly inconsistent timing`);
            penalty *= 0.8;
        }
    }

    // 2. Response length analysis — AI tends to give substantive answers
    const shortResponses = responses.filter(r => r.trim().length < 5);
    if (shortResponses.length > responses.length * 0.5) {
        flags.push(`LOW_EFFORT: ${shortResponses.length}/${responses.length} responses under 5 chars`);
        penalty *= 0.6;
    }

    // 3. Consistency check — identical prompts should get similar (but not identical) responses
    for (let i = 0; i < prompts.length; i++) {
        for (let j = i + 1; j < prompts.length; j++) {
            if (prompts[i].input === prompts[j].input && responses[i] && responses[j]) {
                // Both should mention the same key facts
                const sim = stringSimilarity(responses[i], responses[j]);
                if (sim < 0.2) {
                    flags.push(`INCONSISTENT: same prompt got very different answers (sim=${sim.toFixed(2)})`);
                    penalty *= 0.8;
                }
            }
        }
    }

    // 4. Check for common bot/spam patterns
    const allText = responses.join(' ').toLowerCase();
    if (/click here|buy now|visit my|subscribe|http[s]?:\/\/[^\s]*\.(xyz|click|top)/i.test(allText)) {
        flags.push('SPAM_CONTENT: promotional/spam content detected');
        penalty *= 0.3;
    }

    return { flags, penalty: Math.max(0.1, penalty) };
}

/** Simple word-overlap similarity (0-1) */
function stringSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let overlap = 0;
    for (const w of wordsA) if (wordsB.has(w)) overlap++;
    return (2 * overlap) / (wordsA.size + wordsB.size);
}

// ─── A2A Protocol Support ────────────────────────────────────────────────────

interface AgentCardCache {
    baseUrl: string;
    a2aEndpoint: string | null;
    apiKey?: string;
}

const agentCardCache = new Map<string, AgentCardCache>();

/** Derive base URL from a registered endpoint (e.g. https://example.com/api -> https://example.com) */
function getBaseUrl(endpoint: string): string {
    try {
        const url = new URL(endpoint);
        return `${url.protocol}//${url.host}`;
    } catch {
        return endpoint;
    }
}

/** Try to discover A2A protocol support via agent card */
async function discoverA2AEndpoint(endpoint: string): Promise<AgentCardCache> {
    const baseUrl = getBaseUrl(endpoint);
    const cached = agentCardCache.get(baseUrl);
    if (cached) return cached;

    const result: AgentCardCache = { baseUrl, a2aEndpoint: null };

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5_000);
        const res = await fetch(`${baseUrl}/.well-known/agent-card.json`, {
            signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.ok) {
            const card = await res.json() as any;
            // Look for A2A protocol in supported protocols
            const a2a = card.supportedProtocols?.find(
                (p: any) => p.protocol === 'A2A' && p.endpoint,
            );
            if (a2a) {
                result.a2aEndpoint = a2a.endpoint;
                console.log(`    Discovered A2A endpoint: ${result.a2aEndpoint}`);
            }
        }
    } catch {
        // Agent card not available — fall back to simple POST
    }

    agentCardCache.set(baseUrl, result);
    return result;
}

/** Call an A2A agent: submit task, poll for completion */
async function callA2AEndpoint(
    a2aEndpoint: string,
    prompt: string,
    apiKey: string | undefined,
    timeoutMs: number,
): Promise<{ response: string; timeMs: number; error?: string }> {
    const start = Date.now();

    try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        // Submit task
        const submitRes = await fetch(a2aEndpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({ message: prompt }),
        });

        if (!submitRes.ok) {
            const timeMs = Date.now() - start;
            return { response: '', timeMs, error: `A2A submit HTTP ${submitRes.status}: ${submitRes.statusText}` };
        }

        const task = await submitRes.json() as any;
        const taskId = task.id;
        if (!taskId) {
            const timeMs = Date.now() - start;
            return { response: '', timeMs, error: 'A2A: no task ID returned' };
        }

        // Derive poll URL from submit endpoint
        const pollBase = a2aEndpoint.replace(/\/tasks\/send$/, '/tasks');

        // Poll for completion
        const pollInterval = 1_000; // 1 second
        while (Date.now() - start < timeoutMs) {
            await new Promise(r => setTimeout(r, pollInterval));

            try {
                const pollRes = await fetch(`${pollBase}/${taskId}`, { headers });
                if (!pollRes.ok) continue;

                const status = await pollRes.json() as any;

                if (status.state === 'completed' || status.state === 'failed') {
                    const timeMs = Date.now() - start;

                    // Extract agent response from messages
                    const agentMessages = (status.messages || [])
                        .filter((m: any) => m.role === 'agent')
                        .flatMap((m: any) => (m.parts || []).filter((p: any) => p.type === 'text').map((p: any) => p.text));

                    const response = agentMessages.join('\n').trim();

                    if (status.state === 'failed' && !response) {
                        return { response: '', timeMs, error: 'A2A task failed' };
                    }

                    return { response, timeMs };
                }
            } catch {
                // Poll error — retry
            }
        }

        const timeMs = Date.now() - start;
        return { response: '', timeMs, error: `A2A timeout after ${timeoutMs}ms` };
    } catch (err: any) {
        const timeMs = Date.now() - start;
        return { response: '', timeMs, error: err.message || String(err) };
    }
}

// ─── Agent Endpoint Caller ───────────────────────────────────────────────────

async function callAgentEndpoint(
    endpoint: string,
    prompt: string,
    timeoutMs = 30_000,
): Promise<{ response: string; timeMs: number; error?: string }> {
    // Check for A2A protocol support
    const discovery = await discoverA2AEndpoint(endpoint);
    if (discovery.a2aEndpoint) {
        return callA2AEndpoint(discovery.a2aEndpoint, prompt, discovery.apiKey, timeoutMs);
    }

    // Fall back to simple POST
    const start = Date.now();

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: prompt, prompt }),
            signal: controller.signal,
        });
        clearTimeout(timer);

        const timeMs = Date.now() - start;

        if (!res.ok) {
            return { response: '', timeMs, error: `HTTP ${res.status}: ${res.statusText}` };
        }

        const body = await res.text();
        let response = body;

        // Try to parse JSON response
        try {
            const json = JSON.parse(body);
            response = json.response || json.message || json.content || json.text || json.reply || body;
        } catch {
            // Plain text response is fine
        }

        return { response: String(response), timeMs };
    } catch (err: any) {
        const timeMs = Date.now() - start;
        if (err.name === 'AbortError') {
            return { response: '', timeMs, error: `Timeout after ${timeoutMs}ms` };
        }
        return { response: '', timeMs, error: err.message || String(err) };
    }
}

// ─── On-Chain Helpers ────────────────────────────────────────────────────────

function abiMethod(name: string, args: { name: string; type: string }[], returns: string) {
    return new algosdk.ABIMethod({ name, args, returns: { type: returns } });
}

function agentBoxName(addr: string): Uint8Array {
    const prefix = new TextEncoder().encode('a');
    const decoded = algosdk.decodeAddress(addr);
    const combined = new Uint8Array(prefix.length + decoded.publicKey.length);
    combined.set(prefix);
    combined.set(decoded.publicKey, prefix.length);
    return combined;
}

function challengeBoxName(id: string): Uint8Array {
    const prefix = new TextEncoder().encode('c');
    const idBytes = new TextEncoder().encode(id);
    const lenBytes = new Uint8Array(2);
    lenBytes[0] = (idBytes.length >> 8) & 0xff;
    lenBytes[1] = idBytes.length & 0xff;
    const combined = new Uint8Array(prefix.length + lenBytes.length + idBytes.length);
    combined.set(prefix);
    combined.set(lenBytes, prefix.length);
    combined.set(idBytes, prefix.length + lenBytes.length);
    return combined;
}

function testResultBoxName(addr: string, challengeId: string): Uint8Array {
    const prefix = new TextEncoder().encode('t');
    const decoded = algosdk.decodeAddress(addr);
    const idBytes = new TextEncoder().encode(challengeId);
    const offset = 32 + 2;
    const combined = new Uint8Array(prefix.length + 32 + 2 + 2 + idBytes.length);
    let pos = 0;
    combined.set(prefix, pos); pos += prefix.length;
    combined.set(decoded.publicKey, pos); pos += 32;
    combined[pos++] = (offset >> 8) & 0xff;
    combined[pos++] = offset & 0xff;
    combined[pos++] = (idBytes.length >> 8) & 0xff;
    combined[pos++] = idBytes.length & 0xff;
    combined.set(idBytes, pos);
    return combined;
}

/** Decode an ABI-encoded AgentRecord from raw box bytes */
function decodeAgentRecord(data: Uint8Array): {
    name: string; endpoint: string; metadata: string;
    tier: number; totalScore: number; totalMaxScore: number;
    testCount: number; lastHeartbeatRound: number; registrationRound: number; stake: number;
} {
    const tupleType = algosdk.ABIType.from(
        '(string,string,string,uint64,uint64,uint64,uint64,uint64,uint64,uint64)',
    );
    const decoded = tupleType.decode(data) as any[];
    return {
        name: decoded[0],
        endpoint: decoded[1],
        metadata: decoded[2],
        tier: Number(decoded[3]),
        totalScore: Number(decoded[4]),
        totalMaxScore: Number(decoded[5]),
        testCount: Number(decoded[6]),
        lastHeartbeatRound: Number(decoded[7]),
        registrationRound: Number(decoded[8]),
        stake: Number(decoded[9]),
    };
}

// ─── Main Test Runner ────────────────────────────────────────────────────────

async function main() {
    // Load mnemonic
    if (!process.env.DEPLOYER_MNEMONIC) {
        const fs = await import('fs');
        try {
            const envContent = fs.readFileSync('/Users/corvid-agent/corvid-agent/.env', 'utf-8');
            const match = envContent.match(/ALGOCHAT_MNEMONIC=["']?(.+?)["']?\s*$/m);
            if (match) process.env.DEPLOYER_MNEMONIC = match[1];
        } catch { /* ignore */ }
        if (!process.env.DEPLOYER_MNEMONIC) {
            console.error('Error: No mnemonic found. Set DEPLOYER_MNEMONIC.');
            process.exit(1);
        }
    }

    const account = algosdk.mnemonicToSecretKey(process.env.DEPLOYER_MNEMONIC!);
    const algod = new algosdk.Algodv2('', TESTNET_ALGOD, '');
    const dryRun = process.env.DRY_RUN === '1';
    const verbose = process.env.VERBOSE === '1';
    const categoryFilter = process.env.TEST_CATEGORY;
    const endpointOverride = process.env.ENDPOINT_OVERRIDE;

    console.log(`\nFlock Directory Automated Test Runner`);
    console.log(`  App: ${APP_ID} | Admin: ${account.addr}`);
    console.log(`  Mode: ${dryRun ? 'DRY RUN (no on-chain recording)' : 'LIVE (recording on-chain)'}`);
    if (categoryFilter) console.log(`  Category filter: ${categoryFilter}`);
    if (endpointOverride) console.log(`  Endpoint override: ${endpointOverride}`);
    console.log('');

    // ── Step 1: Discover registered agents ───────────────────────
    console.log('Discovering registered agents...');
    const agents: { address: string; record: ReturnType<typeof decodeAgentRecord> }[] = [];

    try {
        const boxesRes = await fetch(`${TESTNET_INDEXER}/v2/applications/${APP_ID}/boxes?limit=100`);
        if (!boxesRes.ok) throw new Error(`Indexer ${boxesRes.status}: ${boxesRes.statusText}`);
        const boxesResponse = await boxesRes.json() as any;
        const boxes = boxesResponse['boxes'] || [];

        for (const box of boxes) {
            const nameBytes = box['name'] ? Buffer.from(box['name'], 'base64') : new Uint8Array(0);
            // Agent boxes have prefix 'a' (0x61) and are 33 bytes (1 prefix + 32 address)
            if (nameBytes.length === 33 && nameBytes[0] === 0x61) {
                const pubKey = nameBytes.slice(1);
                const address = algosdk.encodeAddress(pubKey);

                // Read the box value
                try {
                    const boxValue = await algod.getApplicationBoxByName(APP_ID, nameBytes).do();
                    const record = decodeAgentRecord(boxValue['value']);
                    agents.push({ address, record });
                } catch (err: any) {
                    console.log(`  Warning: Could not read box for ${address}: ${err.message}`);
                }
            }
        }
    } catch (err: any) {
        console.error(`Failed to query boxes: ${err.message}`);
        process.exit(1);
    }

    if (agents.length === 0) {
        console.log('  No registered agents found. Nothing to test.');
        return;
    }

    console.log(`  Found ${agents.length} registered agent(s):`);
    for (const a of agents) {
        console.log(`    - ${a.record.name} (${a.address.slice(0, 8)}...${a.address.slice(-4)}) tier=${a.record.tier} endpoint=${a.record.endpoint}`);
    }
    console.log('');

    // ── Step 2: Select challenges to run ─────────────────────────
    const challenges = categoryFilter
        ? CHALLENGE_DEFINITIONS.filter(c => c.category === categoryFilter)
        : CHALLENGE_DEFINITIONS;

    if (challenges.length === 0) {
        console.log(`No challenges match category "${categoryFilter}".`);
        return;
    }

    // Use timestamped challenge IDs for on-chain uniqueness
    const runId = Date.now().toString(36);

    // ── Step 3: Run tests against each agent ─────────────────────
    const allResults: AgentTestResult[] = [];

    for (const agent of agents) {
        const effectiveEndpoint = endpointOverride || agent.record.endpoint;
        console.log(`\nTesting: ${agent.record.name} (${agent.address.slice(0, 12)}...)`);
        console.log(`  Endpoint: ${effectiveEndpoint}${endpointOverride ? ' (override)' : ''}`);

        for (const challenge of challenges) {
            const challengeOnChainId = `${challenge.id}-${runId}`;
            console.log(`\n  Challenge: ${challenge.category} (${challengeOnChainId})`);

            const responses: string[] = [];
            const responseTimes: number[] = [];
            let promptScores: { earned: number; max: number }[] = [];
            const errors: string[] = [];

            for (let i = 0; i < challenge.prompts.length; i++) {
                const prompt = challenge.prompts[i];
                const weight = prompt.weight || 1;
                const promptMax = Math.round((challenge.maxScore / challenge.prompts.reduce((s, p) => s + (p.weight || 1), 0)) * weight);

                if (verbose) console.log(`    Prompt ${i + 1}: "${prompt.input.slice(0, 60)}..."`);

                // A2A tasks need longer timeout since they spin up a full agent session
                const isA2A = !!(await discoverA2AEndpoint(effectiveEndpoint)).a2aEndpoint;
                const promptTimeout = isA2A ? 120_000 : 30_000;
                const result = await callAgentEndpoint(effectiveEndpoint, prompt.input, promptTimeout);

                if (result.error) {
                    errors.push(`Prompt ${i + 1}: ${result.error}`);
                    responses.push('');
                    responseTimes.push(result.timeMs);
                    promptScores.push({ earned: 0, max: promptMax });
                    if (verbose) console.log(`    ERROR: ${result.error} (${result.timeMs}ms)`);
                    continue;
                }

                responses.push(result.response);
                responseTimes.push(result.timeMs);

                // Score the response
                let score = 0;

                // Check expected patterns
                if (prompt.expectedPatterns) {
                    const matched = prompt.expectedPatterns.filter(p => p.test(result.response));
                    score = Math.round((matched.length / prompt.expectedPatterns.length) * promptMax);
                } else {
                    // No patterns = just check for non-empty response
                    score = result.response.trim().length > 0 ? promptMax : 0;
                }

                // Check anti-patterns (deduct points)
                if (prompt.antiPatterns) {
                    const antiMatched = prompt.antiPatterns.filter(p => p.test(result.response));
                    if (antiMatched.length > 0) {
                        score = Math.max(0, Math.round(score * 0.3)); // 70% penalty for anti-pattern match
                    }
                }

                promptScores.push({ earned: score, max: promptMax });
                if (verbose) {
                    console.log(`    Response (${result.timeMs}ms): "${result.response.slice(0, 80)}..."`);
                    console.log(`    Score: ${score}/${promptMax}`);
                }
            }

            // Apply anti-spoofing checks
            const antiSpoof = checkAntiSpoofing(responseTimes, responses, challenge.prompts);

            const rawScore = promptScores.reduce((s, p) => s + p.earned, 0);
            const maxScore = promptScores.reduce((s, p) => s + p.max, 0);
            const adjustedScore = Math.round(rawScore * antiSpoof.penalty);

            const avgResponseTime = responseTimes.length > 0
                ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
                : 0;

            const details = [
                `raw=${rawScore}/${maxScore}`,
                `adjusted=${adjustedScore}/${maxScore}`,
                `avgTime=${avgResponseTime}ms`,
                errors.length > 0 ? `errors=${errors.length}` : null,
                antiSpoof.flags.length > 0 ? `flags=${antiSpoof.flags.length}` : null,
            ].filter(Boolean).join(', ');

            console.log(`  Result: ${adjustedScore}/${maxScore} (${details})`);

            if (antiSpoof.flags.length > 0) {
                console.log(`  Anti-spoof flags:`);
                for (const flag of antiSpoof.flags) {
                    console.log(`    - ${flag}`);
                }
            }

            allResults.push({
                agentAddress: agent.address,
                agentName: agent.record.name,
                endpoint: agent.record.endpoint,
                challengeId: challengeOnChainId,
                score: adjustedScore,
                maxScore,
                responseTimeMs: avgResponseTime,
                details,
                antiSpoofFlags: antiSpoof.flags,
            });
        }
    }

    // ── Step 4: Record results on-chain ──────────────────────────
    if (dryRun) {
        console.log('\n\nDRY RUN — skipping on-chain recording.');
    } else {
        console.log('\n\nRecording results on-chain...');

        for (const result of allResults) {
            try {
                // Create challenge on-chain if needed
                const chalBox = challengeBoxName(result.challengeId);
                let challengeExists = false;
                try {
                    await algod.getApplicationBoxByName(APP_ID, chalBox).do();
                    challengeExists = true;
                } catch { /* doesn't exist */ }

                if (!challengeExists) {
                    const chalDef = CHALLENGE_DEFINITIONS.find(c =>
                        result.challengeId.startsWith(c.id + '-'),
                    );
                    const createMethod = abiMethod(
                        'createChallenge',
                        [
                            { name: 'challengeId', type: 'string' },
                            { name: 'category', type: 'string' },
                            { name: 'description', type: 'string' },
                            { name: 'maxScore', type: 'uint64' },
                        ],
                        'void',
                    );
                    const sp = await algod.getTransactionParams().do();
                    const appArgs = [
                        createMethod.getSelector(),
                        algosdk.ABIType.from('string').encode(result.challengeId),
                        algosdk.ABIType.from('string').encode(chalDef?.category || 'general'),
                        algosdk.ABIType.from('string').encode(chalDef?.description || 'Automated test'),
                        algosdk.ABIType.from('uint64').encode(result.maxScore),
                    ];
                    const txn = algosdk.makeApplicationNoOpTxnFromObject({
                        sender: account.addr,
                        appIndex: APP_ID,
                        appArgs,
                        boxes: [{ appIndex: APP_ID, name: chalBox }],
                        suggestedParams: sp,
                    });
                    const signed = txn.signTxn(account.sk);
                    await algod.sendRawTransaction(signed).do();
                    await algosdk.waitForConfirmation(algod, txn.txID(), 4);
                    if (verbose) console.log(`  Created challenge: ${result.challengeId}`);
                }

                // Record the test result
                const recordMethod = abiMethod(
                    'recordTestResult',
                    [
                        { name: 'agentAddress', type: 'address' },
                        { name: 'challengeId', type: 'string' },
                        { name: 'score', type: 'uint64' },
                    ],
                    'void',
                );
                const sp = await algod.getTransactionParams().do();
                const appArgs = [
                    recordMethod.getSelector(),
                    algosdk.ABIType.from('address').encode(result.agentAddress),
                    algosdk.ABIType.from('string').encode(result.challengeId),
                    algosdk.ABIType.from('uint64').encode(result.score),
                ];
                const txn = algosdk.makeApplicationNoOpTxnFromObject({
                    sender: account.addr,
                    appIndex: APP_ID,
                    appArgs,
                    boxes: [
                        { appIndex: APP_ID, name: agentBoxName(result.agentAddress) },
                        { appIndex: APP_ID, name: challengeBoxName(result.challengeId) },
                        { appIndex: APP_ID, name: testResultBoxName(result.agentAddress, result.challengeId) },
                    ],
                    suggestedParams: sp,
                });
                const signed = txn.signTxn(account.sk);
                await algod.sendRawTransaction(signed).do();
                await algosdk.waitForConfirmation(algod, txn.txID(), 4);

                console.log(`  Recorded: ${result.agentName} | ${result.challengeId} | ${result.score}/${result.maxScore}`);
            } catch (err: any) {
                console.error(`  Failed to record ${result.challengeId} for ${result.agentName}: ${err.message}`);
            }
        }
    }

    // ── Step 5: Summary ──────────────────────────────────────────
    console.log('\n\n=== Test Run Summary ===');
    console.log(`Run ID: ${runId}`);
    console.log(`Agents tested: ${agents.length}`);
    console.log(`Challenges run: ${challenges.length}`);
    console.log(`Total results: ${allResults.length}`);
    console.log('');

    // Per-agent summary
    const byAgent = new Map<string, AgentTestResult[]>();
    for (const r of allResults) {
        const key = r.agentAddress;
        if (!byAgent.has(key)) byAgent.set(key, []);
        byAgent.get(key)!.push(r);
    }

    for (const [addr, results] of byAgent) {
        const totalScore = results.reduce((s, r) => s + r.score, 0);
        const totalMax = results.reduce((s, r) => s + r.maxScore, 0);
        const pct = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : 0;
        const avgTime = Math.round(results.reduce((s, r) => s + r.responseTimeMs, 0) / results.length);
        const totalFlags = results.reduce((s, r) => s + r.antiSpoofFlags.length, 0);

        console.log(`${results[0].agentName} (${addr.slice(0, 12)}...)`);
        console.log(`  Overall: ${totalScore}/${totalMax} (${pct}%)`);
        console.log(`  Avg response time: ${avgTime}ms`);
        if (totalFlags > 0) console.log(`  Anti-spoof flags: ${totalFlags}`);
        for (const r of results) {
            console.log(`    ${r.challengeId}: ${r.score}/${r.maxScore} (${r.responseTimeMs}ms)`);
        }
        console.log('');
    }

    console.log('Done.\n');
}

main().catch((err) => {
    console.error('\nTest runner failed:', err.message || err);
    if (err.response?.body) {
        console.error('  Response:', JSON.stringify(err.response.body).slice(0, 300));
    }
    process.exit(1);
});
