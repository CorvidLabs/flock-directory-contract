import { Contract } from '@algorandfoundation/tealscript';

// Reputation tiers
const TIER_REGISTERED = 1;
const TIER_TESTED = 2;
const TIER_ESTABLISHED = 3;
const TIER_TRUSTED = 4;

// Agent record: stored as ABI tuple in BoxMap
// We store numeric fields in global/local state where possible,
// and use BoxMap for the main agent data.

type AgentRecord = {
    name: string;
    endpoint: string;
    metadata: string;
    tier: uint64;
    totalScore: uint64;
    totalMaxScore: uint64;
    testCount: uint64;
    lastHeartbeatRound: uint64;
    registrationRound: uint64;
    stake: uint64;
};

type TestResult = {
    score: uint64;
    maxScore: uint64;
    category: string;
    round: uint64;
};

type Challenge = {
    category: string;
    description: string;
    maxScore: uint64;
    active: uint64;
};

/**
 * Flock Directory Contract
 *
 * On-chain agent registry with reputation scoring and capability testing.
 * Uses BoxMap for structured agent records, test results, and challenges.
 */
export class FlockDirectory extends Contract {
    // ── Global State ──────────────────────────────────────────────

    agentCount = GlobalStateKey<uint64>({ key: 'agent_count' });
    minStake = GlobalStateKey<uint64>({ key: 'min_stake' });
    admin = GlobalStateKey<Address>({ key: 'admin' });
    challengeCount = GlobalStateKey<uint64>({ key: 'chal_count' });
    registrationOpen = GlobalStateKey<uint64>({ key: 'reg_open' });

    // ── Box Storage ───────────────────────────────────────────────

    /** agent:{address} → AgentRecord */
    agents = BoxMap<Address, AgentRecord>({ prefix: 'a' });

    /** test:[address, testId] → TestResult */
    testResults = BoxMap<[Address, string], TestResult>({ prefix: 't', dynamicSize: true });

    /** challenge:{id} → Challenge */
    challenges = BoxMap<string, Challenge>({ prefix: 'c', dynamicSize: true });

    // ── Lifecycle ─────────────────────────────────────────────────

    createApplication(): void {
        this.admin.value = this.txn.sender;
        this.agentCount.value = 0;
        this.minStake.value = 1_000_000; // 1 ALGO default
        this.challengeCount.value = 0;
        this.registrationOpen.value = 1;
    }

    // ── Agent Registration ────────────────────────────────────────

    registerAgent(
        name: string,
        endpoint: string,
        metadata: string,
        payment: PayTxn,
    ): void {
        assert(this.registrationOpen.value === 1, 'Registration is closed');
        assert(payment.amount >= this.minStake.value, 'Insufficient stake');
        assert(payment.receiver === this.app.address, 'Payment must go to contract');
        assert(name.length > 0 && name.length <= 64, 'Invalid name length');
        assert(endpoint.length > 0 && endpoint.length <= 256, 'Invalid endpoint length');
        assert(metadata.length <= 512, 'Metadata too long');
        assert(!this.agents(this.txn.sender).exists, 'Agent already registered');

        this.agents(this.txn.sender).value = {
            name: name,
            endpoint: endpoint,
            metadata: metadata,
            tier: TIER_REGISTERED,
            totalScore: 0,
            totalMaxScore: 0,
            testCount: 0,
            lastHeartbeatRound: globals.round,
            registrationRound: globals.round,
            stake: payment.amount,
        };

        this.agentCount.value = this.agentCount.value + 1;
    }

    updateAgent(
        name: string,
        endpoint: string,
        metadata: string,
    ): void {
        assert(name.length > 0 && name.length <= 64, 'Invalid name length');
        assert(endpoint.length > 0 && endpoint.length <= 256, 'Invalid endpoint length');
        assert(metadata.length <= 512, 'Metadata too long');
        assert(this.agents(this.txn.sender).exists, 'Agent not registered');

        const existing = clone(this.agents(this.txn.sender).value);

        this.agents(this.txn.sender).value = {
            name: name,
            endpoint: endpoint,
            metadata: metadata,
            tier: existing.tier,
            totalScore: existing.totalScore,
            totalMaxScore: existing.totalMaxScore,
            testCount: existing.testCount,
            lastHeartbeatRound: existing.lastHeartbeatRound,
            registrationRound: existing.registrationRound,
            stake: existing.stake,
        };
    }

    heartbeat(): void {
        assert(this.agents(this.txn.sender).exists, 'Agent not registered');

        const existing = clone(this.agents(this.txn.sender).value);

        this.agents(this.txn.sender).value = {
            name: existing.name,
            endpoint: existing.endpoint,
            metadata: existing.metadata,
            tier: existing.tier,
            totalScore: existing.totalScore,
            totalMaxScore: existing.totalMaxScore,
            testCount: existing.testCount,
            lastHeartbeatRound: globals.round,
            registrationRound: existing.registrationRound,
            stake: existing.stake,
        };
    }

    deregister(): void {
        assert(this.agents(this.txn.sender).exists, 'Agent not registered');

        const existing = clone(this.agents(this.txn.sender).value);
        const stakeAmount = existing.stake;

        this.agents(this.txn.sender).delete();
        this.agentCount.value = this.agentCount.value - 1;

        sendPayment({
            receiver: this.txn.sender,
            amount: stakeAmount,
        });
    }

