// Pure date-shape helpers shared by the api-iot client and the dashboard's
// derivations. No imports: Node scripts (the wallet dashboard's derivation
// harness) load the derivation modules directly, and those must not reach
// lib/api.js, which reads `import.meta.env`.

/** A utilization data day, "YYYY-MM-DD". */
export const DATA_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
