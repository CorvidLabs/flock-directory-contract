import { Contract } from '@algorandfoundation/tealscript';

/**
 * Flock Directory Contract
 *
 * On-chain agent registry with reputation scoring and capability testing.
 *
 * Box storage layout:
 * - agent:{address} → AgentRecord (registration, metadata, scores)
 * - test:{address}:{testId} → TestResult (automated test outcomes)
 */
export class FlockDirectory extends Contract {
    // ── Global State ──────────────────────────────────────────────

    /** Total number of registered agents */
    agentCount = GlobalStateKey<uint64>({ key: 'agent_count' });

    /** Minimum stake required for registration (in microAlgos) */
    minStake = GlobalStateKey<uint64>({ key: 'min_stake' });

    /** Contract admin address */
    admin = GlobalStateKey<Address>({ key: 'admin' });

    // ── Lifecycle ─────────────────────────────────────────────────

    createApplication(): void {
        this.admin.value = this.txn.sender;
        this.agentCount.value = 0;
        this.minStake.value = 1_000_000; // 1 ALGO default
    }

    // ── Agent Registration ────────────────────────────────────────

    /**
     * Register a new agent in the directory.
     * Requires minimum stake payment in the same group transaction.
     */
    registerAgent(
        name: string,
        endpoint: string,
        metadata: string,
        payment: PayTxn,
    ): void {
        assert(payment.amount >= this.minStake.value, 'Insufficient stake');
        assert(payment.receiver === this.app.address, 'Payment must go to contract');
        assert(name.length > 0 && name.length <= 64, 'Invalid name length');

        // Store agent record in box storage
        const boxKey = 'agent:' + this.txn.sender;
        assert(!this.app.box(boxKey).exists, 'Agent already registered');

        this.app.box(boxKey).value = name + '|' + endpoint + '|' + metadata;
        this.agentCount.value = this.agentCount.value + 1;
    }

    /**
     * Update agent heartbeat timestamp.
     * Called periodically by registered agents to prove liveness.
     */
    heartbeat(): void {
        const boxKey = 'agent:' + this.txn.sender;
        assert(this.app.box(boxKey).exists, 'Agent not registered');
        // Heartbeat is recorded by the transaction timestamp on-chain
    }

    /**
     * Record a test result for an agent.
     * Only callable by the contract admin (test orchestrator).
     */
    recordTestResult(
        agentAddress: Address,
        testId: string,
        score: uint64,
        maxScore: uint64,
        category: string,
    ): void {
        assert(this.txn.sender === this.admin.value, 'Only admin can record tests');
        assert(score <= maxScore, 'Score cannot exceed max');

        const boxKey = 'test:' + agentAddress + ':' + testId;
        this.app.box(boxKey).value = score.toString() + '/' + maxScore.toString() + '|' + category;
    }

    /**
     * Deregister an agent and return their stake.
     */
    deregister(): void {
        const boxKey = 'agent:' + this.txn.sender;
        assert(this.app.box(boxKey).exists, 'Agent not registered');

        this.app.box(boxKey).delete();
        this.agentCount.value = this.agentCount.value - 1;

        // Return stake
        sendPayment({
            receiver: this.txn.sender,
            amount: this.minStake.value,
        });
    }

    // ── Admin ─────────────────────────────────────────────────────

    /**
     * Update minimum stake requirement.
     */
    updateMinStake(newMinStake: uint64): void {
        assert(this.txn.sender === this.admin.value, 'Only admin');
        this.minStake.value = newMinStake;
    }

    /**
     * Transfer admin role.
     */
    transferAdmin(newAdmin: Address): void {
        assert(this.txn.sender === this.admin.value, 'Only admin');
        this.admin.value = newAdmin;
    }
}
