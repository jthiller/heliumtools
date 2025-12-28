/**
 * Solana utilities for treasury operations.
 * Handles keypair loading, connection management, and transaction utilities.
 */

import {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    sendAndConfirmTransaction as solSendAndConfirm
} from '@solana/web3.js';
import bs58 from 'bs58';

/**
 * Default RPC URL (mainnet)
 */
const DEFAULT_RPC_URL = 'https://api.mainnet-beta.solana.com';

/**
 * Load the treasury keypair from environment variable.
 * Supports: JSON array [n,n,...], base64, and base58 encoded keypairs.
 * 
 * @param {object} env - Environment bindings
 * @returns {Keypair} Solana keypair
 */
export function getTreasuryKeypair(env) {
    const privateKeyStr = env.TREASURY_PRIVATE_KEY;
    if (!privateKeyStr) {
        throw new Error('TREASURY_PRIVATE_KEY environment variable not set');
    }

    const trimmed = privateKeyStr.trim();

    // Try JSON array first (from solana-keygen, like [1,2,3,...64 numbers])
    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed) && parsed.length === 64) {
                const decoded = Uint8Array.from(parsed);
                return Keypair.fromSecretKey(decoded);
            }
        } catch (e) {
            // Not valid JSON array
        }
    }

    // Try base64 (more common for full 64-byte keypairs)
    try {
        const decoded = Uint8Array.from(atob(trimmed), c => c.charCodeAt(0));
        if (decoded.length === 64) {
            return Keypair.fromSecretKey(decoded);
        }
    } catch (e) {
        // Not base64
    }

    // Try base58 (common for CLI-generated keys)
    try {
        const decoded = bs58.decode(trimmed);
        if (decoded.length === 64) {
            return Keypair.fromSecretKey(decoded);
        }
    } catch (e) {
        // Not base58 either
    }

    throw new Error('Invalid TREASURY_PRIVATE_KEY format. Expected JSON array [n,...], base64, or base58 encoded 64-byte keypair.');
}

/**
 * Get a Solana RPC connection.
 * 
 * @param {object} env - Environment bindings
 * @returns {Connection} Solana connection
 */
export function getConnection(env) {
    const rpcUrl = env.SOLANA_RPC_URL || DEFAULT_RPC_URL;
    return new Connection(rpcUrl, 'confirmed');
}

/**
 * Send and confirm a transaction with retries.
 * IMPORTANT: Checks transaction status before retrying to prevent double-sends.
 * 
 * @param {Connection} connection - Solana connection
 * @param {Transaction} transaction - Transaction to send
 * @param {Keypair[]} signers - Array of signers
 * @param {object} options - Options
 * @returns {Promise<string>} Transaction signature
 */
export async function sendAndConfirmTransaction(connection, transaction, signers, options = {}) {
    const { maxRetries = 3 } = options;
    let lastError;
    let lastSignature;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            // Get fresh blockhash for each attempt
            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.lastValidBlockHeight = lastValidBlockHeight;

            const signature = await solSendAndConfirm(
                connection,
                transaction,
                signers,
                { commitment: 'confirmed' }
            );

            return signature;
        } catch (err) {
            lastError = err;
            console.warn(`Transaction attempt ${attempt + 1} failed:`, err.message);

            // Extract signature from error if available
            const signatureMatch = err.message?.match(/Signature ([A-Za-z0-9]{87,88})/);
            if (signatureMatch) {
                lastSignature = signatureMatch[1];
            }

            // If it's a blockhash expiry or timeout, check if tx actually succeeded
            if (err.message?.includes('block height exceeded') ||
                err.message?.includes('Blockhash not found') ||
                err.message?.includes('timeout')) {

                // If we have a signature, check if the transaction actually went through
                if (lastSignature) {
                    try {
                        console.log(`Checking if transaction ${lastSignature} succeeded...`);
                        const status = await connection.getSignatureStatus(lastSignature, {
                            searchTransactionHistory: true
                        });

                        // Transaction succeeded! Return the signature.
                        if (status?.value?.confirmationStatus && !status.value.err) {
                            console.log(`Transaction ${lastSignature} actually succeeded with status: ${status.value.confirmationStatus}`);
                            return lastSignature;
                        }

                        // Transaction failed on-chain
                        if (status?.value?.err) {
                            throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.value.err)}`);
                        }
                    } catch (statusErr) {
                        console.warn(`Failed to check transaction status:`, statusErr.message);
                    }
                }

                // Only retry if we're not on the last attempt
                if (attempt < maxRetries - 1) {
                    console.log(`Retrying transaction (attempt ${attempt + 2}/${maxRetries})...`);
                    continue;
                }
            }

            // For other errors, throw immediately
            throw err;
        }
    }

    throw lastError || new Error('Transaction failed after max retries');
}

/**
 * Get token account balance.
 * 
 * @param {Connection} connection - Solana connection
 * @param {PublicKey} tokenAccount - Token account public key
 * @returns {Promise<bigint>} Token balance
 */
export async function getTokenBalance(connection, tokenAccount) {
    try {
        const info = await connection.getTokenAccountBalance(tokenAccount);
        return BigInt(info.value.amount);
    } catch (err) {
        console.error('Failed to get token balance:', err.message);
        return 0n;
    }
}

/**
 * Wait for a transaction to be confirmed and return its status.
 * 
 * @param {Connection} connection - Solana connection
 * @param {string} signature - Transaction signature
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<boolean>} True if confirmed, false if failed
 */
export async function waitForConfirmation(connection, signature, timeoutMs = 60000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const status = await connection.getSignatureStatus(signature);

        if (status?.value?.confirmationStatus === 'confirmed' ||
            status?.value?.confirmationStatus === 'finalized') {
            if (status.value.err) {
                throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
            }
            return true;
        }

        // Wait 1 second between checks
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error(`Transaction confirmation timeout after ${timeoutMs}ms`);
}

/**
 * Derive Associated Token Account address.
 * 
 * @param {PublicKey} owner - Owner public key
 * @param {PublicKey} mint - Token mint
 * @returns {Promise<PublicKey>} ATA address
 */
export async function getAssociatedTokenAddress(owner, mint) {
    const [ata] = await PublicKey.findProgramAddressSync(
        [
            owner.toBuffer(),
            new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA').toBuffer(),
            mint.toBuffer()
        ],
        new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
    );
    return ata;
}
