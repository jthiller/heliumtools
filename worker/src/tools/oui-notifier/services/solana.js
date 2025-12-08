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
 * Fetch balances for multiple escrow accounts using chunked batched RPC requests.
 * Splits into batches of BATCH_SIZE to avoid RPC rate limits (429 errors).
 * 
 * @param {Object} env - Worker environment
 * @param {string[]} escrowAccounts - Array of escrow account addresses
 * @returns {Map<string, number>} Map of escrow address -> balance in DC
 */
const BATCH_SIZE = 10; // syndica free tier limit
const BATCH_DELAY_MS = 105; // 100 rps

export async function fetchEscrowBalancesBatched(env, escrowAccounts) {
  const rpcUrl = env.SOLANA_RPC_URL;
  if (!rpcUrl) throw new Error("SOLANA_RPC_URL is not configured.");

  if (!escrowAccounts || escrowAccounts.length === 0) {
    return new Map();
  }

  const balanceMap = new Map();
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

    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(batchPayload),
      });

      if (!res.ok) {
        console.error(`Batch ${batchIndex + 1}/${totalBatches} failed: ${res.status} ${res.statusText}`);
        // Continue with next batch instead of failing entirely
        continue;
      }

      const data = await res.json();

      if (!Array.isArray(data)) {
        console.error(`Batch ${batchIndex + 1}/${totalBatches}: expected array response`);
        continue;
      }

      // Process batch response
      for (const item of data) {
        const escrow = batchAccounts[item.id];
        if (!escrow) {
          console.error(`Batch response has unknown id: ${item.id}`);
          continue;
        }

        if (item.error) {
          // Handle "could not find account" as 0 balance (empty/new escrow)
          if (item.error.code === -32602 && item.error.message?.includes("could not find account")) {
            console.log(`Account not found for ${escrow}, recording 0 balance`);
            balanceMap.set(escrow, 0);
          } else {
            console.error(`RPC error for ${escrow}: ${JSON.stringify(item.error)}`);
          }
          continue;
        }

        const amountStr = item?.result?.value?.amount;
        if (!amountStr) {
          console.error(`Missing balance for ${escrow}`);
          continue;
        }

        const amount = Number(amountStr);
        if (!Number.isFinite(amount)) {
          console.error(`Invalid balance for ${escrow}: ${amountStr}`);
          continue;
        }

        balanceMap.set(escrow, amount);
      }

      console.log(`Batch ${batchIndex + 1}/${totalBatches}: fetched ${batchAccounts.length} accounts`);

    } catch (err) {
      console.error(`Batch ${batchIndex + 1}/${totalBatches} error:`, err);
    }

    // Delay between batches to avoid rate limiting (except for last batch)
    if (batchIndex < totalBatches - 1) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  console.log(`Batched RPC complete: fetched ${balanceMap.size}/${escrowAccounts.length} balances`);
  return balanceMap;
}

