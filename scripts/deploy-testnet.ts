/**
 * Deploy FlockDirectory contract to Algorand TestNet.
 *
 * Prerequisites:
 * 1. Set DEPLOYER_MNEMONIC env var (25-word Algorand mnemonic)
 * 2. Fund the account with testnet ALGOs: https://bank.testnet.algorand.network/
 * 3. Run: bun x tsx scripts/deploy-testnet.ts
 *
 * Alternatively, create a .env file:
 *   DEPLOYER_MNEMONIC="word1 word2 ... word25"
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import algosdk from 'algosdk';

const TESTNET_ALGOD = 'https://testnet-api.4160.nodely.dev';
const TESTNET_ALGOD_TOKEN = '';

async function main() {
    const mnemonic = process.env.DEPLOYER_MNEMONIC;
    if (!mnemonic) {
        console.error('Error: DEPLOYER_MNEMONIC environment variable not set.');
        console.error('Set it to your 25-word Algorand mnemonic.');
        console.error('Fund your account at: https://bank.testnet.algorand.network/');
        process.exit(1);
    }

    const account = algosdk.mnemonicToSecretKey(mnemonic);
    console.log(`Deployer address: ${account.addr}`);

    const algod = new algosdk.Algodv2(TESTNET_ALGOD_TOKEN, TESTNET_ALGOD, '');

    // Check balance
    const accountInfo = await algod.accountInformation(account.addr).do();
    const balance = Number(accountInfo.amount) / 1_000_000;
    console.log(`Account balance: ${balance} ALGO`);

    if (balance < 1) {
        console.error('Insufficient balance. Fund your account at: https://bank.testnet.algorand.network/');
        process.exit(1);
    }

    // Read compiled TEAL
    const artifactsDir = path.join(__dirname, '..', 'artifacts');
    const approvalTeal = fs.readFileSync(path.join(artifactsDir, 'FlockDirectory.approval.teal'), 'utf-8');
    const clearTeal = fs.readFileSync(path.join(artifactsDir, 'FlockDirectory.clear.teal'), 'utf-8');

    // Compile TEAL to bytecode
    console.log('Compiling approval program...');
    const approvalCompiled = await algod.compile(approvalTeal).do();
    const approvalBytes = new Uint8Array(Buffer.from(approvalCompiled.result, 'base64'));

    console.log('Compiling clear program...');
    const clearCompiled = await algod.compile(clearTeal).do();
    const clearBytes = new Uint8Array(Buffer.from(clearCompiled.result, 'base64'));

    // Get suggested params
    const suggestedParams = await algod.getTransactionParams().do();

    // Read ARC-56 spec to get schema
    const arc56 = JSON.parse(fs.readFileSync(path.join(artifactsDir, 'FlockDirectory.arc56.json'), 'utf-8'));
    const globalSchema = arc56.state?.schema?.global || {};
    const localSchema = arc56.state?.schema?.local || {};

    // Create application with ABI method selector for createApplication()void
    console.log('Creating application...');
    const createMethod = new algosdk.ABIMethod({
        name: 'createApplication',
        args: [],
        returns: { type: 'void' },
    });
    const methodSelector = createMethod.getSelector();

    const txn = algosdk.makeApplicationCreateTxnFromObject({
        sender: account.addr,
        approvalProgram: approvalBytes,
        clearProgram: clearBytes,
        numGlobalInts: globalSchema.ints || globalSchema['num-uint'] || 5,
        numGlobalByteSlices: globalSchema.bytes || globalSchema['num-byte-slice'] || 1,
        numLocalInts: localSchema.ints || localSchema['num-uint'] || 0,
        numLocalByteSlices: localSchema.bytes || localSchema['num-byte-slice'] || 0,
        extraPages: 1,
        appArgs: [methodSelector],
        suggestedParams,
        onComplete: algosdk.OnApplicationComplete.NoOpOC,
    });

    const signedTxn = txn.signTxn(account.sk);
    const sendResponse = await algod.sendRawTransaction(signedTxn).do();
    const txId = txn.txID();
    console.log(`Transaction ID: ${txId}`);

    // Wait for confirmation
    console.log('Waiting for confirmation...');
    const confirmedTxn = await algosdk.waitForConfirmation(algod, txId, 4);
    const appId = Number(confirmedTxn['applicationIndex']);

    console.log('');
    console.log('=== Deployment Successful ===');
    console.log(`App ID: ${appId}`);
    console.log(`App Address: ${algosdk.getApplicationAddress(appId)}`);
    console.log(`Explorer: https://testnet.explorer.perawallet.app/application/${appId}`);
    console.log('');
    console.log('Next steps:');
    console.log(`1. Fund the app address with ALGOs for stake returns`);
    console.log(`2. Set APP_ID=${appId} in your corvid-agent .env`);

    // Save deployment info
    const deploymentInfo = {
        network: 'testnet',
        appId,
        appAddress: algosdk.getApplicationAddress(appId),
        deployer: account.addr,
        txId,
        timestamp: new Date().toISOString(),
    };

    fs.writeFileSync(
        path.join(artifactsDir, 'deployment-testnet.json'),
        JSON.stringify(deploymentInfo, null, 2),
    );
    console.log(`Deployment info saved to artifacts/deployment-testnet.json`);
}

main().catch((err) => {
    console.error('Deployment failed:', err.message || err);
    if (err.response) {
        console.error('Response body:', err.response.body);
    }
    process.exit(1);
});
