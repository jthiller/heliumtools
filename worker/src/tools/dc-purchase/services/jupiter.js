/**
 * Jupiter swap integration for USDC → HNT swaps.
 * Uses Jupiter Authenticated Swap API v1.
 * Requires JUPITER_API_KEY environment variable.
 */

import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import {
    JUPITER_QUOTE_API_URL,
    JUPITER_SWAP_API_URL,
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
 * @param {object} env - Environment bindings (for API key)
 * @param {string} inputMint - Input token mint address
 * @param {string} outputMint - Output token mint address
 * @param {number} amount - Amount in smallest units (e.g., lamports)
 * @param {number} slippageBps - Slippage in basis points (default 100 = 1%)
 * @returns {Promise<object>} Jupiter quote response
 */
export async function getSwapQuote(env, inputMint, outputMint, amount, slippageBps = 100) {
    const apiKey = env.JUPITER_API_KEY;
    if (!apiKey) {
        throw new Error('JUPITER_API_KEY environment variable is required');
    }

    const url = new URL(JUPITER_QUOTE_API_URL);
    url.searchParams.set('inputMint', inputMint);
    url.searchParams.set('outputMint', outputMint);
    url.searchParams.set('amount', String(amount));
    url.searchParams.set('slippageBps', String(slippageBps));

    console.log(`Getting Jupiter quote: ${url.toString()}`);

    const response = await fetch(url.toString(), {
        headers: {
            'x-api-key': apiKey,
        },
    });
    const responseText = await response.text();

    if (!response.ok) {
        console.error('Jupiter quote failed:', responseText);
        throw new Error(`Jupiter quote failed: ${response.status} - ${responseText}`);
    }

    let quote;
    try {
        quote = JSON.parse(responseText);
    } catch (e) {
        throw new Error(`Jupiter quote returned invalid JSON: ${responseText.substring(0, 200)}`);
    }

    if (quote.error) {
        throw new Error(`Jupiter quote error: ${quote.error}`);
    }

    console.log(`Quote received: ${quote.outAmount} output units`);
    return quote;
}

/**
 * Build a swap transaction from a Jupiter quote.
 * 
 * @param {object} env - Environment bindings (for API key)
 * @param {object} quoteResponse - Jupiter quote response
 * @param {string} userPublicKey - User's public key
 * @returns {Promise<VersionedTransaction>} Unsigned versioned transaction
 */
export async function buildSwapTransaction(env, quoteResponse, userPublicKey) {
    const apiKey = env.JUPITER_API_KEY;
    if (!apiKey) {
        throw new Error('JUPITER_API_KEY environment variable is required');
    }

    // Jupiter v1 API parameters
    const requestBody = {
        quoteResponse,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        dynamicSlippage: true,
        prioritizationFeeLamports: {
            priorityLevelWithMaxLamports: {
                maxLamports: 1000000, // 0.001 SOL max priority fee
                priorityLevel: "high"
            }
        }
    };

    console.log(`Building swap transaction...`);

    const response = await fetch(JUPITER_SWAP_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
        },
        body: JSON.stringify(requestBody),
    });

    const responseText = await response.text();

    if (!response.ok) {
        console.error('Jupiter swap build failed:', responseText);
        throw new Error(`Jupiter swap build failed: ${response.status} - ${responseText}`);
    }

    let data;
    try {
        data = JSON.parse(responseText);
    } catch (e) {
        throw new Error(`Jupiter swap build returned invalid JSON: ${responseText.substring(0, 200)}`);
    }

    // Check for error in response
    if (data.error) {
        console.error('Jupiter swap build error:', data);
        throw new Error(`Jupiter swap build error: ${data.error}${data.reference ? ` (ref: ${data.reference})` : ''}`);
    }

    if (!data.swapTransaction) {
        console.error('Jupiter swap build missing transaction:', data);
        throw new Error('Jupiter swap build returned no swapTransaction');
    }

    console.log(`Swap transaction built. Priority fee: ${data.prioritizationFeeLamports || 'N/A'} lamports`);

    // Decode base64 transaction (Cloudflare Workers compatible)
    const binaryString = atob(data.swapTransaction);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    const swapTransaction = VersionedTransaction.deserialize(bytes);

    return swapTransaction;
}

/**
 * Execute a USDC → HNT swap with retry logic.
 * If the transaction fails, retries with a fresh quote.
 * 
 * @param {object} env - Environment bindings
 * @param {number} usdcAmount - USDC amount in human-readable format (e.g., 50.00)
 * @param {object} options - Options
 * @returns {Promise<{ signature: string, hntReceived: bigint, quote: string }>} Swap result
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

            // Get fresh quote for each attempt (pass env for API key)
            const quote = await getSwapQuote(env, USDC_MINT, HNT_MINT, amountInSmallestUnits, slippageBps);
            console.log(`Quote received: ~${Number(quote.outAmount) / 1e8} HNT`);

            // Build transaction (pass env for API key)
            const transaction = await buildSwapTransaction(env, quote, userPublicKey);

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
                // Wait 1 second between attempts (1 RPS limit)
                await new Promise(resolve => setTimeout(resolve, 1000));
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
 * @param {object} env - Environment bindings  
 * @param {number} usdcAmount - USDC amount in human-readable format
 * @returns {Promise<number>} Expected HNT amount (human-readable)
 */
export async function getExpectedHntOutput(env, usdcAmount) {
    const amountInSmallestUnits = Math.floor(usdcAmount * Math.pow(10, USDC_DECIMALS));
    const quote = await getSwapQuote(env, USDC_MINT, HNT_MINT, amountInSmallestUnits);
    return Number(quote.outAmount) / 1e8; // Convert from smallest units to HNT
}
