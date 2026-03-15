/**
 * Register corvid-agent in the FlockDirectory smart contract on Algorand TestNet.
 *
 * This script registers the agent on-chain (or re-registers if previously deregistered).
 * Unlike test-testnet.ts, it does NOT deregister at the end — the agent stays registered.
 *
 * Usage:
 *   DEPLOYER_MNEMONIC="..." bun x tsx scripts/register-agent.ts
 *
 * Options (env vars):
 *   AGENT_NAME      - Agent display name (default: "CorvidAgent")
 *   AGENT_ENDPOINT  - Agent API endpoint (default: "https://corvid.corvidlabs.com/api")
 *   AGENT_METADATA  - JSON metadata string (default: auto-generated)
 *   SKIP_HEARTBEAT  - Set to "1" to skip sending a heartbeat after registration
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
    const agentEndpoint = process.env.AGENT_ENDPOINT || 'https://corvid.corvidlabs.com/api';
    const agentMetadata = process.env.AGENT_METADATA || JSON.stringify({
        type: 'general',
        version: '0.1.0',
        capabilities: ['chat', 'code', 'research'],
        framework: 'corvid-agent',
    });

    console.log(`\nFlockDirectory Agent Registration (App ${APP_ID})`);
    console.log(`  Account:  ${account.addr}`);
    console.log(`  Name:     ${agentName}`);
    console.log(`  Endpoint: ${agentEndpoint}`);
    console.log('');

    // Check if already registered by trying to read the box
    const boxName = agentBoxName(account.addr.toString());
    let alreadyRegistered = false;
    try {
        await algod.getApplicationBoxByName(APP_ID, boxName).do();
        alreadyRegistered = true;
    } catch {
        // Box doesn't exist — not registered
    }

    if (alreadyRegistered) {
        console.log('Agent is already registered on-chain.');
        console.log('Sending heartbeat to update liveness...\n');

        const sp = await algod.getTransactionParams().do();
        const heartbeatMethod = abiMethod('heartbeat', [], 'void');
        const appArgs = [heartbeatMethod.getSelector()];
        const txn = algosdk.makeApplicationNoOpTxnFromObject({
            sender: account.addr,
            appIndex: APP_ID,
            appArgs,
            boxes: [{ appIndex: APP_ID, name: boxName }],
            suggestedParams: sp,
        });
        const signed = txn.signTxn(account.sk);
        await algod.sendRawTransaction(signed).do();
        await algosdk.waitForConfirmation(algod, txn.txID(), 4);
        console.log('Heartbeat sent.\n');
    } else {
        // Register the agent
        console.log('Registering agent on-chain...');
        const sp = await algod.getTransactionParams().do();

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

        const nameCodec = algosdk.ABIType.from('string');
        const endpointCodec = algosdk.ABIType.from('string');
        const metadataCodec = algosdk.ABIType.from('string');

        const appArgs = [
            registerMethod.getSelector(),
            nameCodec.encode(agentName),
            endpointCodec.encode(agentEndpoint),
            metadataCodec.encode(agentMetadata),
        ];

        // Payment txn for stake (0.1 ALGO)
        const payTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
            sender: account.addr,
            receiver: appAddr,
            amount: 100_000,
            suggestedParams: sp,
        });

        const appTxn = algosdk.makeApplicationNoOpTxnFromObject({
            sender: account.addr,
            appIndex: APP_ID,
            appArgs,
            boxes: [{ appIndex: APP_ID, name: boxName }],
            suggestedParams: sp,
        });

        algosdk.assignGroupID([payTxn, appTxn]);
        const signed = [payTxn.signTxn(account.sk), appTxn.signTxn(account.sk)];
        await algod.sendRawTransaction(signed).do();
        await algosdk.waitForConfirmation(algod, appTxn.txID(), 4);
        console.log('Agent registered on-chain!\n');
    }

    // Read back agent info to confirm
    console.log('Verifying registration...');
    const sp2 = await algod.getTransactionParams().do();
    const getInfoMethod = abiMethod(
        'getAgentInfo',
        [{ name: 'agentAddress', type: 'address' }],
        '(string,string,string,uint64,uint64,uint64,uint64,uint64,uint64,uint64)',
    );
    const infoArgs = [
        getInfoMethod.getSelector(),
        algosdk.ABIType.from('address').encode(account.addr),
    ];
    const infoTxn = algosdk.makeApplicationNoOpTxnFromObject({
        sender: account.addr,
        appIndex: APP_ID,
        appArgs: infoArgs,
        boxes: [{ appIndex: APP_ID, name: boxName }],
        suggestedParams: sp2,
    });
    const signedInfo = infoTxn.signTxn(account.sk);
    await algod.sendRawTransaction(signedInfo).do();
    const infoResult = await algosdk.waitForConfirmation(algod, infoTxn.txID(), 4);

    const logs = infoResult['logs'] || [];
    if (logs.length > 0) {
        const lastLog = logs[logs.length - 1];
        const logBytes = typeof lastLog === 'string' ? Buffer.from(lastLog, 'base64') : lastLog;
        if (logBytes[0] === 0x15 && logBytes[1] === 0x1f && logBytes[2] === 0x7c && logBytes[3] === 0x75) {
            const returnData = logBytes.slice(4);
            const tupleType = algosdk.ABIType.from(
                '(string,string,string,uint64,uint64,uint64,uint64,uint64,uint64,uint64)',
            );
            const decoded = tupleType.decode(returnData) as any[];
            const tierNames: Record<number, string> = {
                1: 'Registered',
                2: 'Tested',
                3: 'Established',
                4: 'Trusted',
            };
            console.log('');
            console.log('  On-chain agent state:');
            console.log(`    Name:       ${decoded[0]}`);
            console.log(`    Endpoint:   ${decoded[1]}`);
            console.log(`    Metadata:   ${decoded[2]}`);
            console.log(`    Tier:       ${decoded[3]} (${tierNames[Number(decoded[3])] || 'Unknown'})`);
            console.log(`    Score:      ${decoded[4]}/${decoded[5]}`);
            console.log(`    Tests:      ${decoded[6]}`);
            console.log(`    Stake:      ${Number(decoded[9]) / 1_000_000} ALGO`);
            console.log('');
        }
    }

    console.log('Done! Agent is registered and visible on-chain.\n');
}

main().catch((err) => {
    console.error('\nRegistration failed:', err.message || err);
    if (err.response?.body) {
        console.error('  Response:', JSON.stringify(err.response.body).slice(0, 300));
    }
    process.exit(1);
});
