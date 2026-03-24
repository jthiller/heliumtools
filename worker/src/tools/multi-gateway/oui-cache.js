/**
 * OUI DevAddr cache — fetches Helium OUI → DevAddr range mappings
 * from the IoT config service via gRPC-web and caches in KV.
 */

const CONFIG_HOST = "https://config.iot.mainnet.helium.io:6080";
const WELL_KNOWN_URL =
  "https://raw.githubusercontent.com/helium/well-known/refs/heads/main/lists/ouis.json";
const KV_KEY = "oui-devaddr-map";
const KV_TTL_SECONDS = 86400; // 24 hours

// --- Minimal protobuf helpers ---

function encodeVarint(value) {
  const bytes = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value & 0x7f);
  return bytes;
}

function decodeVarint(buf, pos) {
  let result = 0;
  let shift = 0;
  while (pos < buf.length) {
    const b = buf[pos];
    result |= (b & 0x7f) << shift;
    pos++;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return [result >>> 0, pos];
}

function parseFields(buf) {
  const fields = [];
  let pos = 0;
  while (pos < buf.length) {
    const [tag, p1] = decodeVarint(buf, pos);
    const fieldNum = tag >>> 3;
    const wireType = tag & 0x07;
    if (wireType === 0) {
      const [val, p2] = decodeVarint(buf, p1);
      fields.push({ field: fieldNum, type: "varint", value: val });
      pos = p2;
    } else if (wireType === 2) {
      const [len, p2] = decodeVarint(buf, p1);
      fields.push({
        field: fieldNum,
        type: "bytes",
        value: buf.subarray(p2, p2 + len),
      });
      pos = p2 + len;
    } else {
      break; // unsupported wire type
    }
  }
  return fields;
}

// --- gRPC-web helpers ---

function grpcFrame(protobufBytes) {
  const frame = new Uint8Array(5 + protobufBytes.length);
  frame[0] = 0; // not compressed
  const len = protobufBytes.length;
  frame[1] = (len >>> 24) & 0xff;
  frame[2] = (len >>> 16) & 0xff;
  frame[3] = (len >>> 8) & 0xff;
  frame[4] = len & 0xff;
  frame.set(protobufBytes, 5);
  return frame;
}

async function grpcWebCall(path, body) {
  const res = await fetch(`${CONFIG_HOST}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/grpc-web+proto",
      "X-Grpc-Web": "1",
    },
    body,
  });
  // gRPC-web over HTTP/2 — returns 200 with grpc-status header.
  // Note: fails locally in wrangler dev (Miniflare uses HTTP/1.1),
  // works in production where Cloudflare negotiates HTTP/2.
  const grpcStatus = res.headers.get("grpc-status");
  if (!res.ok && grpcStatus !== "0") return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf.length > 5 ? buf.subarray(5) : null;
}

// --- Config service calls ---

async function fetchOrgList() {
  const payload = grpcFrame(new Uint8Array(0)); // OrgListReqV1 is empty
  const data = await grpcWebCall("/helium.iot_config.org/list", payload);
  if (!data) return [];

  const fields = parseFields(data);
  const ouis = [];
  for (const f of fields) {
    if (f.field === 1 && f.type === "bytes") {
      const orgFields = parseFields(f.value);
      const ouiField = orgFields.find(
        (x) => x.field === 1 && x.type === "varint",
      );
      if (ouiField) ouis.push(ouiField.value);
    }
  }
  return ouis;
}

async function fetchOrgDevaddrs(oui) {
  // OrgGetReqV1 { oui: uint64 } — field 1 varint
  const proto = new Uint8Array([0x08, ...encodeVarint(oui)]);
  const payload = grpcFrame(proto);
  const data = await grpcWebCall("/helium.iot_config.org/get", payload);
  if (!data) return [];

  const fields = parseFields(data);
  const ranges = [];
  for (const f of fields) {
    if (f.field === 3 && f.type === "bytes") {
      // DevaddrConstraintV1 — field 1 = start_addr, field 2 = end_addr
      const inner = parseFields(f.value);
      const start = inner.find((x) => x.field === 1)?.value;
      const end = inner.find((x) => x.field === 2)?.value;
      if (start != null && end != null) {
        ranges.push({
          start: (start >>> 0).toString(16).toUpperCase().padStart(8, "0"),
          end: (end >>> 0).toString(16).toUpperCase().padStart(8, "0"),
        });
      }
    }
  }
  return ranges;
}

async function fetchWellKnownNames() {
  try {
    const res = await fetch(WELL_KNOWN_URL);
    if (!res.ok) return {};
    const list = await res.json();
    const map = {};
    for (const entry of list) {
      if (entry.id != null && entry.name) {
        map[entry.id] = entry.name;
      }
    }
    return map;
  } catch {
    return {};
  }
}

// --- Public API ---

export async function refreshOuiCache(env) {
  const ouiIds = await fetchOrgList();
  const names = await fetchWellKnownNames();

  // Fetch devaddr constraints in parallel batches of 20
  const BATCH_SIZE = 20;
  const results = [];

  for (let i = 0; i < ouiIds.length; i += BATCH_SIZE) {
    const batch = ouiIds.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (oui) => ({
        oui,
        name: names[oui] || null,
        ranges: await fetchOrgDevaddrs(oui),
      })),
    );
    for (const r of batchResults) {
      if (r.status === "fulfilled" && r.value.ranges.length > 0) {
        results.push(r.value);
      } else if (r.status === "rejected") {
        console.error("Failed to fetch devaddrs for OUI:", r.reason);
      }
    }
  }

  const data = { ouis: results, updated: Date.now() };
  await env.KV.put(KV_KEY, JSON.stringify(data), {
    expirationTtl: KV_TTL_SECONDS,
  });
  return data;
}

export async function getOuiCache(env) {
  const cached = await env.KV.get(KV_KEY);
  if (cached) return JSON.parse(cached);
  return refreshOuiCache(env);
}
