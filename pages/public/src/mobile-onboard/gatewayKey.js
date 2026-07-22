/**
 * Lean gateway-key primitives: ed25519 keygen + Helium address + animal name.
 * NO protobuf — kept deliberately light so the key-grind Web Worker
 * (keygenWorker.js) can import it without pulling in the token/protobuf layer.
 * gatewayToken.js builds on this for the signed onboarding token.
 *
 * Pure module — no React.
 */
import { ed25519 } from "@noble/curves/ed25519";
import AddressDefault, { NetTypes, KeyTypes } from "@helium/address";
import animalHash from "angry-purple-tiger";

// @helium/address is transpiled CJS (`exports.default = Address`). Vite's
// interop resolves the default import to the class; Node-style interop (used
// by the esbuild-bundled round-trip test) resolves it to module.exports.
export const Address = AddressDefault.default ?? AddressDefault;
export { NetTypes, KeyTypes, animalHash };

/**
 * Derive a gateway's public identity from its ed25519 private key.
 * Returns { privateKey, addressBin, b58, name } — everything a caller needs to
 * either display the identity (b58 + angry-purple-tiger name) or build the
 * onboarding token (addressBin), without re-deriving.
 */
export function identityForPrivateKey(privateKey) {
  const publicKey = ed25519.getPublicKey(privateKey);
  const address = new Address(0, NetTypes.MAINNET, KeyTypes.ED25519_KEY_TYPE, publicKey);
  return {
    privateKey,
    addressBin: address.bin,
    b58: address.b58,
    name: animalHash(address.b58),
  };
}

/** Generate a fresh random gateway identity. */
export function randomIdentity() {
  return identityForPrivateKey(ed25519.utils.randomPrivateKey());
}
