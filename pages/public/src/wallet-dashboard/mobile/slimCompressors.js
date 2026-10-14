// Stand-in for the `hyparquet-compressors` package (aliased in vite.config.js
// by exact specifier, so its own subpath imports below still resolve). Helium's
// Mobile tables are written with ZSTD; Avro manifests may use deflate, which
// icebird decodes with `gunzip`. The real package also bundles Brotli (with an
// ~80 KB dictionary), LZ4 and a Snappy WASM module compiled at import time,
// none of which these tables use.
import { decompress as decompressZstd } from "fzstd";
import { gunzip } from "hyparquet-compressors/src/gzip.js";

export { gunzip };

/** @type {import('hyparquet').Compressors} */
export const compressors = {
  ZSTD: (input) => decompressZstd(input),
  GZIP: (input, length) => gunzip(input, new Uint8Array(length)),
};
