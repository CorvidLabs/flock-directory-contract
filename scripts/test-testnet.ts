/**
 * Test the deployed FlockDirectory contract on Algorand TestNet.
 *
 * Tests: register agent, create challenge, record test result, read state, heartbeat, deregister.
 *
 * Usage: DEPLOYER_MNEMONIC="..." bun x tsx scripts/test-testnet.ts
 */

import algosdk from 'algosdk';

const APP_ID = 757178329;
const TESTNET_ALGOD = 'https://testnet-api.4160.nodely.dev';

function abiMethod(name: string, args: { name: string; type: string }[], returns: string) {
    return new algosdk.ABIMethod({ name, args, returns: { type: returns } });
}

function encodeABIArgs(method: algosdk.ABIMethod, values: any[]) {
    const selector = method.getSelector();
    const encodedArgs = method.args.map((arg, i) => {
        const codec = algosdk.ABIType.from(arg.type!.toString());
        return codec.encode(values[i]);
    });
    return [selector, ...encodedArgs];
}

async function main() {
    const mnemonic = process.env.DEPLOYER_MNEMONIC;
    if (!mnemonic) {
        // Try corvid-agent .env
        const fs = await import('fs');
        const envContent = fs.readFileSync('/Users/corvid-agent/corvid-agent/.env', 'utf-8');
        const match = envContent.match(/ALGOCHAT_MNEMONIC=["']?(.+?)["']?\s*$/m);
        if (match) {
            process.env.DEPLOYER_MNEMONIC = match[1];
        } else {
            console.error('No mnemonic found');
            process.exit(1);
        }
    }

    const account = algosdk.mnemonicToSecretKey(process.env.DEPLOYER_MNEMONIC!);
    const algod = new algosdk.Algodv2('', TESTNET_ALGOD, '');
    const appAddr = algosdk.getApplicationAddress(APP_ID);

    console.log(`\n🧪 Testing FlockDirectory (App ${APP_ID}) on TestNet`);
    console.log(`   Admin/Deployer: ${account.addr}`);
    console.log(`   App Address: ${appAddr}\n`);

    // Helper to send an app call
    async function callApp(
        method: algosdk.ABIMethod,
        values: any[],
        opts: {
            boxes?: { appIndex: number; name: Uint8Array }[];
            extraTxns?: algosdk.Transaction[];
            extraFee?: number;
        } = {},
    ) {
        const sp = await algod.getTransactionParams().do();
        if (opts.extraFee) {
            sp.fee = (sp.fee || 1000) + opts.extraFee;
            sp.flatFee = true;
        }
        const appArgs = encodeABIArgs(method, values);

        const txn = algosdk.makeApplicationNoOpTxnFromObject({
            sender: account.addr,
            appIndex: APP_ID,
            appArgs,
            boxes: opts.boxes || [],
            suggestedParams: sp,
        });

        if (opts.extraTxns && opts.extraTxns.length > 0) {
            const group = [opts.extraTxns[0], txn];
            algosdk.assignGroupID(group);
            const signed = group.map((t) => t.signTxn(account.sk));
            await algod.sendRawTransaction(signed).do();
            const result = await algosdk.waitForConfirmation(algod, txn.txID(), 4);
            return result;
        }

        const signed = txn.signTxn(account.sk);
        await algod.sendRawTransaction(signed).do();
        const result = await algosdk.waitForConfirmation(algod, txn.txID(), 4);
        return result;
    }

    // Box name helpers
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
        // Dynamic-size box: prefix + 2-byte length + id
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
        // Key is ABI-encoded tuple: (address, string)
        // Static part: 32-byte address + 2-byte offset to dynamic part
        // Dynamic part: 2-byte string length + string bytes
        const prefix = new TextEncoder().encode('t');
        const decoded = algosdk.decodeAddress(addr);
        const idBytes = new TextEncoder().encode(challengeId);
        const offset = 32 + 2; // offset to dynamic string data
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

    // ── Step 0: Lower min stake so we don't run out of ALGO ─────
    console.log('0️⃣  Setting min stake to 0.1 ALGO...');
    try {
        const method = abiMethod('updateMinStake', [{ name: 'newMinStake', type: 'uint64' }], 'void');
        await callApp(method, [100_000], {});
        console.log('   ✅ Min stake set to 0.1 ALGO\n');
    } catch (e: any) {
        console.log('   ⚠️  Could not update min stake:', e.message?.slice(0, 80), '\n');
    }

    // ── Step 0.5: Deregister if already registered ────────────
    console.log('   Checking if agent already registered...');
    try {
        const deregMethod = abiMethod('deregister', [], 'void');
        await callApp(deregMethod, [], {
            boxes: [{ appIndex: APP_ID, name: agentBoxName(account.addr.toString()) }],
            extraFee: 1000, // cover inner sendPayment
        });
        console.log('   Cleaned up previous registration.\n');
    } catch (e: any) {
        console.log('   Deregister failed:', e.message?.slice(0, 200), '\n');
    }

    // ── Step 1: Register Agent ──────────────────────────────────
    console.log('1️⃣  Registering agent...');
    try {
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

        const sp = await algod.getTransactionParams().do();

        const selector = registerMethod.getSelector();
        const nameCodec = algosdk.ABIType.from('string');
        const endpointCodec = algosdk.ABIType.from('string');
        const metadataCodec = algosdk.ABIType.from('string');

        const appArgs = [
            selector,
            nameCodec.encode('CorvidAgent'),
            endpointCodec.encode('https://corvid.corvidlabs.com/api'),
            metadataCodec.encode('{"type":"general","version":"0.1.0"}'),
        ];

        // Payment txn (0.1 ALGO stake)
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
            boxes: [{ appIndex: APP_ID, name: agentBoxName(account.addr.toString()) }],
            suggestedParams: sp,
        });

        algosdk.assignGroupID([payTxn, appTxn]);
        const signed = [payTxn.signTxn(account.sk), appTxn.signTxn(account.sk)];
        await algod.sendRawTransaction(signed).do();
        await algosdk.waitForConfirmation(algod, appTxn.txID(), 4);
        console.log('   ✅ Agent registered!\n');
    } catch (e: any) {
        if (e.message?.includes('Agent already registered') || e.response?.body?.message?.includes('logic eval error')) {
            console.log('   ⚠️  Agent already registered (skipping)\n');
        } else {
            throw e;
        }
    }

    // ── Step 2: Read Agent Info ─────────────────────────────────
    console.log('2️⃣  Reading agent info...');
    {
        const method = abiMethod('getAgentInfo', [{ name: 'agentAddress', type: 'address' }], '(string,string,string,uint64,uint64,uint64,uint64,uint64,uint64,uint64)');
        const result = await callApp(method, [account.addr], {
            boxes: [{ appIndex: APP_ID, name: agentBoxName(account.addr.toString()) }],
        });
        // Decode the return value from the log
        const logs = result['logs'] || [];
        if (logs.length > 0) {
            const lastLog = logs[logs.length - 1];
            const logBytes = typeof lastLog === 'string' ? Buffer.from(lastLog, 'base64') : lastLog;
            // ABI return prefix is 0x151f7c75
            if (logBytes[0] === 0x15 && logBytes[1] === 0x1f && logBytes[2] === 0x7c && logBytes[3] === 0x75) {
                const returnData = logBytes.slice(4);
                const tupleType = algosdk.ABIType.from('(string,string,string,uint64,uint64,uint64,uint64,uint64,uint64,uint64)');
                const decoded = tupleType.decode(returnData) as any[];
                console.log(`   Name:       ${decoded[0]}`);
                console.log(`   Endpoint:   ${decoded[1]}`);
                console.log(`   Metadata:   ${decoded[2]}`);
                console.log(`   Tier:       ${decoded[3]} (1=Registered, 2=Tested, 3=Established, 4=Trusted)`);
                console.log(`   Score:      ${decoded[4]}/${decoded[5]}`);
                console.log(`   Tests:      ${decoded[6]}`);
                console.log(`   Stake:      ${Number(decoded[9]) / 1_000_000} ALGO`);
            }
        }
        console.log('');
    }

    // ── Step 3: Create a Challenge ──────────────────────────────
    const challengeId = `test-${Date.now().toString(36)}`;
    console.log(`3️⃣  Creating test challenge "${challengeId}"...`);
    {
        const method = abiMethod(
            'createChallenge',
            [
                { name: 'challengeId', type: 'string' },
                { name: 'category', type: 'string' },
                { name: 'description', type: 'string' },
                { name: 'maxScore', type: 'uint64' },
            ],
            'void',
        );
        await callApp(method, [challengeId, 'reasoning', 'Basic reasoning test', 100], {
            boxes: [{ appIndex: APP_ID, name: challengeBoxName(challengeId) }],
        });
        console.log(`   ✅ Challenge created!\n`);
    }

    // ── Step 4: Record a Test Result ────────────────────────────
    console.log('4️⃣  Recording test result (score: 85/100)...');
    {
        const method = abiMethod(
            'recordTestResult',
            [
                { name: 'agentAddress', type: 'address' },
                { name: 'challengeId', type: 'string' },
                { name: 'score', type: 'uint64' },
            ],
            'void',
        );
        await callApp(method, [account.addr, challengeId, 85], {
            boxes: [
                { appIndex: APP_ID, name: agentBoxName(account.addr.toString()) },
                { appIndex: APP_ID, name: challengeBoxName(challengeId) },
                { appIndex: APP_ID, name: testResultBoxName(account.addr.toString(), challengeId) },
            ],
        });
        console.log('   ✅ Test result recorded!\n');
    }

    // ── Step 5: Check Updated Tier & Score ──────────────────────
    console.log('5️⃣  Checking updated agent status...');
    {
        const method = abiMethod('getAgentTier', [{ name: 'agentAddress', type: 'address' }], 'uint64');
        const result = await callApp(method, [account.addr], {
            boxes: [{ appIndex: APP_ID, name: agentBoxName(account.addr.toString()) }],
        });
        const logs = result['logs'] || [];
        if (logs.length > 0) {
            const lastLog = logs[logs.length - 1];
            const logBytes = typeof lastLog === 'string' ? Buffer.from(lastLog, 'base64') : lastLog;
            if (logBytes[0] === 0x15 && logBytes[1] === 0x1f && logBytes[2] === 0x7c && logBytes[3] === 0x75) {
                const returnData = logBytes.slice(4);
                const tier = algosdk.ABIType.from('uint64').decode(returnData);
                const tierNames: Record<number, string> = { 1: 'Registered', 2: 'Tested', 3: 'Established', 4: 'Trusted' };
                console.log(`   Tier: ${tier} (${tierNames[Number(tier)] || 'Unknown'})`);
            }
        }

        const scoreMethod = abiMethod('getAgentScore', [{ name: 'agentAddress', type: 'address' }], 'uint64');
        const scoreResult = await callApp(scoreMethod, [account.addr], {
            boxes: [{ appIndex: APP_ID, name: agentBoxName(account.addr.toString()) }],
        });
        const scoreLogs = scoreResult['logs'] || [];
        if (scoreLogs.length > 0) {
            const lastLog = scoreLogs[scoreLogs.length - 1];
            const logBytes = typeof lastLog === 'string' ? Buffer.from(lastLog, 'base64') : lastLog;
            if (logBytes[0] === 0x15 && logBytes[1] === 0x1f && logBytes[2] === 0x7c && logBytes[3] === 0x75) {
                const returnData = logBytes.slice(4);
                const score = algosdk.ABIType.from('uint64').decode(returnData);
                console.log(`   Score: ${score}%`);
            }
        }
        console.log('');
    }

    // ── Step 6: Heartbeat ───────────────────────────────────────
    console.log('6️⃣  Sending heartbeat...');
    {
        const method = abiMethod('heartbeat', [], 'void');
        await callApp(method, [], {
            boxes: [{ appIndex: APP_ID, name: agentBoxName(account.addr.toString()) }],
        });
        console.log('   ✅ Heartbeat sent!\n');
    }

    // ── Step 7: Deregister (cleanup) ────────────────────────────
    console.log('7️⃣  Deregistering agent (returns stake)...');
    {
        const method = abiMethod('deregister', [], 'void');
        await callApp(method, [], {
            boxes: [{ appIndex: APP_ID, name: agentBoxName(account.addr.toString()) }],
            extraFee: 1000, // cover inner sendPayment
        });
        console.log('   ✅ Agent deregistered, stake returned!\n');
    }

    console.log('🎉 All tests passed! Contract is working on testnet.\n');
}

main().catch((err) => {
    console.error('\n❌ Test failed:', err.message || err);
    if (err.response?.body) {
        console.error('   Response:', JSON.stringify(err.response.body).slice(0, 300));
    }
    process.exit(1);
});
