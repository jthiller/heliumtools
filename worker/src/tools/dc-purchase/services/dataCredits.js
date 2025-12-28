/**
 * Helium Data Credits program interactions.
 * Handles minting DC from HNT and delegating DC to OUI escrow accounts.
 * 
 * Uses the Pyth Push Oracle HNT price feed which is continuously updated.
 */

import {
    PublicKey,
    Transaction,
    TransactionInstruction,
    SystemProgram,
} from '@solana/web3.js';
import {
    DATA_CREDITS_PROGRAM_ID,
    HELIUM_SUB_DAOS_PROGRAM_ID,
    HNT_MINT,
    DC_MINT,
    IOT_MINT,
    HNT_DECIMALS
} from '../lib/constants.js';
import {
    getTreasuryKeypair,
    getConnection,
    sendAndConfirmTransaction,
    getTokenBalance,
    getAssociatedTokenAddress,
} from './solana.js';

// Token Program IDs
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const CIRCUIT_BREAKER_PROGRAM_ID = new PublicKey('circAbx64bbsscPbQzZAUvuXpHqrCe6fLMzc2uKXz9g');

// Pyth Push Oracle HNT/USD price feed account (continuously updated by Pyth)
// From: https://github.com/helium/helium-program-library/blob/master/packages/spl-utils/src/constants.ts
const HNT_PYTH_PRICE_FEED = new PublicKey('4DdmDswskDxXGpwHrXUfn2CNUm9rt21ac79GHNTN3J33');

/**
 * Convert a string to Uint8Array.
 */
function stringToBytes(str) {
    return new TextEncoder().encode(str);
}

/**
 * SHA-256 hash of a string.
 */
async function hashName(name) {
    const data = stringToBytes(name);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return new Uint8Array(hashBuffer);
}

/**
 * Write a 64-bit unsigned integer in little-endian.
 */
function writeUint64LE(arr, value, offset) {
    const bigVal = BigInt(value);
    for (let i = 0; i < 8; i++) {
        arr[offset + i] = Number((bigVal >> BigInt(i * 8)) & 0xFFn);
    }
}

/**
 * Write a 32-bit unsigned integer in little-endian.
 */
function writeUint32LE(arr, value, offset) {
    arr[offset] = value & 0xFF;
    arr[offset + 1] = (value >> 8) & 0xFF;
    arr[offset + 2] = (value >> 16) & 0xFF;
    arr[offset + 3] = (value >> 24) & 0xFF;
}

/**
 * Derive the DataCreditsV0 PDA.
 */
function getDataCreditsPda(dcMint) {
    const [pda] = PublicKey.findProgramAddressSync(
        [stringToBytes('dc'), dcMint.toBuffer()],
        new PublicKey(DATA_CREDITS_PROGRAM_ID)
    );
    return pda;
}

/**
 * Derive the circuit breaker PDA.
 */
function getCircuitBreakerPda(dcMint) {
    const [pda] = PublicKey.findProgramAddressSync(
        [stringToBytes('mint_windowed_breaker'), dcMint.toBuffer()],
        CIRCUIT_BREAKER_PROGRAM_ID
    );
    return pda;
}

/**
 * Derive the DAO PDA from HNT mint.
 * DAO = ["dao", HNT_MINT] via HELIUM_SUB_DAOS_PROGRAM
 */
function getDaoPda(hntMint) {
    const [pda] = PublicKey.findProgramAddressSync(
        [stringToBytes('dao'), hntMint.toBuffer()],
        new PublicKey(HELIUM_SUB_DAOS_PROGRAM_ID)
    );
    return pda;
}

/**
 * Derive the SubDAO PDA from IOT mint.
 * SubDAO = ["sub_dao", IOT_MINT] via HELIUM_SUB_DAOS_PROGRAM
 */
function getSubDaoPda(iotMint) {
    const [pda] = PublicKey.findProgramAddressSync(
        [stringToBytes('sub_dao'), iotMint.toBuffer()],
        new PublicKey(HELIUM_SUB_DAOS_PROGRAM_ID)
    );
    return pda;
}

