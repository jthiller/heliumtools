/**
 * Fetch balance for a single escrow account.
 * Use fetchEscrowBalancesBatched() for bulk fetches to avoid subrequest limits.
 */
export async function fetchEscrowBalanceDC(env, escrowAccount) {
  const rpcUrl = env.SOLANA_RPC_URL;
  if (!rpcUrl) throw new Error("SOLANA_RPC_URL is not configured.");

  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "getTokenAccountBalance",
    params: [escrowAccount],
  };

  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`RPC HTTP error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  if (data.error) {
    // Handle "could not find account" as 0 balance
    if (isAccountNotFoundError(data.error)) {
      return 0;
    }
    throw new Error(`RPC error: ${JSON.stringify(data.error)}`);
  }

  const amountStr = data?.result?.value?.amount;
  if (!amountStr) {
    throw new Error("RPC response missing balance amount.");
  }

  const amount = Number(amountStr);
  if (!Number.isFinite(amount)) {
    throw new Error("Balance amount is not a valid number.");
  }

  return amount;
}

/**
 * Check if an RPC error indicates account not found.
 * Solana RPC can return this in various ways:
 * - code -32602 with "could not find account" message
 * - code -32602 with "Invalid param" message
 * - null result value
 */
function isAccountNotFoundError(error) {
  if (!error) return false;

  const message = error.message?.toLowerCase() || "";

  // Check for common "account not found" patterns
  return (
    message.includes("could not find account") ||
    message.includes("account not found") ||
    message.includes("invalid param") ||
    (error.code === -32602 && message.includes("account"))
  );
}

/**
 * Fetch balances for multiple escrow accounts using chunked batched RPC requests.
 * Splits into batches of BATCH_SIZE to avoid RPC rate limits (429 errors).
 * 
 * @param {Object} env - Worker environment
 * @param {string[]} escrowAccounts - Array of escrow account addresses
 * @returns {Map<string, number>} Map of escrow address -> balance in DC
 */
const BATCH_SIZE = 10; // syndica free tier limit
const BATCH_DELAY_MS = 105 // 100 rps limit. 10*105=100/1.05=95.23 rps
const RATE_LIMIT_DELAY_MS = 1000; // longer delay after rate limit errors

export async function fetchEscrowBalancesBatched(env, escrowAccounts) {
  const rpcUrl = env.SOLANA_RPC_URL;
  if (!rpcUrl) throw new Error("SOLANA_RPC_URL is not configured.");

  if (!escrowAccounts || escrowAccounts.length === 0) {
    return new Map();
  }

  const balanceMap = new Map();
  const failedAccounts = [];
  const totalBatches = Math.ceil(escrowAccounts.length / BATCH_SIZE);

  console.log(`Fetching ${escrowAccounts.length} balances in ${totalBatches} batches of ${BATCH_SIZE}`);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const start = batchIndex * BATCH_SIZE;
    const end = Math.min(start + BATCH_SIZE, escrowAccounts.length);
    const batchAccounts = escrowAccounts.slice(start, end);

    // Build batched JSON-RPC request for this chunk
    const batchPayload = batchAccounts.map((escrow, index) => ({
      jsonrpc: "2.0",
      id: index,
      method: "getTokenAccountBalance",
      params: [escrow],
    }));

    let shouldApplyRateLimitDelay = false;

    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(batchPayload),
      });

      if (!res.ok) {
        console.error(`Batch ${batchIndex + 1}/${totalBatches} failed: ${res.status} ${res.statusText}`);
        // Track failed accounts for logging
        failedAccounts.push(...batchAccounts);

        // Apply longer delay after rate limit errors (429)
        if (res.status === 429) {
          shouldApplyRateLimitDelay = true;
        }
      } else {
        const data = await res.json();

        if (!Array.isArray(data)) {
          console.error(`Batch ${batchIndex + 1}/${totalBatches}: expected array response`);
          failedAccounts.push(...batchAccounts);
        } else {
          // Process batch response
          for (const item of data) {
            const escrow = batchAccounts[item.id];
            if (!escrow) {
              console.error(`Batch response has unknown id: ${item.id}`);
              continue;
            }

            if (item.error) {
              // Handle "could not find account" as 0 balance (empty/new escrow)
              if (isAccountNotFoundError(item.error)) {
                console.log(`Account not found for ${escrow}, recording 0 balance`);
                balanceMap.set(escrow, 0);
              } else {
                console.error(`RPC error for ${escrow}: ${JSON.stringify(item.error)}`);
                failedAccounts.push(escrow);
              }
              continue;
            }

            const amountStr = item?.result?.value?.amount;
            if (!amountStr) {
              console.error(`Missing balance for ${escrow}`);
              failedAccounts.push(escrow);
              continue;
            }

            const amount = Number(amountStr);
            if (!Number.isFinite(amount)) {
              console.error(`Invalid balance for ${escrow}: ${amountStr}`);
              failedAccounts.push(escrow);
              continue;
            }

            balanceMap.set(escrow, amount);
          }

          console.log(`Batch ${batchIndex + 1}/${totalBatches}: fetched ${batchAccounts.length} accounts`);
        }
      }

    } catch (err) {
      console.error(`Batch ${batchIndex + 1}/${totalBatches} error:`, err);
      failedAccounts.push(...batchAccounts);
    }

    // Delay between batches to avoid rate limiting (except for last batch)
    if (batchIndex < totalBatches - 1) {
      const delayMs = shouldApplyRateLimitDelay ? RATE_LIMIT_DELAY_MS : BATCH_DELAY_MS;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // Log summary of failed accounts
  if (failedAccounts.length > 0) {
    console.warn(`Failed to fetch ${failedAccounts.length} accounts: ${failedAccounts.slice(0, 5).join(", ")}${failedAccounts.length > 5 ? "..." : ""}`);
  }

  console.log(`Batched RPC complete: fetched ${balanceMap.size}/${escrowAccounts.length} balances`);
  return balanceMap;
}
