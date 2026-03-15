/**
 * Update an existing agent's on-chain profile in the FlockDirectory contract.
 *
 * Attempts a direct updateAgent call first. If that fails (e.g. box can't resize),
 * falls back to deregister + re-register (resets tier/scores but preserves stake amount).
 *
 * Usage:
 *   DEPLOYER_MNEMONIC="..." bun x tsx scripts/update-agent.ts
 *
 * Options (env vars):
 *   AGENT_NAME      - Agent display name (default: "CorvidAgent")
 *   AGENT_ENDPOINT  - Agent API endpoint (default: "http://localhost:3000/api")
 *   AGENT_METADATA  - JSON metadata string (default: auto-generated)
 */

import algosdk from 'algosdk';

const APP_ID = 757178329;
const TESTNET_ALGOD = 'https://testnet-api.4160.nodely.dev';

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

function readAgentFromLog(logs: any[]): any | null {
    if (logs.length === 0) return null;
    const lastLog = logs[logs.length - 1];
    const logBytes = typeof lastLog === 'string' ? Buffer.from(lastLog, 'base64') : lastLog;
    if (logBytes[0] !== 0x15 || logBytes[1] !== 0x1f || logBytes[2] !== 0x7c || logBytes[3] !== 0x75) return null;
    const returnData = logBytes.slice(4);
    const tupleType = algosdk.ABIType.from(
        '(string,string,string,uint64,uint64,uint64,uint64,uint64,uint64,uint64)',
    );
    const decoded = tupleType.decode(returnData) as any[];
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

async function main() {
    // Load mnemonic from env or corvid-agent .env
    if (!process.env.DEPLOYER_MNEMONIC) {
        const fs = await import('fs');
        try {
            const envContent = fs.readFileSync('/Users/corvid-agent/corvid-agent/.env', 'utf-8');
            const match = envContent.match(/ALGOCHAT_MNEMONIC=["']?(.+?)["']?\s*$/m);
            if (match) {
                process.env.DEPLOYER_MNEMONIC = match[1];
            }
        } catch {
            // ignore
        }
        if (!process.env.DEPLOYER_MNEMONIC) {
            console.error('Error: No mnemonic found. Set DEPLOYER_MNEMONIC or ensure corvid-agent .env exists.');
            process.exit(1);
        }
    }

    const account = algosdk.mnemonicToSecretKey(process.env.DEPLOYER_MNEMONIC!);
    const algod = new algosdk.Algodv2('', TESTNET_ALGOD, '');
    const appAddr = algosdk.getApplicationAddress(APP_ID);

    const agentName = process.env.AGENT_NAME || 'CorvidAgent';
    const agentEndpoint = process.env.AGENT_ENDPOINT || 'http://localhost:3000/api';
    const agentMetadata = process.env.AGENT_METADATA || JSON.stringify({
        type: 'general',
        version: '0.30.0',
        capabilities: ['chat', 'code', 'research', 'a2a', 'algochat', 'councils', 'workflows', 'scheduling', 'github'],
        framework: 'corvid-agent',
        protocols: ['a2a', 'mcp', 'algochat'],
    });

    console.log(`\nFlockDirectory Agent Update (App ${APP_ID})`);
    console.log(`  Account:  ${account.addr}`);
    console.log(`  Name:     ${agentName}`);
    console.log(`  Endpoint: ${agentEndpoint}`);
    console.log(`  Metadata: ${agentMetadata}`);
    console.log('');

    // Verify agent is registered
    const boxName = agentBoxName(account.addr.toString());
    try {
        await algod.getApplicationBoxByName(APP_ID, boxName).do();
    } catch {
        console.error('Error: Agent is not registered on-chain. Run `bun run register` first.');
        process.exit(1);
    }

    // Read current state
    console.log('Current on-chain state:');
    const getInfoMethod = abiMethod(
        'getAgentInfo',
        [{ name: 'agentAddress', type: 'address' }],
        '(string,string,string,uint64,uint64,uint64,uint64,uint64,uint64,uint64)',
    );

    const sp0 = await algod.getTransactionParams().do();
    const infoTxn = algosdk.makeApplicationNoOpTxnFromObject({
        sender: account.addr,
        appIndex: APP_ID,
        appArgs: [
            getInfoMethod.getSelector(),
            algosdk.ABIType.from('address').encode(account.addr),
        ],
        boxes: [{ appIndex: APP_ID, name: boxName }],
        suggestedParams: sp0,
    });
    const signedInfo = infoTxn.signTxn(account.sk);
    await algod.sendRawTransaction(signedInfo).do();
    const infoResult = await algosdk.waitForConfirmation(algod, infoTxn.txID(), 4);
    const current = readAgentFromLog(infoResult['logs'] || []);

    if (current) {
        console.log(`  Name:     ${current.name}`);
        console.log(`  Endpoint: ${current.endpoint || '(none)'}`);
        console.log(`  Metadata: ${current.metadata}`);
        console.log(`  Tier:     ${current.tier} | Score: ${current.totalScore}/${current.totalMaxScore} | Tests: ${current.testCount}`);
    }
    console.log('');

    // Try direct updateAgent first
    console.log('Attempting direct update...');
    const updateMethod = abiMethod(
        'updateAgent',
        [
            { name: 'name', type: 'string' },
            { name: 'endpoint', type: 'string' },
            { name: 'metadata', type: 'string' },
        ],
        'void',
    );

    let updated = false;
    try {
        const sp = await algod.getTransactionParams().do();
        const txn = algosdk.makeApplicationNoOpTxnFromObject({
            sender: account.addr,
            appIndex: APP_ID,
            appArgs: [
                updateMethod.getSelector(),
                algosdk.ABIType.from('string').encode(agentName),
                algosdk.ABIType.from('string').encode(agentEndpoint),
                algosdk.ABIType.from('string').encode(agentMetadata),
            ],
            boxes: [{ appIndex: APP_ID, name: boxName }],
            suggestedParams: sp,
        });
        const signed = txn.signTxn(account.sk);
        await algod.sendRawTransaction(signed).do();
        await algosdk.waitForConfirmation(algod, txn.txID(), 4);
        updated = true;
        console.log('Direct update succeeded!\n');
    } catch (err: any) {
        console.log(`Direct update failed (box likely needs resizing): ${err.message?.slice(0, 100)}`);
        console.log('Falling back to deregister + re-register...\n');

        if (current && current.testCount > 0) {
            console.log(`  WARNING: This will reset tier (${current.tier}), score (${current.totalScore}/${current.totalMaxScore}), and test count (${current.testCount}).`);
            console.log('  The agent will start fresh at tier 1 (Registered).\n');
        }

        // Step 1: Deregister
        const deregMethod = abiMethod('deregister', [], 'void');
        const spDereg = await algod.getTransactionParams().do();
        spDereg.fee = (spDereg.fee || 1000) + 1000;
        spDereg.flatFee = true;
        const deregTxn = algosdk.makeApplicationNoOpTxnFromObject({
            sender: account.addr,
            appIndex: APP_ID,
            appArgs: [deregMethod.getSelector()],
            boxes: [{ appIndex: APP_ID, name: boxName }],
            suggestedParams: spDereg,
        });
        const signedDereg = deregTxn.signTxn(account.sk);
        await algod.sendRawTransaction(signedDereg).do();
        await algosdk.waitForConfirmation(algod, deregTxn.txID(), 4);
        console.log('  Deregistered (stake returned).');

        // Step 2: Re-register with new data
        const registerMethod = abiMethod(
            'registerAgent',
            [
                { name: 'name', type: 'string' },
                { name: 'endpoint', type: 'string' },
                { name: 'metadata', type: 'string' },
                { name: 'payment', type: 'pay' },
            ],
            'void',
        );

        // Use at least 1 ALGO for stake (minStake default is 1 ALGO)
        const stakeAmount = Math.max(current?.stake || 100_000, 1_000_000);
        const spReg = await algod.getTransactionParams().do();

        const payTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
            sender: account.addr,
            receiver: appAddr,
            amount: stakeAmount,
            suggestedParams: spReg,
        });

        const regTxn = algosdk.makeApplicationNoOpTxnFromObject({
            sender: account.addr,
            appIndex: APP_ID,
            appArgs: [
                registerMethod.getSelector(),
                algosdk.ABIType.from('string').encode(agentName),
                algosdk.ABIType.from('string').encode(agentEndpoint),
                algosdk.ABIType.from('string').encode(agentMetadata),
            ],
            boxes: [{ appIndex: APP_ID, name: boxName }],
            suggestedParams: spReg,
        });

        algosdk.assignGroupID([payTxn, regTxn]);
        const signedReg = [payTxn.signTxn(account.sk), regTxn.signTxn(account.sk)];
        await algod.sendRawTransaction(signedReg).do();
        await algosdk.waitForConfirmation(algod, regTxn.txID(), 4);
        updated = true;
        console.log(`  Re-registered with ${stakeAmount / 1_000_000} ALGO stake.\n`);
    }

    if (!updated) {
        console.error('Failed to update agent.');
        process.exit(1);
    }

    // Verify the update
    console.log('Verifying update...');
    const sp2 = await algod.getTransactionParams().do();
    const verifyTxn = algosdk.makeApplicationNoOpTxnFromObject({
        sender: account.addr,
        appIndex: APP_ID,
        appArgs: [
            getInfoMethod.getSelector(),
            algosdk.ABIType.from('address').encode(account.addr),
        ],
        boxes: [{ appIndex: APP_ID, name: boxName }],
        suggestedParams: sp2,
    });
    const signedVerify = verifyTxn.signTxn(account.sk);
    await algod.sendRawTransaction(signedVerify).do();
    const verifyResult = await algosdk.waitForConfirmation(algod, verifyTxn.txID(), 4);
    const result = readAgentFromLog(verifyResult['logs'] || []);

    if (result) {
        const tierNames: Record<number, string> = {
            1: 'Registered', 2: 'Tested', 3: 'Established', 4: 'Trusted',
        };
        console.log('  Updated on-chain state:');
        console.log(`    Name:       ${result.name}`);
        console.log(`    Endpoint:   ${result.endpoint || '(none)'}`);
        console.log(`    Metadata:   ${result.metadata}`);
        console.log(`    Tier:       ${result.tier} (${tierNames[result.tier] || 'Unknown'})`);
        console.log(`    Score:      ${result.totalScore}/${result.totalMaxScore}`);
        console.log(`    Tests:      ${result.testCount}`);
        console.log(`    Stake:      ${result.stake / 1_000_000} ALGO`);
        console.log('');
    }

    console.log('Done! Agent profile updated on-chain.\n');
}

main().catch((err) => {
    console.error('\nUpdate failed:', err.message || err);
    if (err.response?.body) {
        console.error('  Response:', JSON.stringify(err.response.body).slice(0, 300));
    }
    process.exit(1);
});
