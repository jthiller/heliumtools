// Address labels for the council trace. The committed registry below is the
// floor and always wins; Helius Wallet Identity results (cached in D1) fill in
// the rest. Keys are OWNER wallets, never token accounts.
//
// kind:
//   exchange_hot      an exchange's own wallet: HNT arriving here is on the exchange (terminal)
//   exchange_deposit  a customer deposit address an exchange sweeps (followed to confirm the sweep)
//   helium_ops        a Helium-operated key (inferred from behaviour)
//   protocol          a program-owned pool or vault
//   council           part of the council flow itself

const IDENTITY = "Helius Wallet Identity API (2026-10-27)";

export const LABEL_REGISTRY = {
  // Coinbase hot wallets: every observed sweep from a council-linked deposit
  // address landed in one of these.
  "9obNtb5GyUegcs3a1CbBkLuc5hEWynWfJC6gjz5uWQkE": { name: "Coinbase Hot Wallet 1", kind: "exchange_hot", org: "Coinbase", evidence: IDENTITY },
  D89hHJT5Aqyx1trP6EnGY9jJUB3whgnq3aUvvCqedvzf: { name: "Coinbase Hot Wallet 2", kind: "exchange_hot", org: "Coinbase", evidence: IDENTITY },
  FpwQQhQQoEaVu3WU2qZMfF1hx48YyfwsLoRgXG83E99Q: { name: "Coinbase Hot Wallet 3", kind: "exchange_hot", org: "Coinbase", evidence: IDENTITY },
  DPqsobysNf5iA9w7zrQM8HLzCKZEDMkZsWbiidsAt1xo: { name: "Coinbase Hot Wallet 4", kind: "exchange_hot", org: "Coinbase", evidence: IDENTITY },
  GCRJD52pGwcCSs4oswYxTBCPatxY1P6WpxCC9R9zty6r: { name: "Coinbase Hot Wallet 5", kind: "exchange_hot", org: "Coinbase", evidence: IDENTITY },
  "4NyK1AdJBNbgaJ9EsKz3J4rfeHsuYdjkTPg3JaNdLeFw": { name: "Coinbase Hot Wallet 8", kind: "exchange_hot", org: "Coinbase", evidence: IDENTITY },
  "5g7yNHyGLJ7fiQ9SN9mf47opDnMjc585kqXWt6d7aBWs": { name: "Coinbase Hot Wallet 9", kind: "exchange_hot", org: "Coinbase", evidence: IDENTITY },
  "2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm": { name: "Coinbase Hot Wallet 10", kind: "exchange_hot", org: "Coinbase", evidence: IDENTITY },
  GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE: { name: "Coinbase Hot Wallet 11", kind: "exchange_hot", org: "Coinbase", evidence: IDENTITY },
  H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS: { name: "Coinbase Hot Wallet 12", kind: "exchange_hot", org: "Coinbase", evidence: IDENTITY },
  "59L2oxymiQQ9Hvhh92nt8Y7nDYjsauFkdb3SybdnsG6h": { name: "Coinbase Staking & Gas Distributor", kind: "exchange_hot", org: "Coinbase", evidence: IDENTITY },
  B48kNVXs4YK4amkBCH2XokQiv1SeiVQGHDR17xDeKAAn: { name: "ChangeNOW Hot Wallet 5", kind: "exchange_hot", org: "ChangeNOW", evidence: IDENTITY },

  // Coinbase deposit addresses. Identity tags them "Coinbase Deposit"; every
  // deposit is swept to the hot wallets above within minutes.
  DuSvSkEfi1mjNwpJprQo8qNajSHWsvwmUmjtwoZtzwmD: {
    name: "Coinbase deposit address", kind: "exchange_deposit", org: "Coinbase",
    evidence: "Identity tag 'Coinbase Deposit'; HNT deposits swept to Coinbase hot wallets, e.g. 3TyvmDJJwXju6pciM3NZXMWHXRtJj1k4DCJAyakk9Gd46GHmR4RZNJ5euN516c9tXjwiEyixyMZNdKtphrbMrikX",
  },
  GrUBdDfPU6ZPGZ8QaRtqUqQmYztj8CBrCz5vBraNJoYQ: {
    name: "Coinbase deposit address", kind: "exchange_deposit", org: "Coinbase", custodial: true,
    evidence: "Identity tag 'Coinbase Deposit'; SOL only from Coinbase Staking & Gas Distributor (5844C5S2anmr68J9XgdJDPiEio7r87tP7LSCQd91v9jPPeXERk4chPYPDPUPFXwyBc35uyBnLA23vb2Sr87rUVHq); every outflow a full-balance sweep to Coinbase hot wallets",
  },

  // Helium-operated keys (inferred from behaviour, not stated publicly).
  hprdnjkbziK8NqhThmAn5Gu4XqrBbctX8du4PfJdgvW: { name: "Helium operations key", kind: "helium_ops", inferred: true, evidence: "Created the council fanout (5nwytJpV8Gp36RN9ChgrhAio3CmGuVoAa8xztxoYVqvuzVbdtbuDD4V3B6vk47TZWBUsK94fXKBRD5HhT2Zk5zVY) and the seats' HNT accounts" },
  hPowhWccY2JyG2QeaNDMhpBpToZiDymy4hxoyiyvdrs: { name: "Helium operations wallet", kind: "helium_ops", inferred: true, evidence: "Queues hpl-crons claim tasks daily; sent each seat 0.13 to 0.20 HNT on 2026-07-24" },

  // The council flow itself.
  "2pCpQYrUmQor9igsF4cY7tkmd3jBQzHFEB75gtpjdWA2": { name: "HIP-149 council fanout", kind: "council", evidence: "Mini-fanout seed hip149-council" },
  GjumWQJZUcUwYdMkHDPDCRFhA7AQmb1kLapqLmDAYTVY: { name: "veHNT delegation rewards pool", kind: "protocol", evidence: "Authority of the HNT DAO delegator pool A7AjQhocZZvQXQJ5ducRF7gkconjNZfMNCjKguShoe8G" },
};

