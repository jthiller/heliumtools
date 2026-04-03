/**
 * Confirm a transaction landed on-chain and verify it succeeded.
 * Throws with a descriptive error if the transaction failed.
 */
export async function confirmAndVerify(connection, signature) {
  await connection.confirmTransaction(signature, "confirmed");
  const tx = await connection.getTransaction(signature, { maxSupportedTransactionVersion: 0 });
  if (tx?.meta?.err) {
    const errMsg = tx.meta.logMessages?.find((l) => /error|fail/i.test(l)) || JSON.stringify(tx.meta.err);
    throw new Error(`Transaction failed on-chain: ${errMsg}`);
  }
}
