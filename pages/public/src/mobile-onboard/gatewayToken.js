/**
 * Gateway onboarding token for Mobile WiFi onboarding — the browser
 * equivalent of `helium-wallet hotspots add mobile token`.
 *
 * A token is a base64 `blockchain_txn` protobuf envelope wrapping a
 * `blockchain_txn_add_gateway_v1` whose only populated fields are the
 * gateway's Helium binary address and the gateway key's ed25519 signature
 * over the message with that signature cleared. The gateway private key is
 * only ever held transiently (during generation/grinding and this build) —
 * it signs once and is discarded; certificates are later signed by the
 * owner's wallet, so the gateway secret is never needed again.
 *
 * Key primitives (keygen + address + animal name) live in the lean
 * gatewayKey.js so the key-grind worker can reuse them without protobuf.
 *
 * Pure module — no React, usable from node for round-trip tests.
 */
import protobuf from "protobufjs/light";
import { ed25519 } from "@noble/curves/ed25519";
import { Address, KeyTypes, animalHash, identityForPrivateKey } from "./gatewayKey.js";

const root = new protobuf.Root();

// On-chain transaction messages from github.com/helium/proto
// (blockchain_txn_add_gateway_v1.proto / blockchain_txn.proto). These are NOT
// the same as iot-onboard/bleProto.js's `add_gateway_v1` — that is the BLE
// gateway-config REQUEST message (string owner/payer, no gateway field);
// reusing it here would produce tokens the ECC verifier rejects.
const AddGatewayTxn = new protobuf.Type("blockchain_txn_add_gateway_v1")
  .add(new protobuf.Field("owner", 1, "bytes"))
  .add(new protobuf.Field("gateway", 2, "bytes"))
  .add(new protobuf.Field("owner_signature", 3, "bytes"))
  .add(new protobuf.Field("gateway_signature", 4, "bytes"))
  .add(new protobuf.Field("payer", 5, "bytes"))
  .add(new protobuf.Field("payer_signature", 6, "bytes"))
  .add(new protobuf.Field("staking_fee", 7, "uint64"))
  .add(new protobuf.Field("fee", 8, "uint64"));
root.add(AddGatewayTxn);

// blockchain_txn { oneof txn { blockchain_txn_add_gateway_v1 add_gateway = 1; ... } }
// Only the add_gateway arm is modeled — any other txn type is not a valid
// onboarding token.
const TxnEnvelope = new protobuf.Type("blockchain_txn")
  .add(new protobuf.Field("add_gateway", 1, "blockchain_txn_add_gateway_v1"));
root.add(TxnEnvelope);

export function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function bytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Re-encode an add-gateway txn with gateway_signature cleared — the exact
 * bytes the gateway key signs and the ECC verifier checks (mirrors the CLI's
 * `add_tx.gateway_signature = vec![]; add_tx.encode_to_vec()`). Proto3 omits
 * empty/zero fields, so only populated fields are written, in field-number
 * order (matching prost).
 */
function encodeUnsignedMsg(txn) {
  const fields = { gateway: txn.gateway };
  if (txn.owner?.length) fields.owner = txn.owner;
  if (txn.owner_signature?.length) fields.owner_signature = txn.owner_signature;
  if (txn.payer?.length) fields.payer = txn.payer;
  if (txn.payer_signature?.length) fields.payer_signature = txn.payer_signature;
  if (txn.staking_fee && Number(txn.staking_fee) !== 0) fields.staking_fee = txn.staking_fee;
  if (txn.fee && Number(txn.fee) !== 0) fields.fee = txn.fee;
  return AddGatewayTxn.encode(fields).finish();
}

/**
 * Build the signed onboarding token for a specific ed25519 private key.
 * Returns { gatewayB58, animalName, token, unsignedMsgHex, signatureHex }.
 * Used by the simple generate path and by the key-grind flow, which hands in
 * the private key of the identity the user chose. The caller is responsible
 * for discarding the private key afterward.
 */
export function buildTokenFromPrivateKey(privateKey) {
  const { addressBin, b58, name } = identityForPrivateKey(privateKey);

  const unsignedMsg = encodeUnsignedMsg({ gateway: addressBin });
  const signature = ed25519.sign(unsignedMsg, privateKey);

  const envelope = TxnEnvelope.encode({
    add_gateway: { gateway: addressBin, gateway_signature: signature },
  }).finish();

  return {
    gatewayB58: b58,
    animalName: name,
    token: bytesToBase64(envelope),
    unsignedMsgHex: bytesToHex(unsignedMsg),
    signatureHex: bytesToHex(signature),
  };
}

/**
 * Decode + validate an onboarding token (browser-generated or pasted from
 * `helium-wallet hotspots add mobile token`). Verifies the embedded ed25519
 * gateway signature so a corrupted paste fails here instead of at the ECC
 * verifier. Returns { gatewayB58, animalName, unsignedMsgHex, signatureHex }.
 */
export function parseGatewayToken(tokenB64) {
  let envelope;
  try {
    envelope = TxnEnvelope.decode(base64ToBytes(tokenB64.trim()));
  } catch {
    throw new Error("Not a valid onboarding token");
  }

  const txn = envelope.add_gateway;
  if (!txn || !txn.gateway?.length) {
    throw new Error("Token does not contain an add-gateway transaction");
  }
  if (!txn.gateway_signature?.length) {
    throw new Error("Token is missing the gateway signature");
  }

  let address;
  try {
    address = Address.fromBin(Buffer.from(txn.gateway));
  } catch (err) {
    throw new Error(`Token contains an invalid gateway key (${err.message})`);
  }
  if (address.keyType !== KeyTypes.ED25519_KEY_TYPE) {
    throw new Error("Token gateway key is not ed25519");
  }

  const unsignedMsg = encodeUnsignedMsg(txn);
  const valid = ed25519.verify(txn.gateway_signature, unsignedMsg, address.publicKey);
  if (!valid) {
    throw new Error("Token gateway signature is invalid. The token may be corrupted");
  }

  return {
    gatewayB58: address.b58,
    animalName: animalHash(address.b58),
    unsignedMsgHex: bytesToHex(unsignedMsg),
    signatureHex: bytesToHex(txn.gateway_signature),
  };
}