    // ── Test Challenge Protocol ───────────────────────────────────

    createChallenge(
        challengeId: string,
        category: string,
        description: string,
        maxScore: uint64,
    ): void {
        assert(this.txn.sender === this.admin.value, 'Only admin');
        assert(challengeId.length > 0 && challengeId.length <= 32, 'Invalid challenge ID');
        assert(category.length > 0 && category.length <= 32, 'Invalid category');
        assert(!this.challenges(challengeId).exists, 'Challenge already exists');

        this.challenges(challengeId).value = {
            category: category,
            description: description,
            maxScore: maxScore,
            active: 1,
        };

        this.challengeCount.value = this.challengeCount.value + 1;
    }

    deactivateChallenge(challengeId: string): void {
        assert(this.txn.sender === this.admin.value, 'Only admin');
        assert(this.challenges(challengeId).exists, 'Challenge not found');

        const existing = clone(this.challenges(challengeId).value);

        this.challenges(challengeId).value = {
            category: existing.category,
            description: existing.description,
            maxScore: existing.maxScore,
            active: 0,
        };
    }

    recordTestResult(
        agentAddress: Address,
        challengeId: string,
        score: uint64,
    ): void {
        assert(this.txn.sender === this.admin.value, 'Only admin can record tests');

        // Verify challenge exists and is active
        assert(this.challenges(challengeId).exists, 'Challenge not found');
        const challenge = clone(this.challenges(challengeId).value);
        assert(challenge.active === 1, 'Challenge is not active');
        assert(score <= challenge.maxScore, 'Score exceeds max');

        // Verify agent exists
        assert(this.agents(agentAddress).exists, 'Agent not registered');

        // Store individual test result
        this.testResults([agentAddress, challengeId]).value = {
            score: score,
            maxScore: challenge.maxScore,
            category: challenge.category,
            round: globals.round,
        };

        // Update agent aggregate scores
        const agent = clone(this.agents(agentAddress).value);
        const newTotalScore = agent.totalScore + score;
        const newTotalMaxScore = agent.totalMaxScore + challenge.maxScore;
        const newTestCount = agent.testCount + 1;
        const newTier = this.calculateTier(newTotalScore, newTotalMaxScore, newTestCount);

        this.agents(agentAddress).value = {
            name: agent.name,
            endpoint: agent.endpoint,
            metadata: agent.metadata,
            tier: newTier,
            totalScore: newTotalScore,
            totalMaxScore: newTotalMaxScore,
            testCount: newTestCount,
            lastHeartbeatRound: agent.lastHeartbeatRound,
            registrationRound: agent.registrationRound,
            stake: agent.stake,
        };
    }

    // ── Read Methods ──────────────────────────────────────────────

    getAgentTier(agentAddress: Address): uint64 {
        assert(this.agents(agentAddress).exists, 'Agent not registered');
        return this.agents(agentAddress).value.tier;
    }

    getAgentScore(agentAddress: Address): uint64 {
        assert(this.agents(agentAddress).exists, 'Agent not registered');
        const agent = this.agents(agentAddress).value;
        if (agent.totalMaxScore === 0) return 0;
        return (agent.totalScore * 100) / agent.totalMaxScore;
    }

    getAgentTestCount(agentAddress: Address): uint64 {
        assert(this.agents(agentAddress).exists, 'Agent not registered');
        return this.agents(agentAddress).value.testCount;
    }

    getAgentInfo(agentAddress: Address): AgentRecord {
        assert(this.agents(agentAddress).exists, 'Agent not registered');
        return this.agents(agentAddress).value;
    }

    getChallengeInfo(challengeId: string): Challenge {
        assert(this.challenges(challengeId).exists, 'Challenge not found');
        return this.challenges(challengeId).value;
    }

    // ── Admin ─────────────────────────────────────────────────────

    updateMinStake(newMinStake: uint64): void {
        assert(this.txn.sender === this.admin.value, 'Only admin');
        this.minStake.value = newMinStake;
    }

    transferAdmin(newAdmin: Address): void {
        assert(this.txn.sender === this.admin.value, 'Only admin');
        this.admin.value = newAdmin;
    }

    setRegistrationOpen(open: uint64): void {
        assert(this.txn.sender === this.admin.value, 'Only admin');
        assert(open === 0 || open === 1, 'Must be 0 or 1');
        this.registrationOpen.value = open;
    }

    adminRemoveAgent(agentAddress: Address): void {
        assert(this.txn.sender === this.admin.value, 'Only admin');
        assert(this.agents(agentAddress).exists, 'Agent not registered');

        const agent = clone(this.agents(agentAddress).value);

        this.agents(agentAddress).delete();
        this.agentCount.value = this.agentCount.value - 1;

        sendPayment({
            receiver: agentAddress,
            amount: agent.stake,
        });
    }

    // ── Internal Helpers ──────────────────────────────────────────

    private calculateTier(
        totalScore: uint64,
        totalMaxScore: uint64,
        testCount: uint64,
    ): uint64 {
        if (testCount === 0) return TIER_REGISTERED;

        const percentage = (totalScore * 100) / totalMaxScore;

        if (testCount >= 5 && percentage >= 80) return TIER_TRUSTED;
        if (testCount >= 3 && percentage >= 60) return TIER_ESTABLISHED;
        return TIER_TESTED;
    }
}
