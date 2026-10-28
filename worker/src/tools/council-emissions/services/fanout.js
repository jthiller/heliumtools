// Decode the MiniFanoutV0 account (mini-fanout program 0.1.x), used to show
// the configured shares and to notice drift (shares, delegates or schedule
// changing). Layout, after the 8-byte Anchor discriminator:
//   owner, namespace, mint, token_account, task_queue, next_task, rent_refund (7 x Pubkey)
//   bump u8, schedule String, queue_authority_bump u8
//   shares Vec<{ wallet Pubkey, delegate Pubkey, share enum { Share(u32) | Fixed(u64) }, total_dust u64, total_owed u64 }>
//   seed Vec<u8>, next_pre_task Pubkey, pre_task Option<...>
// Verified against the live account 2pCpQY... on 2026-10-27.

import bs58 from "bs58";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";

export function decodeMiniFanout(buf) {
  let o = 8;
  const pk = () => {
    const v = bs58.encode(buf.subarray(o, o + 32));
    o += 32;
    return v;
  };
  const u8 = () => buf[o++];
  const u32 = () => {
    const v = buf.readUInt32LE(o);
    o += 4;
    return v;
  };
  const u64 = () => {
    const v = buf.readBigUInt64LE(o);
    o += 8;
    return v;
  };

  const out = {};
  for (const k of ["owner", "namespace", "mint", "tokenAccount", "taskQueue", "nextTask", "rentRefund"]) out[k] = pk();
  u8(); // bump
  const schedLen = u32();
  out.schedule = buf.subarray(o, o + schedLen).toString("utf8");
  o += schedLen;
  u8(); // queue_authority_bump
  const n = u32();
  out.shares = [];
  for (let i = 0; i < n; i++) {
    const wallet = pk();
    const delegate = pk();
    const tag = u8();
    const share = tag === 0 ? { kind: "share", amount: u32() } : { kind: "fixed", amount: u64().toString() };
    u64(); // total_dust
    const totalOwed = u64();
    out.shares.push({ wallet, delegate: delegate === SYSTEM_PROGRAM ? null : delegate, share, totalOwed: totalOwed.toString() });
  }
  const seedLen = u32();
  out.seed = buf.subarray(o, o + seedLen).toString("utf8");
  return out;
}
