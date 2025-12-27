/**
 * Helium Data Credits program interactions.
 * Handles minting DC from HNT and delegating DC to OUI escrow accounts.
 */

import {
    PublicKey,
    Transaction,
    TransactionInstruction,
    SystemProgram,
    SYSVAR_RENT_PUBKEY
} from '@solana/web3.js';
import {
    DATA_CREDITS_PROGRAM_ID,
    HELIUM_SUB_DAOS_PROGRAM_ID,
    HNT_MINT,
    DC_MINT,
    DAO_ADDRESS,
    IOT_SUB_DAO,
    HNT_PRICE_ORACLE,
    HNT_DECIMALS
} from '../lib/constants.js';
import {
    getTreasuryKeypair,
    getConnection,
    sendAndConfirmTransaction,
    getTokenBalance,
    getAssociatedTokenAddress
} from './solana.js';

// Token Program IDs
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const CIRCUIT_BREAKER_PROGRAM_ID = new PublicKey('circAbx64bbsscPbQzZAUvuXpHqrCe6fLMzc2uKXz9g');

/**
 * SHA-256 hash of a string (for router_key hashing).
 * Matches the hash_name function in Helium programs.
 */
async function hashName(name) {
    const encoder = new TextEncoder();
    const data = encoder.encode(name);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return new Uint8Array(hashBuffer);
}

/**
 * Derive the DataCreditsV0 PDA.
 */
function getDataCreditsPda(dcMint) {
    const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from('dc'), dcMint.toBuffer()],
        new PublicKey(DATA_CREDITS_PROGRAM_ID)
    );
    return pda;
}

/**
 * Derive the circuit breaker PDA.
 */
function getCircuitBreakerPda(dcMint) {
    const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from('mint_windowed_breaker'), dcMint.toBuffer()],
        CIRCUIT_BREAKER_PROGRAM_ID
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
            Buffer.from('delegated_data_credits'),
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
        [Buffer.from('escrow_dc_account'), delegatedDataCredits.toBuffer()],
        new PublicKey(DATA_CREDITS_PROGRAM_ID)
    );
    return pda;
}

/**
 * Mint Data Credits by burning HNT.
 * Uses the Helium price oracle to determine conversion rate.
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

    // Build mint_data_credits_v0 instruction
    // Instruction discriminator for mint_data_credits_v0
    const discriminator = Buffer.from([0xd9, 0x24, 0xa5, 0x7d, 0x88, 0x5e, 0xf5, 0x45]);

    // MintDataCreditsArgsV0 { hnt_amount: Option<u64>, dc_amount: Option<u64> }
    // We specify hnt_amount, not dc_amount
    const argsBuffer = Buffer.alloc(18);
    argsBuffer.writeUInt8(1, 0); // Some(hnt_amount)
    argsBuffer.writeBigUInt64LE(BigInt(hntAmount), 1);
    argsBuffer.writeUInt8(0, 9); // None for dc_amount

    const instructionData = Buffer.concat([discriminator, argsBuffer]);

    const instruction = new TransactionInstruction({
        programId: new PublicKey(DATA_CREDITS_PROGRAM_ID),
        keys: [
            { pubkey: dataCredits, isSigner: false, isWritable: false },
            { pubkey: new PublicKey(HNT_PRICE_ORACLE), isSigner: false, isWritable: false },
            { pubkey: hntAta, isSigner: false, isWritable: true }, // burner
            { pubkey: dcAta, isSigner: false, isWritable: true }, // recipient_token_account
            { pubkey: keypair.publicKey, isSigner: false, isWritable: false }, // recipient
            { pubkey: keypair.publicKey, isSigner: true, isWritable: true }, // owner
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
 * @param {string} routerKey - The OUI's payer/router key (used to derive escrow PDA)
 * @returns {Promise<{ signature: string, escrowBalance: bigint }>} Delegation result
 */
export async function delegateDataCredits(env, dcAmount, routerKey) {
    const keypair = getTreasuryKeypair(env);
    const connection = getConnection(env);

    const dcMint = new PublicKey(DC_MINT);
    const dao = new PublicKey(DAO_ADDRESS);
    const subDao = new PublicKey(IOT_SUB_DAO);
    const dataCredits = getDataCreditsPda(dcMint);

    // Get delegated data credits PDA and escrow account
    const delegatedDataCredits = await getDelegatedDataCreditsPda(subDao, routerKey);
    const escrowAccount = getEscrowAccountPda(delegatedDataCredits);

    // Get treasury DC token account
    const dcAta = await getAssociatedTokenAddress(keypair.publicKey, dcMint);

    console.log(`Delegating ${dcAmount} DC to router: ${routerKey}`);

    // Build delegate_data_credits_v0 instruction
    // Instruction discriminator for delegate_data_credits_v0
    const discriminator = Buffer.from([0x4a, 0xb1, 0x7b, 0x2e, 0x9b, 0xc8, 0x1e, 0x42]);

    // DelegateDataCreditsArgsV0 { amount: u64, router_key: String }
    const routerKeyBytes = new TextEncoder().encode(routerKey);
    const argsBuffer = Buffer.alloc(8 + 4 + routerKeyBytes.length);
    argsBuffer.writeBigUInt64LE(BigInt(dcAmount), 0);
    argsBuffer.writeUInt32LE(routerKeyBytes.length, 8);
    routerKeyBytes.forEach((b, i) => argsBuffer.writeUInt8(b, 12 + i));

    const instructionData = Buffer.concat([discriminator, argsBuffer]);

    const instruction = new TransactionInstruction({
        programId: new PublicKey(DATA_CREDITS_PROGRAM_ID),
        keys: [
            { pubkey: delegatedDataCredits, isSigner: false, isWritable: true },
            { pubkey: dataCredits, isSigner: false, isWritable: false },
            { pubkey: dcMint, isSigner: false, isWritable: false },
            { pubkey: dao, isSigner: false, isWritable: false },
            { pubkey: subDao, isSigner: false, isWritable: false },
            { pubkey: keypair.publicKey, isSigner: true, isWritable: false }, // owner
            { pubkey: dcAta, isSigner: false, isWritable: true }, // from_account
            { pubkey: escrowAccount, isSigner: false, isWritable: true },
            { pubkey: keypair.publicKey, isSigner: true, isWritable: true }, // payer
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
 * 
 * @param {object} env - Environment bindings
 * @param {string} routerKey - The OUI's payer/router key
 * @returns {Promise<bigint>} Escrow DC balance
 */
export async function getOuiEscrowBalance(env, routerKey) {
    const connection = getConnection(env);
    const subDao = new PublicKey(IOT_SUB_DAO);

    const delegatedDataCredits = await getDelegatedDataCreditsPda(subDao, routerKey);
    const escrowAccount = getEscrowAccountPda(delegatedDataCredits);

    return getTokenBalance(connection, escrowAccount);
}
