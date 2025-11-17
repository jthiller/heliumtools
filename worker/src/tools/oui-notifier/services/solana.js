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
