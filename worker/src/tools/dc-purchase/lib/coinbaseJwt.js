/**
 * Generate a JWT for Coinbase CDP API authentication.
 * 
 * Supports two key formats:
 * 1. Ed25519 (EdDSA): Base64-encoded 64 bytes (32 bytes seed + 32 bytes public key)
 * 2. EC (ES256): PEM format (-----BEGIN EC PRIVATE KEY-----)
 */

/**
 * Base64URL encode a Uint8Array.
 */
function base64UrlEncode(bytes) {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Standard base64 decode to Uint8Array.
 */
function base64Decode(str) {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
        base64 += '=';
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/**
 * Generate a random hex nonce.
 */
function generateNonce() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Check if the key is an Ed25519 key (base64 64-byte format).
 */
function isEd25519Key(keySecret) {
    // Ed25519 keys are 64 bytes when decoded from base64
    try {
        if (keySecret.includes('-----BEGIN')) {
            return false; // PEM format = EC key
        }
        const decoded = base64Decode(keySecret);
        return decoded.length === 64;
    } catch {
        return false;
    }
}

/**
 * Check if the key is a PEM-formatted EC key.
 */
function isECKey(keySecret) {
    return keySecret.includes('-----BEGIN') && keySecret.includes('PRIVATE KEY');
}

/**
 * Build JWT with Ed25519 key using JWK import.
 */
async function buildEd25519Jwt(apiKeyId, apiKeySecret, uri, now, expiresIn) {
    // Decode the base64 key (64 bytes: 32 seed + 32 public key)
    const decoded = base64Decode(apiKeySecret);
    if (decoded.length !== 64) {
        throw new Error(`Invalid Ed25519 key length: expected 64 bytes, got ${decoded.length}`);
    }

    const seed = decoded.slice(0, 32);
    const publicKey = decoded.slice(32);

    // Create JWK from key components
    const jwk = {
        kty: 'OKP',
        crv: 'Ed25519',
        d: base64UrlEncode(seed),
        x: base64UrlEncode(publicKey),
    };

    // Import as CryptoKey using JWK format
    // Note: Cloudflare Workers use NODE-ED25519 for EdDSA
    const key = await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' },
        false,
        ['sign']
    );

    // Build JWT
    const header = {
        alg: 'EdDSA',
        typ: 'JWT',
        kid: apiKeyId,
        nonce: generateNonce(),
    };

    const payload = {
        sub: apiKeyId,
        iss: 'cdp',
        iat: now,
        nbf: now,
        exp: now + expiresIn,
        uris: [uri],
    };

    const encoder = new TextEncoder();
    const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
    const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
    const message = `${headerB64}.${payloadB64}`;

    // Sign with Ed25519
    const signature = await crypto.subtle.sign(
        { name: 'NODE-ED25519' },
        key,
        encoder.encode(message)
    );

    return `${message}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Build JWT with EC key (ES256) using PKCS8 PEM import.
 */
async function buildECJwt(apiKeyId, apiKeySecret, uri, now, expiresIn) {
    // Process PEM key - ensure proper newlines
    let pemKey = apiKeySecret;
    if (pemKey.includes('\\n')) {
        pemKey = pemKey.replace(/\\n/g, '\n');
    }

    // Extract base64 content from PEM
    const pemContent = pemKey
        .replace(/-----BEGIN [\w\s]+-----/, '')
        .replace(/-----END [\w\s]+-----/, '')
        .replace(/\s+/g, '');

    const keyData = base64Decode(pemContent);

    // Import as CryptoKey
    const key = await crypto.subtle.importKey(
        'pkcs8',
        keyData,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign']
    );

    // Build JWT
    const header = {
        alg: 'ES256',
        typ: 'JWT',
        kid: apiKeyId,
        nonce: generateNonce(),
    };

    const payload = {
        sub: apiKeyId,
        iss: 'cdp',
        iat: now,
        nbf: now,
        exp: now + expiresIn,
        uris: [uri],
    };

    const encoder = new TextEncoder();
    const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
    const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
    const message = `${headerB64}.${payloadB64}`;

    // Sign with ECDSA
    const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        encoder.encode(message)
    );

    // Convert DER signature to compact form for JWT
    const compactSig = derToCompact(new Uint8Array(signature));
    return `${message}.${base64UrlEncode(compactSig)}`;
}

/**
 * Convert DER-encoded ECDSA signature to compact form (r || s).
 */
function derToCompact(der) {
    // DER format: 0x30 [len] 0x02 [r_len] [r] 0x02 [s_len] [s]
    if (der[0] !== 0x30) {
        // Already in compact form or unknown format
        return der;
    }

    let offset = 2; // Skip 0x30 and length byte

    // Read r
    if (der[offset] !== 0x02) throw new Error('Invalid DER signature');
    offset++;
    const rLen = der[offset];
    offset++;
    let r = der.slice(offset, offset + rLen);
    offset += rLen;

    // Read s
    if (der[offset] !== 0x02) throw new Error('Invalid DER signature');
    offset++;
    const sLen = der[offset];
    offset++;
    let s = der.slice(offset, offset + sLen);

    // Remove leading zeros and pad to 32 bytes
    while (r.length > 32 && r[0] === 0) r = r.slice(1);
    while (s.length > 32 && s[0] === 0) s = s.slice(1);

    const result = new Uint8Array(64);
    result.set(r, 32 - r.length);
    result.set(s, 64 - s.length);

    return result;
}

/**
 * Generate a JWT for Coinbase CDP API.
 *
 * @param {string} apiKeyId - The API key ID (e.g., UUID or organizations/xxx/apiKeys/xxx format)
 * @param {string} apiKeySecret - Ed25519 base64 key or EC PEM key
 * @param {string} requestMethod - HTTP method (GET, POST, etc.)
 * @param {string} requestHost - API host (e.g., "api.developer.coinbase.com")
 * @param {string} requestPath - Request path (e.g., "/onramp/v1/token")
 * @returns {Promise<string>} The signed JWT
 */
export async function generateCoinbaseJwt(apiKeyId, apiKeySecret, requestMethod, requestHost, requestPath) {
    const uri = `${requestMethod.toUpperCase()} ${requestHost}${requestPath}`;
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = 120; // 2 minutes

    if (isEd25519Key(apiKeySecret)) {
        return await buildEd25519Jwt(apiKeyId, apiKeySecret, uri, now, expiresIn);
    } else if (isECKey(apiKeySecret)) {
        return await buildECJwt(apiKeyId, apiKeySecret, uri, now, expiresIn);
    } else {
        throw new Error('Invalid key format - must be either base64 Ed25519 key (64 bytes) or PEM EC key');
    }
}