/**
 * Derive the DelegatedDataCreditsV0 PDA.
 */
async function getDelegatedDataCreditsPda(subDao, routerKey) {
    const nameHash = await hashName(routerKey);
    const [pda] = PublicKey.findProgramAddressSync(
        [
            stringToBytes('delegated_data_credits'),
            subDao.toBuffer(),
            nameHash
        ],
        new PublicKey(DATA_CREDITS_PROGRAM_ID)
    );
    return pda;
}

/**
 * Derive the escrow DC account PDA.
 */
function getEscrowAccountPda(delegatedDataCredits) {
    const [pda] = PublicKey.findProgramAddressSync(
        [stringToBytes('escrow_dc_account'), delegatedDataCredits.toBuffer()],
        new PublicKey(DATA_CREDITS_PROGRAM_ID)
    );
    return pda;
}

/**
 * Mint Data Credits by burning HNT.
 * 
 * Uses the Pyth Push Oracle HNT/USD price feed which is continuously
 * updated by Pyth, so no need to post price updates ourselves.
 * 
 * @param {object} env - Environment bindings
 * @param {bigint} hntAmount - Amount of HNT to burn (in smallest units)
 * @returns {Promise<{ signature: string, dcMinted: bigint }>} Mint result
 */
export async function mintDataCredits(env, hntAmount) {
    const keypair = getTreasuryKeypair(env);
    const connection = getConnection(env);

    const hntMint = new PublicKey(HNT_MINT);
    const dcMint = new PublicKey(DC_MINT);
    const dataCredits = getDataCreditsPda(dcMint);
    const circuitBreaker = getCircuitBreakerPda(dcMint);

    // Get treasury token accounts
    const hntAta = await getAssociatedTokenAddress(keypair.publicKey, hntMint);
    const dcAta = await getAssociatedTokenAddress(keypair.publicKey, dcMint);

    // Get initial DC balance
    const initialDcBalance = await getTokenBalance(connection, dcAta);

    console.log(`Minting DC from ${Number(hntAmount) / Math.pow(10, HNT_DECIMALS)} HNT`);
    console.log(`Using Pyth Push Oracle price feed: ${HNT_PYTH_PRICE_FEED.toBase58()}`);

    // Build mint_data_credits_v0 instruction
    // Discriminator: SHA256("global:mint_data_credits_v0")[0..8]
    const discriminator = new Uint8Array([0x4e, 0x6d, 0xa9, 0x84, 0x90, 0x5e, 0xdd, 0x39]);

    const argsBuffer = new Uint8Array(18);
    argsBuffer[0] = 1; // Some(hnt_amount)
    writeUint64LE(argsBuffer, hntAmount, 1);
    argsBuffer[9] = 0; // None for dc_amount

    const instructionData = new Uint8Array(discriminator.length + argsBuffer.length);
    instructionData.set(discriminator, 0);
    instructionData.set(argsBuffer, discriminator.length);

    const instruction = new TransactionInstruction({
        programId: new PublicKey(DATA_CREDITS_PROGRAM_ID),
        keys: [
            { pubkey: dataCredits, isSigner: false, isWritable: false },
            { pubkey: HNT_PYTH_PRICE_FEED, isSigner: false, isWritable: false }, // Pyth push oracle price feed
            { pubkey: hntAta, isSigner: false, isWritable: true },
            { pubkey: dcAta, isSigner: false, isWritable: true },
            { pubkey: keypair.publicKey, isSigner: false, isWritable: false },
            { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
            { pubkey: hntMint, isSigner: false, isWritable: true },
            { pubkey: dcMint, isSigner: false, isWritable: true },
            { pubkey: circuitBreaker, isSigner: false, isWritable: true },
            { pubkey: CIRCUIT_BREAKER_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: instructionData,
    });

    const transaction = new Transaction().add(instruction);

    const signature = await sendAndConfirmTransaction(connection, transaction, [keypair]);
    console.log(`Mint transaction: ${signature}`);

    // Verify DC minted on-chain
    const finalDcBalance = await getTokenBalance(connection, dcAta);
    const dcMinted = finalDcBalance - initialDcBalance;

    if (dcMinted <= 0n) {
        throw new Error('No DC minted after transaction');
    }

    console.log(`Minted ${dcMinted} DC`);

    return {
        signature,
        dcMinted,
    };
}

/**
 * Delegate Data Credits to an OUI escrow account.
 * 
 * @param {object} env - Environment bindings
 * @param {bigint} dcAmount - Amount of DC to delegate
 * @param {string} routerKey - The OUI's payer/router key
 * @returns {Promise<{ signature: string, escrowBalance: bigint }>} Delegation result
 */
export async function delegateDataCredits(env, dcAmount, routerKey) {
    const keypair = getTreasuryKeypair(env);
    const connection = getConnection(env);

    const hntMint = new PublicKey(HNT_MINT);
    const dcMint = new PublicKey(DC_MINT);
    const iotMint = new PublicKey(IOT_MINT);

    // Derive DAO and SubDAO PDAs
    const dao = getDaoPda(hntMint);
    const subDao = getSubDaoPda(iotMint);
    const dataCredits = getDataCreditsPda(dcMint);

    // Get delegated data credits PDA and escrow account
    const delegatedDataCredits = await getDelegatedDataCreditsPda(subDao, routerKey);
    const escrowAccount = getEscrowAccountPda(delegatedDataCredits);

    // Get treasury DC token account
    const dcAta = await getAssociatedTokenAddress(keypair.publicKey, dcMint);

    console.log(`Delegating ${dcAmount} DC to router: ${routerKey}`);

    // Discriminator: SHA256("global:delegate_data_credits_v0")[0..8]
    const discriminator = new Uint8Array([0x9a, 0x38, 0xe2, 0x80, 0xa2, 0x73, 0xe2, 0x05]);

    const routerKeyBytes = stringToBytes(routerKey);
    const argsBuffer = new Uint8Array(8 + 4 + routerKeyBytes.length);
    writeUint64LE(argsBuffer, dcAmount, 0);
    writeUint32LE(argsBuffer, routerKeyBytes.length, 8);
    argsBuffer.set(routerKeyBytes, 12);

    const instructionData = new Uint8Array(discriminator.length + argsBuffer.length);
    instructionData.set(discriminator, 0);
    instructionData.set(argsBuffer, discriminator.length);

    const instruction = new TransactionInstruction({
        programId: new PublicKey(DATA_CREDITS_PROGRAM_ID),
        keys: [
            { pubkey: delegatedDataCredits, isSigner: false, isWritable: true },
            { pubkey: dataCredits, isSigner: false, isWritable: false },
            { pubkey: dcMint, isSigner: false, isWritable: false },
            { pubkey: dao, isSigner: false, isWritable: false },
            { pubkey: subDao, isSigner: false, isWritable: false },
            { pubkey: keypair.publicKey, isSigner: true, isWritable: false },
            { pubkey: dcAta, isSigner: false, isWritable: true },
            { pubkey: escrowAccount, isSigner: false, isWritable: true },
            { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
            { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: instructionData,
    });

    const transaction = new Transaction().add(instruction);

    const signature = await sendAndConfirmTransaction(connection, transaction, [keypair]);
    console.log(`Delegation transaction: ${signature}`);

    // Verify DC in escrow on-chain
    const escrowBalance = await getTokenBalance(connection, escrowAccount);
    console.log(`Escrow balance: ${escrowBalance} DC`);

    return {
        signature,
        escrowBalance,
    };
}

/**
 * Get the current DC balance in an OUI's escrow account.
 */
export async function getOuiEscrowBalance(env, routerKey) {
    const connection = getConnection(env);
    const iotMint = new PublicKey(IOT_MINT);
    const subDao = getSubDaoPda(iotMint);

    const delegatedDataCredits = await getDelegatedDataCreditsPda(subDao, routerKey);
    const escrowAccount = getEscrowAccountPda(delegatedDataCredits);

    return getTokenBalance(connection, escrowAccount);
}
