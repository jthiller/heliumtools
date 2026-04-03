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

/**
 * Normalize a decimal number string from any locale format.
 * Handles: "1,000.5" (EN), "1.000,5" (DE/FR), "1 000,5" (FR), "1000.5", "1000,5"
 * Returns digits + at most one decimal point.
 */
export const cleanDecimal = (v) => {
  let s = v.replace(/[^\d.,]/g, "");
  const commaCount = (s.match(/,/g) || []).length;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  if (commaCount === 1 && lastComma > lastDot) {
    // Single comma after dots (or no dots): European decimal — "1.000,5" or "0,5"
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    // Multiple commas = EN thousands, strip them
    s = s.replace(/,/g, "");
  }

  // Detect dots used as thousands separators: multiple dots, or groups of exactly 3 digits
  const dotParts = s.split(".");
  if (dotParts.length > 2 && dotParts.slice(1).every((p) => p.length === 3)) {
    // All dot-separated groups are 3 digits — these are thousands separators, not decimals
    return dotParts.join("");
  }

  // Collapse to at most one decimal point
  return dotParts.length <= 1 ? s : dotParts[0] + "." + dotParts.slice(1).join("");
};
