import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { sha256 } from "js-sha256";
import { jsonResponse } from "../../../lib/response.js";

const MIGRATION_SERVICE_URL = "https://migration.web.helium.io";
const MIGRATION_TX_LIMIT = 1000;
const POLL_INTERVAL_MS = 1000;
const RESEND_INTERVAL_MS = 4000;
const MAX_WAIT_MS = 120_000;
const FETCH_TIMEOUT_MS = 15_000;
const POLL_BATCH_SIZE = 256;
const SEND_BATCH_SIZE = 50;

function resolveToSolanaAddress(input) {
  try {
    return new PublicKey(input);
  } catch {}

  // Helium B58: bs58-encoded [version, net_key_type, ...32_pubkey, ...4_checksum]
  try {
    const decoded = bs58.decode(input);
    if (decoded.length < 38) return null;
    const vPayload = decoded.slice(0, -4);
    const checksum = decoded.slice(-4);
    const hash1 = sha256.arrayBuffer(vPayload);
    const hash2 = new Uint8Array(sha256.arrayBuffer(hash1));
    for (let i = 0; i < 4; i++) {
      if (checksum[i] !== hash2[i]) return null;
    }
    const publicKeyBytes = vPayload.slice(2);
    if (publicKeyBytes.length !== 32) return null;
    return new PublicKey(publicKeyBytes);
  } catch {}

  return null;
}

async function fetchMigrationTransactions(solanaAddress) {
  const res = await fetch(
    `${MIGRATION_SERVICE_URL}/migrate/${solanaAddress}?limit=${MIGRATION_TX_LIMIT}`,
    { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
  );
  if (!res.ok) throw new Error(`Migration service error: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.transactions) ? data.transactions : [];
}

/**
 * Broadcast pre-signed raw transactions and poll until confirmed.
 * Returns { confirmed, failed } counts.
 */
async function broadcastAndConfirm(connection, txBuffers) {
  // pending maps index -> { buf, txid }
  const pending = new Map();
  for (let i = 0; i < txBuffers.length; i++) {
    pending.set(i, { buf: txBuffers[i], txid: null });
  }

  let failed = 0;
  let lastSendTime = 0;
  const startTime = Date.now();

  while (pending.size > 0) {
    if (Date.now() - startTime > MAX_WAIT_MS) {
      throw new Error(`Timeout: ${pending.size} transactions still pending`);
    }

    // Poll first so we don't resend already-confirmed transactions
    const pollable = [];
    for (const [idx, entry] of pending) {
      if (entry.txid) pollable.push(idx);
    }

    if (pollable.length > 0) {
      // Chunk polling to stay under the 256-signature RPC limit
      for (let b = 0; b < pollable.length; b += POLL_BATCH_SIZE) {
        const batch = pollable.slice(b, b + POLL_BATCH_SIZE);
        const batchIds = batch.map((idx) => pending.get(idx).txid);
        const statuses = await connection.getSignatureStatuses(batchIds);

        for (let j = 0; j < batch.length; j++) {
          const s = statuses.value[j];
          if (s?.err) {
            console.error(
              `Transaction ${batchIds[j]} failed on-chain:`,
              JSON.stringify(s.err)
            );
            pending.delete(batch[j]);
            failed++;
            continue;
          }
          const confirmed =
            s &&
            (s.confirmationStatus === "confirmed" ||
              s.confirmationStatus === "finalized");
          if (confirmed) {
            pending.delete(batch[j]);
          }
        }
      }
    }

    if (pending.size === 0) break;

    // Send/resend remaining pending transactions in batches
    if (Date.now() - lastSendTime >= RESEND_INTERVAL_MS) {
      lastSendTime = Date.now();
      const entries = [...pending.entries()];
      for (let b = 0; b < entries.length; b += SEND_BATCH_SIZE) {
        const batch = entries.slice(b, b + SEND_BATCH_SIZE);
        const sendResults = await Promise.all(
          batch.map(([, { buf }]) =>
            connection
              .sendRawTransaction(buf, { skipPreflight: true, maxRetries: 0 })
              .catch((err) => {
                console.warn("sendRawTransaction error:", err.message);
                return null;
              })
          )
        );
        for (let j = 0; j < batch.length; j++) {
          if (sendResults[j]) {
            batch[j][1].txid = sendResults[j];
          }
        }
      }
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  return { confirmed: txBuffers.length - failed, failed };
}

export async function handleMigrate(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { wallet } = body;
  if (!wallet || typeof wallet !== "string") {
    return jsonResponse({ error: "Missing wallet address" }, 400);
  }

  const solanaKey = resolveToSolanaAddress(wallet.trim());
  if (!solanaKey) {
    return jsonResponse(
      {
        error:
          "Invalid wallet address. Provide a Helium B58 or Solana base58 address.",
      },
      400
    );
  }

  const solanaAddress = solanaKey.toBase58();

  try {
    const txs = await fetchMigrationTransactions(solanaAddress);
    if (txs.length === 0) {
      return jsonResponse({
        success: true,
        message: "No transactions found to migrate.",
        wallet: solanaAddress,
        transactionsProcessed: 0,
      });
    }

    const connection = new Connection(env.SOLANA_RPC_URL, "confirmed");
    const txBuffers = txs.map((tx) => Buffer.from(tx, "base64"));
    const { confirmed, failed } = await broadcastAndConfirm(
      connection,
      txBuffers
    );

    // Verify via migration service re-fetch
    const remaining = await fetchMigrationTransactions(solanaAddress);
    if (remaining.length > 0) {
      return jsonResponse({
        success: false,
        message: `Failed to migrate ${remaining.length} transactions, try again`,
        wallet: solanaAddress,
        transactionsProcessed: confirmed,
        remaining: remaining.length,
      });
    }

    console.log(
      JSON.stringify({
        event: "l1_migration",
        wallet: solanaAddress,
        transactionsProcessed: confirmed,
        failed,
      })
    );

    return jsonResponse({
      success: true,
      message: "Migration successful!",
      wallet: solanaAddress,
      transactionsProcessed: confirmed,
    });
  } catch (err) {
    console.error("Migration error:", err.message, err.stack);
    return jsonResponse({ error: "Migration failed" }, 500);
  }
}
