/**
 * Client-side compression for sharing entity keys via URL.
 *
 * Encoding: join keys with \n → deflate-raw → base64url query param.
 * Falls back to plain base64url when CompressionStream is unavailable.
 */

const CHUNK_SIZE = 0x8000;

function toBase64Url(bytes) {
  const chunks = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK_SIZE)));
  }
  return btoa(chunks.join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str) {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function streamToBytes(readable) {
  const reader = readable.getReader();
  const chunks = [];
  let totalLen = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLen += value.length;
  }
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export async function encodeKeys(keys) {
  const raw = new TextEncoder().encode(keys.join("\n"));

  if (typeof CompressionStream !== "undefined") {
    try {
      const cs = new CompressionStream("deflate-raw");
      const writer = cs.writable.getWriter();
      const readPromise = streamToBytes(cs.readable);
      writer.write(raw);
      writer.close();
      const compressed = await readPromise;
      return toBase64Url(compressed);
    } catch {
      // Fallback: if compression fails, use uncompressed base64url
    }
  }

  return toBase64Url(raw);
}

export async function decodeKeys(encoded) {
  const bytes = fromBase64Url(encoded);

  if (typeof DecompressionStream !== "undefined") {
    try {
      const ds = new DecompressionStream("deflate-raw");
      const writer = ds.writable.getWriter();
      const readPromise = streamToBytes(ds.readable);
      writer.write(bytes);
      writer.close();
      const decompressed = await readPromise;
      const text = new TextDecoder().decode(decompressed);
      return text.split("\n").filter(Boolean);
    } catch {
      // Fallback: data wasn't compressed (e.g. encoded without CompressionStream)
    }
  }

  const text = new TextDecoder().decode(bytes);
  return text.split("\n").filter(Boolean);
}
