/**
 * Flock Directory Contract Integration Tests
 *
 * Requires AlgoKit localnet running:
 *   algokit localnet start
 *
 * Run: bun run test
 */

import 'dotenv/config';
import { describe, test, expect, beforeAll, beforeEach } from 'vitest';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import { AlgorandClient, Config } from '@algorandfoundation/algokit-utils';
import algosdk from 'algosdk';
import * as fs from 'fs';
import * as path from 'path';

// Auto-populate box/account references
Config.configure({ populateAppCallResources: true });

// Support configurable localnet endpoint (e.g. when running in a VM)
const ALGOD_SERVER = process.env.ALGOD_SERVER || 'http://localhost';
const ALGOD_PORT = parseInt(process.env.ALGOD_PORT || '4001', 10);
const ALGOD_TOKEN = process.env.ALGOD_TOKEN || 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const KMD_PORT = parseInt(process.env.KMD_PORT || '4002', 10);
const KMD_TOKEN = process.env.KMD_TOKEN || ALGOD_TOKEN;

// ── Helpers ───────────────────────────────────────────────────────

function loadArtifacts() {
    const artifactsDir = path.join(__dirname, '..', 'artifacts');
    return {
        approvalTeal: fs.readFileSync(path.join(artifactsDir, 'FlockDirectory.approval.teal'), 'utf-8'),
        clearTeal: fs.readFileSync(path.join(artifactsDir, 'FlockDirectory.clear.teal'), 'utf-8'),
        arc56: JSON.parse(fs.readFileSync(path.join(artifactsDir, 'FlockDirectory.arc56.json'), 'utf-8')),
        arc32: JSON.parse(fs.readFileSync(path.join(artifactsDir, 'FlockDirectory.arc32.json'), 'utf-8')),
    };
}

function getMethod(arc32: any, name: string): algosdk.ABIMethod {
    const m = arc32.contract.methods.find((m: any) => m.name === name);
    if (!m) throw new Error(`Method ${name} not found in ARC32`);
    return new algosdk.ABIMethod(m);
}

/** Deploy a fresh FlockDirectory contract and return the app ID + address */
async function deployContract(
    algorand: AlgorandClient,
    sender: string | algosdk.Address,
    artifacts: ReturnType<typeof loadArtifacts>,
): Promise<{ appId: bigint; appAddress: string }> {
    const approvalCompiled = await algorand.app.compileTeal(artifacts.approvalTeal);
    const clearCompiled = await algorand.app.compileTeal(artifacts.clearTeal);

    const result = await algorand.send.appCreateMethodCall({
        sender,
        approvalProgram: approvalCompiled.compiledBase64ToBytes,
        clearStateProgram: clearCompiled.compiledBase64ToBytes,
        schema: {
            globalInts: 5,
            globalByteSlices: 1,
            localInts: 0,
            localByteSlices: 0,
        },
        method: getMethod(artifacts.arc32, 'createApplication'),
        args: [],
    });

    const appId = BigInt(result.confirmation.applicationIndex!);
    const appAddress = algosdk.getApplicationAddress(Number(appId)).toString();

    // Fund the app so it can return stakes
    await algorand.send.payment({
        sender,
        receiver: appAddress,
        amount: (10).algo(),
    });

    return { appId, appAddress };
}

// ── Test Suite ────────────────────────────────────────────────────

