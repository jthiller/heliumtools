/**
 * Native Pyth oracle integration for Cloudflare Workers.
 * Uses HTTP calls to Pyth Hermes API for price data.
 * 
 * Note: The Helium Data Credits program requires posting fresh Pyth price updates
 * to an ephemeral account before minting DC. This is the Pyth "pull" model.
 */

import {
    PublicKey,
    TransactionInstruction,
    Keypair,
    SystemProgram,
} from '@solana/web3.js';

// Pyth Hermes API endpoint
export const PYTH_HERMES_URL = 'https://hermes.pyth.network';

// HNT/USD Price Feed ID (without 0x prefix)
export const HNT_PRICE_FEED_ID = '649fdd7ec08e8e2a20f425729854e90293dcbe2376abc47197a14da6ff339756';

// Pyth Solana Receiver Program ID
export const PYTH_SOLANA_RECEIVER_PROGRAM_ID = new PublicKey('rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ');

// Treasury PDA seed
const TREASURY_SEED = 'treasury';

/**
 * Fetch latest HNT/USD price VAA from Pyth Hermes.
 * 
 * @returns {Promise<{ vaaHex: string, priceData: object }>}
 */
export async function fetchHntPriceVaa() {
    const url = `${PYTH_HERMES_URL}/v2/updates/price/latest?ids[]=${HNT_PRICE_FEED_ID}&encoding=hex`;

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch Pyth price: ${response.status}`);
    }

    const data = await response.json();

    if (!data.binary?.data?.[0]) {
        throw new Error('No price VAA returned from Pyth Hermes');
    }

    return {
        vaaHex: data.binary.data[0],
        priceData: data.parsed?.[0]?.price,
    };
}

/**
 * Get the current HNT price in USD.
 * 
 * @returns {Promise<{ price: number, confidence: number, publishTime: number }>}
 */
export async function getHntPrice() {
    const { priceData } = await fetchHntPriceVaa();

    if (!priceData) {
        throw new Error('Unable to parse HNT price from Pyth');
    }

    const price = Number(priceData.price) * Math.pow(10, priceData.expo);
    const confidence = Number(priceData.conf) * Math.pow(10, priceData.expo);

    return {
        price,
        confidence,
        publishTime: priceData.publish_time,
    };
}

/**
 * Helper to convert hex string to Uint8Array.
 */
function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

/**
 * Derive the treasury PDA for Pyth fee collection.
 * 
 * @param {number} treasuryId - Treasury ID (default 0)
 * @returns {PublicKey}
 */
function getTreasuryPda(treasuryId = 0) {
    const idBuffer = new Uint8Array(2);
    idBuffer[0] = treasuryId & 0xFF;
    idBuffer[1] = (treasuryId >> 8) & 0xFF;

    const [pda] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode(TREASURY_SEED), idBuffer],
        PYTH_SOLANA_RECEIVER_PROGRAM_ID
    );
    return pda;
}

/**
 * Derive the config PDA for Pyth Solana Receiver.
 * 
 * @returns {PublicKey}
 */
function getConfigPda() {
    const [pda] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode('config')],
        PYTH_SOLANA_RECEIVER_PROGRAM_ID
    );
    return pda;
}

/**
 * Build instructions to post a price update atomically (partially verified).
 * This creates an ephemeral price update account that can be consumed in the same transaction.
 * 
 * @param {string} vaaHex - Hex-encoded VAA from Pyth Hermes
 * @param {PublicKey} payer - Transaction payer
 * @returns {{ instructions: TransactionInstruction[], priceUpdateAccount: PublicKey, ephemeralKeypair: Keypair }}
 */
export function buildPostPriceUpdateAtomicInstructions(vaaHex, payer) {
    // Generate ephemeral keypair for the price update account
    const priceUpdateKeypair = Keypair.generate();
    const priceUpdateAccount = priceUpdateKeypair.publicKey;

    // Build the post_update_atomic instruction
    // Discriminator for post_update_atomic instruction
    const discriminator = new Uint8Array([0x04, 0xd1, 0xec, 0x85, 0x8f, 0x4a, 0x83, 0x4c]);

    // Parse VAA to get the data
    const vaaBytes = hexToBytes(vaaHex.startsWith('0x') ? vaaHex.slice(2) : vaaHex);

    // Build instruction data: discriminator + params
    // PostUpdateAtomicParams { vaa: Vec<u8>, merkle_price_update: MerklePriceUpdate }
    // For now, use a simplified approach - just pass the VAA
    const paramsBuffer = new Uint8Array(4 + vaaBytes.length);
    // Length prefix (little-endian u32)
    paramsBuffer[0] = vaaBytes.length & 0xFF;
    paramsBuffer[1] = (vaaBytes.length >> 8) & 0xFF;
    paramsBuffer[2] = (vaaBytes.length >> 16) & 0xFF;
    paramsBuffer[3] = (vaaBytes.length >> 24) & 0xFF;
    paramsBuffer.set(vaaBytes, 4);

    const instructionData = new Uint8Array(discriminator.length + paramsBuffer.length);
    instructionData.set(discriminator, 0);
    instructionData.set(paramsBuffer, discriminator.length);

    const treasury = getTreasuryPda(0);
    const config = getConfigPda();

    // Build the instruction
    const instruction = new TransactionInstruction({
        programId: PYTH_SOLANA_RECEIVER_PROGRAM_ID,
        keys: [
            { pubkey: payer, isSigner: true, isWritable: true },
            { pubkey: priceUpdateAccount, isSigner: true, isWritable: true },
            { pubkey: config, isSigner: false, isWritable: false },
            { pubkey: treasury, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: instructionData,
    });

    return {
        instructions: [instruction],
        priceUpdateAccount,
        ephemeralKeypair: priceUpdateKeypair,
    };
}

/**
 * Build instruction to close a price update account and recover rent.
 * 
 * @param {PublicKey} priceUpdateAccount - Account to close
 * @param {PublicKey} recipient - Rent recipient
 * @returns {TransactionInstruction}
 */
export function buildClosePriceUpdateInstruction(priceUpdateAccount, recipient) {
    // Discriminator for reclaim_rent instruction
    const discriminator = new Uint8Array([0x52, 0x88, 0x7f, 0x85, 0x99, 0x10, 0x3a, 0x2a]);

    return new TransactionInstruction({
        programId: PYTH_SOLANA_RECEIVER_PROGRAM_ID,
        keys: [
            { pubkey: recipient, isSigner: true, isWritable: true },
            { pubkey: priceUpdateAccount, isSigner: false, isWritable: true },
        ],
        data: discriminator,
    });
}
