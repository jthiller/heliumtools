/**
 * Jupiter swap integration for USDC → HNT swaps.
 * Uses Jupiter Aggregator API v6.
 */

import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import {
    JUPITER_API_URL,
    USDC_MINT,
    HNT_MINT,
    USDC_DECIMALS
} from '../lib/constants.js';
import {
    getTreasuryKeypair,
    getConnection,
    waitForConfirmation,
    getTokenBalance,
    getAssociatedTokenAddress
} from './solana.js';

/**
 * Get a swap quote from Jupiter.
 * 
 * @param {string} inputMint - Input token mint address
 * @param {string} outputMint - Output token mint address
 * @param {number} amount - Amount in smallest units (e.g., lamports)
 * @param {number} slippageBps - Slippage in basis points (default 50 = 0.5%)
 * @returns {Promise<object>} Jupiter quote response
 */
export async function getSwapQuote(inputMint, outputMint, amount, slippageBps = 50) {
    const url = new URL(`${JUPITER_API_URL}/quote`);
    url.searchParams.set('inputMint', inputMint);
    url.searchParams.set('outputMint', outputMint);
    url.searchParams.set('amount', String(amount));
    url.searchParams.set('slippageBps', String(slippageBps));

    const response = await fetch(url.toString());

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Jupiter quote failed: ${response.status} - ${error}`);
    }

    return response.json();
}

/**
 * Build a swap transaction from a Jupiter quote.
 * 
 * @param {object} quote - Jupiter quote response
 * @param {string} userPublicKey - User's public key
 * @returns {Promise<VersionedTransaction>} Unsigned versioned transaction
 */
export async function buildSwapTransaction(quote, userPublicKey) {
    const response = await fetch(`${JUPITER_API_URL}/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            quoteResponse: quote,
            userPublicKey,
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: 'auto',
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Jupiter swap build failed: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const swapTransaction = VersionedTransaction.deserialize(
        Buffer.from(data.swapTransaction, 'base64')
    );

    return swapTransaction;
}

/**
 * Execute a USDC → HNT swap with retry logic.
 * If the transaction fails, retries with a fresh quote.
 * 
 * @param {object} env - Environment bindings
 * @param {number} usdcAmount - USDC amount in human-readable format (e.g., 50.00)
 * @param {object} options - Options
 * @returns {Promise<{ signature: string, hntReceived: bigint }>} Swap result
 */
export async function executeSwapWithRetry(env, usdcAmount, options = {}) {
    const { maxRetries = 3, slippageBps = 100 } = options; // 1% slippage default

    const keypair = getTreasuryKeypair(env);
    const connection = getConnection(env);
    const userPublicKey = keypair.publicKey.toBase58();

    // Convert human-readable USDC to smallest units
    const amountInSmallestUnits = Math.floor(usdcAmount * Math.pow(10, USDC_DECIMALS));

    // Get initial HNT balance to calculate received amount
    const hntMint = new PublicKey(HNT_MINT);
    const hntAta = await getAssociatedTokenAddress(keypair.publicKey, hntMint);
    const initialHntBalance = await getTokenBalance(connection, hntAta);

    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            console.log(`Swap attempt ${attempt + 1}/${maxRetries}: ${usdcAmount} USDC → HNT`);

            // Get fresh quote for each attempt
            const quote = await getSwapQuote(USDC_MINT, HNT_MINT, amountInSmallestUnits, slippageBps);
            console.log(`Quote received: ~${quote.outAmount / 1e8} HNT`);

            // Build transaction
            const transaction = await buildSwapTransaction(quote, userPublicKey);

            // Sign transaction
            transaction.sign([keypair]);

            // Send transaction
            const rawTransaction = transaction.serialize();
            const signature = await connection.sendRawTransaction(rawTransaction, {
                skipPreflight: false,
                preflightCommitment: 'confirmed',
            });

            console.log(`Transaction sent: ${signature}`);

            // Wait for confirmation
            await waitForConfirmation(connection, signature, 60000);
            console.log('Transaction confirmed');

            // Verify HNT received
            const finalHntBalance = await getTokenBalance(connection, hntAta);
            const hntReceived = finalHntBalance - initialHntBalance;

            if (hntReceived <= 0n) {
                throw new Error('No HNT received after swap');
            }

            console.log(`Swap successful: received ${Number(hntReceived) / 1e8} HNT`);

            return {
                signature,
                hntReceived,
                quote: JSON.stringify(quote),
            };
        } catch (err) {
            lastError = err;
            console.error(`Swap attempt ${attempt + 1} failed:`, err.message);

            // If it's a quote/signature/timeout error, retry with fresh quote
            if (attempt < maxRetries - 1) {
                console.log('Retrying with fresh quote...');
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s before retry
                continue;
            }
        }
    }

    throw new Error(`Swap failed after ${maxRetries} attempts: ${lastError?.message}`);
}

/**
 * Get expected HNT output for a given USDC amount.
 * Useful for UI display before executing the swap.
 * 
 * @param {number} usdcAmount - USDC amount in human-readable format
 * @returns {Promise<number>} Expected HNT amount (human-readable)
 */
export async function getExpectedHntOutput(usdcAmount) {
    const amountInSmallestUnits = Math.floor(usdcAmount * Math.pow(10, USDC_DECIMALS));
    const quote = await getSwapQuote(USDC_MINT, HNT_MINT, amountInSmallestUnits);
    return Number(quote.outAmount) / 1e8; // Convert from smallest units to HNT
}