describe('FlockDirectory Contract', () => {
    const INDEXER_PORT = parseInt(process.env.INDEXER_PORT || '8980', 10);
    const INDEXER_TOKEN = process.env.INDEXER_TOKEN || ALGOD_TOKEN;
    const fixture = algorandFixture({
        algodConfig: { server: ALGOD_SERVER, port: ALGOD_PORT, token: ALGOD_TOKEN },
        kmdConfig: { server: ALGOD_SERVER, port: KMD_PORT, token: KMD_TOKEN },
        indexerConfig: { server: ALGOD_SERVER, port: INDEXER_PORT, token: INDEXER_TOKEN },
        testAccountFunding: (100).algo(),
    });
    let artifacts: ReturnType<typeof loadArtifacts>;

    beforeAll(() => {
        artifacts = loadArtifacts();
    });

    beforeEach(fixture.newScope);

    // ── Registration ──────────────────────────────────────────

    describe('Agent Registration', () => {
        test('registers a new agent with valid stake', async () => {
            const { algorand, testAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);

            const result = await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'registerAgent'),
                args: [
                    'corvid-agent',
                    'https://corvid.example.com/api',
                    '{"version":"0.21.0"}',
                    algorand.createTransaction.payment({
                        sender: testAccount.addr,
                        receiver: appAddress,
                        amount: (1).algo(),
                    }),
                ],
                boxReferences: [{ appId: 0n, name: algosdk.encodeUint64(0) }],
            });

            expect(result.confirmation).toBeDefined();

            // Verify agent count incremented
            const state = await algorand.app.getGlobalState(appId);
            expect(state['agent_count']?.value).toBe(1n);
        });

        test('rejects registration with insufficient stake', async () => {
            const { algorand, testAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);

            await expect(
                algorand.send.appCallMethodCall({
                    sender: testAccount.addr,
                    appId,
                    method: getMethod(artifacts.arc32, 'registerAgent'),
                    args: [
                        'corvid-agent',
                        'https://corvid.example.com/api',
                        '{}',
                        algorand.createTransaction.payment({
                            sender: testAccount.addr,
                            receiver: appAddress,
                            amount: (0.5).algo(), // Less than 1 ALGO minimum
                        }),
                    ],
                }),
            ).rejects.toThrow();
        });

        test('rejects duplicate registration', async () => {
            const { algorand, testAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);

            // First registration
            await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'registerAgent'),
                args: [
                    'corvid-agent',
                    'https://corvid.example.com/api',
                    '{}',
                    algorand.createTransaction.payment({
                        sender: testAccount.addr,
                        receiver: appAddress,
                        amount: (1).algo(),
                    }),
                ],
            });

            // Second registration should fail
            await expect(
                algorand.send.appCallMethodCall({
                    sender: testAccount.addr,
                    appId,
                    method: getMethod(artifacts.arc32, 'registerAgent'),
                    args: [
                        'corvid-agent-2',
                        'https://corvid.example.com/api',
                        '{}',
                        algorand.createTransaction.payment({
                            sender: testAccount.addr,
                            receiver: appAddress,
                            amount: (1).algo(),
                        }),
                    ],
                }),
            ).rejects.toThrow();
        });

        test('rejects registration when closed', async () => {
            const { algorand, testAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);

            // Close registration
            await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'setRegistrationOpen'),
                args: [0n],
            });

            // Try to register
            await expect(
                algorand.send.appCallMethodCall({
                    sender: testAccount.addr,
                    appId,
                    method: getMethod(artifacts.arc32, 'registerAgent'),
                    args: [
                        'corvid-agent',
                        'https://corvid.example.com/api',
                        '{}',
                        algorand.createTransaction.payment({
                            sender: testAccount.addr,
                            receiver: appAddress,
                            amount: (1).algo(),
                        }),
                    ],
                }),
            ).rejects.toThrow();
        });
    });

    // ── Update & Heartbeat ────────────────────────────────────

    describe('Agent Update & Heartbeat', () => {
        test('updates agent metadata', async () => {
            const { algorand, testAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);

            // Register
            await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'registerAgent'),
                args: [
                    'corvid-agent',
                    'https://old.example.com/api',
                    '{}',
                    algorand.createTransaction.payment({
                        sender: testAccount.addr,
                        receiver: appAddress,
                        amount: (1).algo(),
                    }),
                ],
            });

            // Update
            const result = await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'updateAgent'),
                args: [
                    'corvid-agent-v2',
                    'https://new.example.com/api',
                    '{"version":"0.22.0"}',
                ],
            });

            expect(result.confirmation).toBeDefined();
        });

        test('records heartbeat', async () => {
            const { algorand, testAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);

            // Register
            await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'registerAgent'),
                args: [
                    'corvid-agent',
                    'https://corvid.example.com/api',
                    '{}',
                    algorand.createTransaction.payment({
                        sender: testAccount.addr,
                        receiver: appAddress,
                        amount: (1).algo(),
                    }),
                ],
            });

            // Heartbeat
            const result = await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'heartbeat'),
                args: [],
            });

            expect(result.confirmation).toBeDefined();
        });

        test('rejects heartbeat from unregistered agent', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId } = await deployContract(algorand, testAccount.addr, artifacts);

            const stranger = await generateAccount({ initialFunds: (5).algo() });

            await expect(
                algorand.send.appCallMethodCall({
                    sender: stranger.addr,
                    appId,
                    method: getMethod(artifacts.arc32, 'heartbeat'),
                    args: [],
                }),
            ).rejects.toThrow();
        });
    });

    // ── Deregistration ────────────────────────────────────────

    describe('Deregistration', () => {
        test('deregisters and returns stake', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);

            const agent = await generateAccount({ initialFunds: (10).algo() });

            // Register
            await algorand.send.appCallMethodCall({
                sender: agent.addr,
                appId,
                method: getMethod(artifacts.arc32, 'registerAgent'),
                args: [
                    'test-agent',
                    'https://test.example.com/api',
                    '{}',
                    algorand.createTransaction.payment({
                        sender: agent.addr,
                        receiver: appAddress,
                        amount: (1).algo(),
                    }),
                ],
            });

            // Check balance after registration
            const balanceBefore = (await algorand.account.getInformation(agent.addr)).balance;

            // Deregister (needs extraFee to cover inner payment txn)
            await algorand.send.appCallMethodCall({
                sender: agent.addr,
                appId,
                method: getMethod(artifacts.arc32, 'deregister'),
                args: [],
                extraFee: (1000).microAlgo(),
            });

            // Check balance increased (stake returned)
            const balanceAfter = (await algorand.account.getInformation(agent.addr)).balance;
            expect(balanceAfter.microAlgo).toBeGreaterThan(balanceBefore.microAlgo);

            // Verify agent count decremented
            const state = await algorand.app.getGlobalState(appId);
            expect(state['agent_count']?.value).toBe(0n);
        });
    });

    // ── Test Challenges ───────────────────────────────────────

    describe('Test Challenge Protocol', () => {
        test('admin creates a challenge', async () => {
            const { algorand, testAccount } = fixture.context;
            const { appId } = await deployContract(algorand, testAccount.addr, artifacts);

            const result = await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'createChallenge'),
                args: ['api-latency', 'performance', 'Measure API response latency', 100n],
            });

            expect(result.confirmation).toBeDefined();

            const state = await algorand.app.getGlobalState(appId);
            expect(state['chal_count']?.value).toBe(1n);
        });

        test('non-admin cannot create challenge', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId } = await deployContract(algorand, testAccount.addr, artifacts);

            const stranger = await generateAccount({ initialFunds: (5).algo() });

            await expect(
                algorand.send.appCallMethodCall({
                    sender: stranger.addr,
                    appId,
                    method: getMethod(artifacts.arc32, 'createChallenge'),
                    args: ['test-challenge', 'test', 'desc', 100n],
                }),
            ).rejects.toThrow();
        });

        test('records test result and updates agent tier', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);

            const agent = await generateAccount({ initialFunds: (10).algo() });

            // Register agent
            await algorand.send.appCallMethodCall({
                sender: agent.addr,
                appId,
                method: getMethod(artifacts.arc32, 'registerAgent'),
                args: [
                    'test-agent',
                    'https://test.example.com/api',
                    '{}',
                    algorand.createTransaction.payment({
                        sender: agent.addr,
                        receiver: appAddress,
                        amount: (1).algo(),
                    }),
                ],
            });

            // Create challenge
            await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'createChallenge'),
                args: ['api-test', 'api', 'API capability test', 100n],
            });

            // Record test result
            await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'recordTestResult'),
                args: [agent.addr, 'api-test', 85n],
            });

            // Verify tier updated to TESTED (2)
            const tierResult = await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'getAgentTier'),
                args: [agent.addr],
            });

            expect(tierResult.return?.returnValue).toBe(2n); // TIER_TESTED
        });

        test('agent reaches ESTABLISHED tier after 3 good tests', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);

            const agent = await generateAccount({ initialFunds: (10).algo() });

            // Register agent
            await algorand.send.appCallMethodCall({
                sender: agent.addr,
                appId,
                method: getMethod(artifacts.arc32, 'registerAgent'),
                args: [
                    'test-agent',
                    'https://test.example.com/api',
                    '{}',
                    algorand.createTransaction.payment({
                        sender: agent.addr,
                        receiver: appAddress,
                        amount: (1).algo(),
                    }),
                ],
            });

            // Create 3 challenges
            for (const id of ['test-1', 'test-2', 'test-3']) {
                await algorand.send.appCallMethodCall({
                    sender: testAccount.addr,
                    appId,
                    method: getMethod(artifacts.arc32, 'createChallenge'),
                    args: [id, 'api', `Test ${id}`, 100n],
                });
            }

            // Record 3 good scores (70/100 each = 70% > 60% threshold)
            for (const id of ['test-1', 'test-2', 'test-3']) {
                await algorand.send.appCallMethodCall({
                    sender: testAccount.addr,
                    appId,
                    method: getMethod(artifacts.arc32, 'recordTestResult'),
                    args: [agent.addr, id, 70n],
                });
            }

            // Verify ESTABLISHED tier (3)
            const tierResult = await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'getAgentTier'),
                args: [agent.addr],
            });

            expect(tierResult.return?.returnValue).toBe(3n); // TIER_ESTABLISHED
        });

        test('agent reaches TRUSTED tier after 5 excellent tests', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);

            const agent = await generateAccount({ initialFunds: (10).algo() });

            // Register
            await algorand.send.appCallMethodCall({
                sender: agent.addr,
                appId,
                method: getMethod(artifacts.arc32, 'registerAgent'),
                args: [
                    'excellent-agent',
                    'https://excellent.example.com/api',
                    '{}',
                    algorand.createTransaction.payment({
                        sender: agent.addr,
                        receiver: appAddress,
                        amount: (1).algo(),
                    }),
                ],
            });

            // Create 5 challenges and score 90/100 on each
            for (let i = 1; i <= 5; i++) {
                await algorand.send.appCallMethodCall({
                    sender: testAccount.addr,
                    appId,
                    method: getMethod(artifacts.arc32, 'createChallenge'),
                    args: [`challenge-${i}`, 'api', `Challenge ${i}`, 100n],
                });

                await algorand.send.appCallMethodCall({
                    sender: testAccount.addr,
                    appId,
                    method: getMethod(artifacts.arc32, 'recordTestResult'),
                    args: [agent.addr, `challenge-${i}`, 90n],
                });
            }

            // Verify TRUSTED tier (4)
            const tierResult = await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'getAgentTier'),
                args: [agent.addr],
            });

            expect(tierResult.return?.returnValue).toBe(4n); // TIER_TRUSTED

            // Verify score is 90%
            const scoreResult = await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'getAgentScore'),
                args: [agent.addr],
            });

            expect(scoreResult.return?.returnValue).toBe(90n);
        });

        test('deactivated challenge cannot be used for scoring', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);

            const agent = await generateAccount({ initialFunds: (10).algo() });

            await algorand.send.appCallMethodCall({
                sender: agent.addr,
                appId,
                method: getMethod(artifacts.arc32, 'registerAgent'),
                args: [
                    'test-agent',
                    'https://test.example.com/api',
                    '{}',
                    algorand.createTransaction.payment({
                        sender: agent.addr,
                        receiver: appAddress,
                        amount: (1).algo(),
                    }),
                ],
            });

            // Create and deactivate challenge
            await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'createChallenge'),
                args: ['old-test', 'api', 'Old test', 100n],
            });

            await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'deactivateChallenge'),
                args: ['old-test'],
            });

            // Try to record result against deactivated challenge
            await expect(
                algorand.send.appCallMethodCall({
                    sender: testAccount.addr,
                    appId,
                    method: getMethod(artifacts.arc32, 'recordTestResult'),
                    args: [agent.addr, 'old-test', 50n],
                }),
            ).rejects.toThrow();
        });
    });

    // ── Admin Functions ───────────────────────────────────────

    describe('Admin Functions', () => {
        test('updates minimum stake', async () => {
            const { algorand, testAccount } = fixture.context;
            const { appId } = await deployContract(algorand, testAccount.addr, artifacts);

            await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'updateMinStake'),
                args: [2_000_000n], // 2 ALGO
            });

            const state = await algorand.app.getGlobalState(appId);
            expect(state['min_stake']?.value).toBe(2_000_000n);
        });

        test('transfers admin role', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId } = await deployContract(algorand, testAccount.addr, artifacts);

            const newAdmin = await generateAccount({ initialFunds: (5).algo() });

            await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'transferAdmin'),
                args: [newAdmin.addr],
            });

            // Old admin can no longer create challenges
            await expect(
                algorand.send.appCallMethodCall({
                    sender: testAccount.addr,
                    appId,
                    method: getMethod(artifacts.arc32, 'createChallenge'),
                    args: ['test', 'test', 'test', 100n],
                }),
            ).rejects.toThrow();

            // New admin can
            const result = await algorand.send.appCallMethodCall({
                sender: newAdmin.addr,
                appId,
                method: getMethod(artifacts.arc32, 'createChallenge'),
                args: ['test', 'test', 'test', 100n],
            });

            expect(result.confirmation).toBeDefined();
        });

        test('admin removes agent and returns stake', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);

            const agent = await generateAccount({ initialFunds: (10).algo() });

            // Register
            await algorand.send.appCallMethodCall({
                sender: agent.addr,
                appId,
                method: getMethod(artifacts.arc32, 'registerAgent'),
                args: [
                    'bad-agent',
                    'https://bad.example.com/api',
                    '{}',
                    algorand.createTransaction.payment({
                        sender: agent.addr,
                        receiver: appAddress,
                        amount: (1).algo(),
                    }),
                ],
            });

            const balanceBefore = (await algorand.account.getInformation(agent.addr)).balance;

            // Admin removes (needs extraFee to cover inner payment txn)
            await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'adminRemoveAgent'),
                args: [agent.addr],
                extraFee: (1000).microAlgo(),
            });

            // Stake returned
            const balanceAfter = (await algorand.account.getInformation(agent.addr)).balance;
            expect(balanceAfter.microAlgo).toBeGreaterThan(balanceBefore.microAlgo);

            // Agent count is 0
            const state = await algorand.app.getGlobalState(appId);
            expect(state['agent_count']?.value).toBe(0n);
        });
    });

    // ── Read Methods ──────────────────────────────────────────

    describe('Read Methods', () => {
        test('getAgentInfo returns full record', async () => {
            const { algorand, testAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);

            await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'registerAgent'),
                args: [
                    'corvid-agent',
                    'https://corvid.example.com/api',
                    '{"version":"0.21.0"}',
                    algorand.createTransaction.payment({
                        sender: testAccount.addr,
                        receiver: appAddress,
                        amount: (1).algo(),
                    }),
                ],
            });

            const result = await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'getAgentInfo'),
                args: [testAccount.addr],
            });

            expect(result.return?.returnValue).toBeDefined();
            // Return is a tuple: [name, endpoint, metadata, tier, totalScore, totalMaxScore, testCount, lastHB, regRound, stake]
            const record = result.return!.returnValue as any[];
            expect(record[0]).toBe('corvid-agent');
            expect(record[1]).toBe('https://corvid.example.com/api');
            expect(record[3]).toBe(1n); // TIER_REGISTERED
            expect(record[9]).toBe(1_000_000n); // 1 ALGO stake
        });

        test('getChallengeInfo returns challenge details', async () => {
            const { algorand, testAccount } = fixture.context;
            const { appId } = await deployContract(algorand, testAccount.addr, artifacts);

            await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'createChallenge'),
                args: ['api-latency', 'performance', 'Measure API response latency', 100n],
            });

            const result = await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'getChallengeInfo'),
                args: ['api-latency'],
            });

            expect(result.return?.returnValue).toBeDefined();
            const challenge = result.return!.returnValue as any[];
            expect(challenge[0]).toBe('performance');
            expect(challenge[2]).toBe(100n);
            expect(challenge[3]).toBe(1n); // active
        });

        test('getAgentTestCount returns correct count', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);

            const agent = await generateAccount({ initialFunds: (10).algo() });

            await algorand.send.appCallMethodCall({
                sender: agent.addr,
                appId,
                method: getMethod(artifacts.arc32, 'registerAgent'),
                args: [
                    'test-agent',
                    'https://test.example.com/api',
                    '{}',
                    algorand.createTransaction.payment({
                        sender: agent.addr,
                        receiver: appAddress,
                        amount: (1).algo(),
                    }),
                ],
            });

            // 0 tests initially
            let countResult = await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'getAgentTestCount'),
                args: [agent.addr],
            });
            expect(countResult.return?.returnValue).toBe(0n);

            // Record 2 tests
            for (const id of ['c1', 'c2']) {
                await algorand.send.appCallMethodCall({
                    sender: testAccount.addr,
                    appId,
                    method: getMethod(artifacts.arc32, 'createChallenge'),
                    args: [id, 'test', `Test ${id}`, 100n],
                });
                await algorand.send.appCallMethodCall({
                    sender: testAccount.addr,
                    appId,
                    method: getMethod(artifacts.arc32, 'recordTestResult'),
                    args: [agent.addr, id, 80n],
                });
            }

            countResult = await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'getAgentTestCount'),
                args: [agent.addr],
            });
            expect(countResult.return?.returnValue).toBe(2n);
        });

        test('getAgentScore returns 0 for untested agent', async () => {
            const { algorand, testAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);

            await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'registerAgent'),
                args: [
                    'new-agent',
                    'https://new.example.com/api',
                    '{}',
                    algorand.createTransaction.payment({
                        sender: testAccount.addr,
                        receiver: appAddress,
                        amount: (1).algo(),
                    }),
                ],
            });

            const scoreResult = await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'getAgentScore'),
                args: [testAccount.addr],
            });
            expect(scoreResult.return?.returnValue).toBe(0n);
        });

        test('getAgentScore returns correct percentage', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);

            const agent = await generateAccount({ initialFunds: (10).algo() });

            await algorand.send.appCallMethodCall({
                sender: agent.addr,
                appId,
                method: getMethod(artifacts.arc32, 'registerAgent'),
                args: [
                    'test-agent',
                    'https://test.example.com/api',
                    '{}',
                    algorand.createTransaction.payment({
                        sender: agent.addr,
                        receiver: appAddress,
                        amount: (1).algo(),
                    }),
                ],
            });

            // Create challenge with maxScore 200, score 150 → 75%
            await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'createChallenge'),
                args: ['big-test', 'api', 'Big test', 200n],
            });

            await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'recordTestResult'),
                args: [agent.addr, 'big-test', 150n],
            });

            const scoreResult = await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'getAgentScore'),
                args: [agent.addr],
            });
            expect(scoreResult.return?.returnValue).toBe(75n);
        });
    });

    // ── Tier Boundary Conditions ──────────────────────────────

    describe('Tier Boundary Conditions', () => {
        /** Helper: register agent, create N challenges, record scores, return tier */
        async function setupAndGetTier(
            algorand: any,
            admin: any,
            appId: bigint,
            appAddress: string,
            agent: any,
            scores: number[],
            maxScore = 100,
        ): Promise<bigint> {
            // Register agent
            await algorand.send.appCallMethodCall({
                sender: agent.addr,
                appId,
                method: getMethod(artifacts.arc32, 'registerAgent'),
                args: [
                    'tier-test-agent',
                    'https://tier.example.com/api',
                    '{}',
                    algorand.createTransaction.payment({
                        sender: agent.addr,
                        receiver: appAddress,
                        amount: (1).algo(),
                    }),
                ],
            });

            // Create challenges and record scores
            for (let i = 0; i < scores.length; i++) {
                const id = `tier-c-${i}`;
                await algorand.send.appCallMethodCall({
                    sender: admin.addr,
                    appId,
                    method: getMethod(artifacts.arc32, 'createChallenge'),
                    args: [id, 'test', `Tier test ${i}`, BigInt(maxScore)],
                });
                await algorand.send.appCallMethodCall({
                    sender: admin.addr,
                    appId,
                    method: getMethod(artifacts.arc32, 'recordTestResult'),
                    args: [agent.addr, id, BigInt(scores[i])],
                });
            }

            const tierResult = await algorand.send.appCallMethodCall({
                sender: admin.addr,
                appId,
                method: getMethod(artifacts.arc32, 'getAgentTier'),
                args: [agent.addr],
            });
            return tierResult.return?.returnValue as bigint;
        }

        test('1 test → TESTED regardless of score', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);
            const agent = await generateAccount({ initialFunds: (10).algo() });

            const tier = await setupAndGetTier(algorand, testAccount, appId, appAddress, agent, [100]);
            expect(tier).toBe(2n); // TIER_TESTED
        });

        test('2 tests at 100% → still TESTED (need 3 for ESTABLISHED)', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);
            const agent = await generateAccount({ initialFunds: (10).algo() });

            const tier = await setupAndGetTier(algorand, testAccount, appId, appAddress, agent, [100, 100]);
            expect(tier).toBe(2n); // TIER_TESTED
        });

        test('3 tests at exactly 60% → ESTABLISHED (boundary)', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);
            const agent = await generateAccount({ initialFunds: (10).algo() });

            const tier = await setupAndGetTier(algorand, testAccount, appId, appAddress, agent, [60, 60, 60]);
            expect(tier).toBe(3n); // TIER_ESTABLISHED
        });

        test('3 tests at 59% → stays TESTED (below ESTABLISHED threshold)', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);
            const agent = await generateAccount({ initialFunds: (10).algo() });

            // 59/100 * 3 = 177/300 = 59% < 60%
            const tier = await setupAndGetTier(algorand, testAccount, appId, appAddress, agent, [59, 59, 59]);
            expect(tier).toBe(2n); // TIER_TESTED
        });

        test('4 tests at 100% → ESTABLISHED (need 5 for TRUSTED)', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);
            const agent = await generateAccount({ initialFunds: (10).algo() });

            const tier = await setupAndGetTier(algorand, testAccount, appId, appAddress, agent, [100, 100, 100, 100]);
            expect(tier).toBe(3n); // TIER_ESTABLISHED
        });

        test('5 tests at exactly 80% → TRUSTED (boundary)', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);
            const agent = await generateAccount({ initialFunds: (10).algo() });

            const tier = await setupAndGetTier(algorand, testAccount, appId, appAddress, agent, [80, 80, 80, 80, 80]);
            expect(tier).toBe(4n); // TIER_TRUSTED
        });

        test('5 tests at 79% → stays ESTABLISHED (below TRUSTED threshold)', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);
            const agent = await generateAccount({ initialFunds: (10).algo() });

            // 79/100 * 5 = 395/500 = 79% < 80%
            const tier = await setupAndGetTier(algorand, testAccount, appId, appAddress, agent, [79, 79, 79, 79, 79]);
            expect(tier).toBe(3n); // TIER_ESTABLISHED
        });

        test('agent with 0/100 score stays TESTED', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);
            const agent = await generateAccount({ initialFunds: (10).algo() });

            const tier = await setupAndGetTier(algorand, testAccount, appId, appAddress, agent, [0, 0, 0]);
            expect(tier).toBe(2n); // TIER_TESTED (3 tests but 0% < 60%)
        });

        test('perfect score across 5 tests → TRUSTED', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);
            const agent = await generateAccount({ initialFunds: (10).algo() });

            const tier = await setupAndGetTier(algorand, testAccount, appId, appAddress, agent, [100, 100, 100, 100, 100]);
            expect(tier).toBe(4n); // TIER_TRUSTED
        });
    });

    // ── Authorization Guards ──────────────────────────────────

    describe('Authorization Guards', () => {
        test('non-admin cannot record test results', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);

            const agent = await generateAccount({ initialFunds: (10).algo() });
            const stranger = await generateAccount({ initialFunds: (5).algo() });

            await algorand.send.appCallMethodCall({
                sender: agent.addr,
                appId,
                method: getMethod(artifacts.arc32, 'registerAgent'),
                args: [
                    'test-agent',
                    'https://test.example.com/api',
                    '{}',
                    algorand.createTransaction.payment({
                        sender: agent.addr,
                        receiver: appAddress,
                        amount: (1).algo(),
                    }),
                ],
            });

            await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'createChallenge'),
                args: ['auth-test', 'test', 'Auth test', 100n],
            });

            await expect(
                algorand.send.appCallMethodCall({
                    sender: stranger.addr,
                    appId,
                    method: getMethod(artifacts.arc32, 'recordTestResult'),
                    args: [agent.addr, 'auth-test', 85n],
                }),
            ).rejects.toThrow();
        });

        test('non-admin cannot deactivate challenge', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId } = await deployContract(algorand, testAccount.addr, artifacts);

            const stranger = await generateAccount({ initialFunds: (5).algo() });

            await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'createChallenge'),
                args: ['auth-chal', 'test', 'Auth test', 100n],
            });

            await expect(
                algorand.send.appCallMethodCall({
                    sender: stranger.addr,
                    appId,
                    method: getMethod(artifacts.arc32, 'deactivateChallenge'),
                    args: ['auth-chal'],
                }),
            ).rejects.toThrow();
        });

        test('non-admin cannot update min stake', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId } = await deployContract(algorand, testAccount.addr, artifacts);

            const stranger = await generateAccount({ initialFunds: (5).algo() });

            await expect(
                algorand.send.appCallMethodCall({
                    sender: stranger.addr,
                    appId,
                    method: getMethod(artifacts.arc32, 'updateMinStake'),
                    args: [2_000_000n],
                }),
            ).rejects.toThrow();
        });

        test('non-admin cannot transfer admin', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId } = await deployContract(algorand, testAccount.addr, artifacts);

            const stranger = await generateAccount({ initialFunds: (5).algo() });

            await expect(
                algorand.send.appCallMethodCall({
                    sender: stranger.addr,
                    appId,
                    method: getMethod(artifacts.arc32, 'transferAdmin'),
                    args: [stranger.addr],
                }),
            ).rejects.toThrow();
        });

        test('non-admin cannot remove agent', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);

            const agent = await generateAccount({ initialFunds: (10).algo() });
            const stranger = await generateAccount({ initialFunds: (5).algo() });

            await algorand.send.appCallMethodCall({
                sender: agent.addr,
                appId,
                method: getMethod(artifacts.arc32, 'registerAgent'),
                args: [
                    'test-agent',
                    'https://test.example.com/api',
                    '{}',
                    algorand.createTransaction.payment({
                        sender: agent.addr,
                        receiver: appAddress,
                        amount: (1).algo(),
                    }),
                ],
            });

            await expect(
                algorand.send.appCallMethodCall({
                    sender: stranger.addr,
                    appId,
                    method: getMethod(artifacts.arc32, 'adminRemoveAgent'),
                    args: [agent.addr],
                    extraFee: (1000).microAlgo(),
                }),
            ).rejects.toThrow();
        });

        test('non-admin cannot set registration open', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId } = await deployContract(algorand, testAccount.addr, artifacts);

            const stranger = await generateAccount({ initialFunds: (5).algo() });

            await expect(
                algorand.send.appCallMethodCall({
                    sender: stranger.addr,
                    appId,
                    method: getMethod(artifacts.arc32, 'setRegistrationOpen'),
                    args: [0n],
                }),
            ).rejects.toThrow();
        });
    });

    // ── Edge Cases ────────────────────────────────────────────

    describe('Edge Cases', () => {
        test('score exceeding maxScore is rejected', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);

            const agent = await generateAccount({ initialFunds: (10).algo() });

            await algorand.send.appCallMethodCall({
                sender: agent.addr,
                appId,
                method: getMethod(artifacts.arc32, 'registerAgent'),
                args: [
                    'test-agent',
                    'https://test.example.com/api',
                    '{}',
                    algorand.createTransaction.payment({
                        sender: agent.addr,
                        receiver: appAddress,
                        amount: (1).algo(),
                    }),
                ],
            });

            await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'createChallenge'),
                args: ['edge-test', 'test', 'Edge test', 100n],
            });

            // Score 101 > maxScore 100 should fail
            await expect(
                algorand.send.appCallMethodCall({
                    sender: testAccount.addr,
                    appId,
                    method: getMethod(artifacts.arc32, 'recordTestResult'),
                    args: [agent.addr, 'edge-test', 101n],
                }),
            ).rejects.toThrow();
        });

        test('recording test for non-existent agent fails', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId } = await deployContract(algorand, testAccount.addr, artifacts);

            const ghost = await generateAccount({ initialFunds: (5).algo() });

            await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'createChallenge'),
                args: ['ghost-test', 'test', 'Ghost test', 100n],
            });

            await expect(
                algorand.send.appCallMethodCall({
                    sender: testAccount.addr,
                    appId,
                    method: getMethod(artifacts.arc32, 'recordTestResult'),
                    args: [ghost.addr, 'ghost-test', 50n],
                }),
            ).rejects.toThrow();
        });

        test('recording test for non-existent challenge fails', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);

            const agent = await generateAccount({ initialFunds: (10).algo() });

            await algorand.send.appCallMethodCall({
                sender: agent.addr,
                appId,
                method: getMethod(artifacts.arc32, 'registerAgent'),
                args: [
                    'test-agent',
                    'https://test.example.com/api',
                    '{}',
                    algorand.createTransaction.payment({
                        sender: agent.addr,
                        receiver: appAddress,
                        amount: (1).algo(),
                    }),
                ],
            });

            await expect(
                algorand.send.appCallMethodCall({
                    sender: testAccount.addr,
                    appId,
                    method: getMethod(artifacts.arc32, 'recordTestResult'),
                    args: [agent.addr, 'nonexistent', 50n],
                }),
            ).rejects.toThrow();
        });

        test('update on unregistered agent fails', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId } = await deployContract(algorand, testAccount.addr, artifacts);

            const stranger = await generateAccount({ initialFunds: (5).algo() });

            await expect(
                algorand.send.appCallMethodCall({
                    sender: stranger.addr,
                    appId,
                    method: getMethod(artifacts.arc32, 'updateAgent'),
                    args: ['ghost', 'https://ghost.example.com', '{}'],
                }),
            ).rejects.toThrow();
        });

        test('deregister unregistered agent fails', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId } = await deployContract(algorand, testAccount.addr, artifacts);

            const stranger = await generateAccount({ initialFunds: (5).algo() });

            await expect(
                algorand.send.appCallMethodCall({
                    sender: stranger.addr,
                    appId,
                    method: getMethod(artifacts.arc32, 'deregister'),
                    args: [],
                    extraFee: (1000).microAlgo(),
                }),
            ).rejects.toThrow();
        });

        test('registration with exactly minimum stake succeeds', async () => {
            const { algorand, testAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);

            // minStake is 1_000_000 (1 ALGO) by default — exact amount should work
            const result = await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'registerAgent'),
                args: [
                    'exact-stake-agent',
                    'https://exact.example.com/api',
                    '{}',
                    algorand.createTransaction.payment({
                        sender: testAccount.addr,
                        receiver: appAddress,
                        amount: (1_000_000).microAlgo(), // exactly minStake
                    }),
                ],
            });

            expect(result.confirmation).toBeDefined();
        });

        test('registration enforces updated minimum stake', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);

            // Increase min stake to 2 ALGO
            await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'updateMinStake'),
                args: [2_000_000n],
            });

            const agent = await generateAccount({ initialFunds: (10).algo() });

            // 1 ALGO stake should now fail
            await expect(
                algorand.send.appCallMethodCall({
                    sender: agent.addr,
                    appId,
                    method: getMethod(artifacts.arc32, 'registerAgent'),
                    args: [
                        'underpaid-agent',
                        'https://underpaid.example.com/api',
                        '{}',
                        algorand.createTransaction.payment({
                            sender: agent.addr,
                            receiver: appAddress,
                            amount: (1).algo(),
                        }),
                    ],
                }),
            ).rejects.toThrow();

            // 2 ALGO stake should succeed
            const result = await algorand.send.appCallMethodCall({
                sender: agent.addr,
                appId,
                method: getMethod(artifacts.arc32, 'registerAgent'),
                args: [
                    'paid-agent',
                    'https://paid.example.com/api',
                    '{}',
                    algorand.createTransaction.payment({
                        sender: agent.addr,
                        receiver: appAddress,
                        amount: (2).algo(),
                    }),
                ],
            });

            expect(result.confirmation).toBeDefined();
        });

        test('re-registration after deregistration works', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);

            const agent = await generateAccount({ initialFunds: (10).algo() });

            // Register
            await algorand.send.appCallMethodCall({
                sender: agent.addr,
                appId,
                method: getMethod(artifacts.arc32, 'registerAgent'),
                args: [
                    'temp-agent',
                    'https://temp.example.com/api',
                    '{}',
                    algorand.createTransaction.payment({
                        sender: agent.addr,
                        receiver: appAddress,
                        amount: (1).algo(),
                    }),
                ],
            });

            // Deregister
            await algorand.send.appCallMethodCall({
                sender: agent.addr,
                appId,
                method: getMethod(artifacts.arc32, 'deregister'),
                args: [],
                extraFee: (1000).microAlgo(),
            });

            // Re-register with different name
            const result = await algorand.send.appCallMethodCall({
                sender: agent.addr,
                appId,
                method: getMethod(artifacts.arc32, 'registerAgent'),
                args: [
                    'temp-agent-v2',
                    'https://temp-v2.example.com/api',
                    '{}',
                    algorand.createTransaction.payment({
                        sender: agent.addr,
                        receiver: appAddress,
                        amount: (1).algo(),
                    }),
                ],
            });

            expect(result.confirmation).toBeDefined();

            // Verify fresh state (tier should be REGISTERED, not carry over)
            const tierResult = await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'getAgentTier'),
                args: [agent.addr],
            });
            expect(tierResult.return?.returnValue).toBe(1n); // TIER_REGISTERED
        });

        test('multiple agents tracked independently', async () => {
            const { algorand, testAccount, generateAccount } = fixture.context;
            const { appId, appAddress } = await deployContract(algorand, testAccount.addr, artifacts);

            const agent1 = await generateAccount({ initialFunds: (10).algo() });
            const agent2 = await generateAccount({ initialFunds: (10).algo() });

            // Register both
            for (const [agent, name] of [[agent1, 'agent-1'], [agent2, 'agent-2']] as const) {
                await algorand.send.appCallMethodCall({
                    sender: agent.addr,
                    appId,
                    method: getMethod(artifacts.arc32, 'registerAgent'),
                    args: [
                        name,
                        `https://${name}.example.com/api`,
                        '{}',
                        algorand.createTransaction.payment({
                            sender: agent.addr,
                            receiver: appAddress,
                            amount: (1).algo(),
                        }),
                    ],
                });
            }

            // Create challenge
            await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'createChallenge'),
                args: ['multi-test', 'test', 'Multi agent test', 100n],
            });

            // Agent 1 scores high, agent 2 scores low
            await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'recordTestResult'),
                args: [agent1.addr, 'multi-test', 95n],
            });

            await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'recordTestResult'),
                args: [agent2.addr, 'multi-test', 20n],
            });

            // Verify independent scores
            const score1 = await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'getAgentScore'),
                args: [agent1.addr],
            });
            const score2 = await algorand.send.appCallMethodCall({
                sender: testAccount.addr,
                appId,
                method: getMethod(artifacts.arc32, 'getAgentScore'),
                args: [agent2.addr],
            });

            expect(score1.return?.returnValue).toBe(95n);
            expect(score2.return?.returnValue).toBe(20n);

            // Verify agent count
            const state = await algorand.app.getGlobalState(appId);
            expect(state['agent_count']?.value).toBe(2n);
        });
    });
});
