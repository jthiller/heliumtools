/**
 * Confirm a transaction landed on-chain and verify it succeeded.
 * Throws with a descriptive error if the transaction failed.
 */
export async function confirmAndVerify(connection, signature) {
  await connection.confirmTransaction(signature, "confirmed");

  // Verify success — getTransaction may lag behind confirmTransaction on some RPC nodes.
  // Retry a few times with backoff since the index can trail behind confirmation.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let tx = null;
  let lastErr;

  for (let i = 0; i < 5; i++) {
    try {
      tx = await connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
    } catch (err) {
      lastErr = err;
    }
    if (tx) break;
    await sleep(400 * (i + 1));
  }

  if (!tx) {
    const suffix = lastErr ? ` Last error: ${lastErr}` : "";
    throw new Error(`Transaction confirmed but could not be verified after 5 attempts.${suffix}`);
  }

  if (tx.meta?.err) {
    const logs = tx.meta.logMessages || [];
    let errLog;
    for (let i = logs.length - 1; i >= 0; i--) {
      if (/error|fail/i.test(logs[i])) { errLog = logs[i]; break; }
    }
    throw new Error(`Transaction failed on-chain: ${errLog || JSON.stringify(tx.meta.err)}`);
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
    // Single comma after dots (or no dots).
    // Disambiguate: if exactly 3 digits follow the comma, treat as EN thousands ("1,000")
    // Otherwise it's a European decimal ("0,5" or "1.000,5")
    const afterComma = s.slice(lastComma + 1);
    if (/^\d{3}$/.test(afterComma)) {
      s = s.replace(/,/g, "");
    } else {
      s = s.replace(/\./g, "").replace(",", ".");
    }
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
