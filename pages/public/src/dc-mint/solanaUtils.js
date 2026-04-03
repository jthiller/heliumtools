/**
 * Confirm a transaction landed on-chain and verify it succeeded.
 * Throws with a descriptive error if the transaction failed.
 */
export async function confirmAndVerify(connection, signature) {
  await connection.confirmTransaction(signature, "confirmed");

  // Verify success — getTransaction may lag behind confirmTransaction on some RPC nodes
  let tx;
  try {
    tx = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
  } catch (fetchErr) {
    // Verification is best-effort — the tx was confirmed, we just can't read it back
    console.warn("Post-confirm verification failed:", fetchErr);
    return;
  }

  if (!tx) {
    // RPC inconsistency — confirmed but not yet indexed. Treat as unverified success.
    console.warn("Transaction confirmed but getTransaction returned null");
    return;
  }

  if (tx.meta?.err) {
    const errMsg = tx.meta.logMessages?.findLast((l) => /error|fail/i.test(l)) || JSON.stringify(tx.meta.err);
    throw new Error(`Transaction failed on-chain: ${errMsg}`);
  }
}

/** Strip everything except digits (for DC/integer amounts). */
export const cleanInt = (v) => v.replace(/[^\d]/g, "");

/** Strip everything except digits and one decimal point (for HNT amounts). */
export const cleanDecimal = (v) => {
  const stripped = v.replace(/[^\d.]/g, "");
  const parts = stripped.split(".");
  return parts.length <= 1 ? stripped : parts[0] + "." + parts.slice(1).join("");
};
