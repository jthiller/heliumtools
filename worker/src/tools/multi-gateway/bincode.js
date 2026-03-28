/**
 * Convert a Solana VersionedTransaction between wire and bincode format.
 *
 * The ONLY differences between wire and bincode for VersionedTransaction:
 * 1. Vec<Signature> prefix: wire uses compact_u16, bincode uses u64_le
 * 2. VersionedMessage enum: wire has no variant tag, bincode has u32_le(0) for Legacy
 *
 * The message body itself is IDENTICAL because Solana's Message uses
 * #[serde(with = "short_vec")] which keeps compact_u16 in both formats.
 * (Verified: solana-program/src/message/legacy.rs lines 118,127)
 */

function readCompactU16(buf, pos) {
  let val = buf[pos];
  pos++;
  if (val < 0x80) return [val, pos];
  val = (val & 0x7f) | (buf[pos] << 7);
  pos++;
  if (val < 0x4000) return [val, pos];
  val = (val & 0x3fff) | (buf[pos] << 14);
  pos++;
  return [val, pos];
}

/**
 * Convert VersionedTransaction.serialize() wire bytes to bincode format.
 *
 * VersionedMessage has a CUSTOM Serialize impl (not derive).
 * For Legacy messages, it uses serialize_tuple(1) which in bincode
 * means NO variant tag — the message bytes start directly after sigs.
 * The first byte (num_required_signatures) distinguishes Legacy from V0.
 */
export function wireToBincode(wireBytes) {
  // Read compact_u16 num_signatures
  const [numSigs, afterNumSigs] = readCompactU16(wireBytes, 0);
  const sigsAndMessage = wireBytes.slice(afterNumSigs);

  // Bincode: u64_le(num_sigs) + sigs + message (NO variant tag for Legacy)
  const prefix = Buffer.alloc(8);
  prefix.writeUInt32LE(numSigs, 0);

  return Buffer.concat([prefix, sigsAndMessage]);
}

/**
 * Convert bincode format back to wire format.
 */
export function bincodeToWire(bincodeBytes) {
  const numSigs = bincodeBytes.readUInt32LE(0);
  const sigsAndMessage = bincodeBytes.slice(8); // skip u64

  return Buffer.concat([Buffer.from([numSigs]), sigsAndMessage]);
}