const DEPOSIT_TAG = /^(.+?)\s+Deposit$/i;

/**
 * Turn a cached Helius identity response into a label, or null.
 * Name and type win over tags: tags are third-party and can be wrong (a
 * "Bitstamp Deposit" tag sits on Coinbase Hot Wallet 10).
 */
export function labelFromIdentity(identity) {
  if (!identity || identity.none) return null;
  const name = identity.name || null;
  const type = identity.type || "unknown";
  if (type === "exchange" || identity.category === "Centralized Exchange") {
    return { name: name || "Exchange wallet", kind: "exchange_hot", org: orgFromName(name), source: "identity", confidence: name ? "high" : "medium" };
  }
  if (name) return { name, kind: "named", source: "identity", confidence: "medium" };
  for (const tag of identity.tags || []) {
    const m = DEPOSIT_TAG.exec(tag);
    if (m) {
      return { name: `${m[1]} deposit address`, kind: "exchange_deposit", org: m[1], source: "identity", confidence: "medium" };
    }
  }
  return null;
}

function orgFromName(name) {
  if (!name) return null;
  const m = /^(.*?)\s+(Hot Wallet|Cold Wallet|Deposit|Withdrawal|Exchange)\b/i.exec(name);
  return m ? m[1] : name;
}

/**
 * Build the label resolver used by classify/trace. `learned` is
 * { [address]: identityResponse } from D1.
 */
export function makeLabelResolver(learned = {}) {
  return (address) => {
    if (!address) return null;
    const reg = LABEL_REGISTRY[address];
    if (reg) return { ...reg, source: "registry", confidence: reg.inferred ? "medium" : "high" };
    return labelFromIdentity(learned[address]);
  };
}
