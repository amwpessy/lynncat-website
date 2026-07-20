const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_KEYS_URL = `${APPLE_ISSUER}/auth/keys`;
const APPLE_TOKEN_URL = `${APPLE_ISSUER}/auth/token`;
const APPLE_REVOKE_URL = `${APPLE_ISSUER}/auth/revoke`;
const CLIENT_SECRET_LIFETIME_SECONDS = 300;
const JWKS_CACHE_MS = 60 * 60 * 1000;

let cachedAppleKeys = null;
let cachedAppleKeysUntil = 0;

export async function verifyAppleIdentityToken(token, expectedNonce, env) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3 || parts.some((part) => !part)) throw new Error('malformed JWT');
    const [head, body, signature] = parts;
    const header = decodeJsonPart(head);
    const payload = decodeJsonPart(body);

    if (header.alg !== 'ES256' || typeof header.kid !== 'string' || !header.kid) {
      throw new Error('unsupported JWT header');
    }
    if (payload.iss !== APPLE_ISSUER || !audienceIsAllowed(payload.aud, env)) {
      throw new Error('invalid JWT claims');
    }
    const expiresAt = Number(payload.exp) * 1000;
    if (!Number.isFinite(expiresAt) || expiresAt <= nowFor(env)) throw new Error('expired JWT');
    if (typeof expectedNonce !== 'string' || !expectedNonce || payload.nonce !== expectedNonce) {
      throw new Error('invalid nonce');
    }
    if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('missing subject');

    const key = await importAppleKey(header.kid, env);
    const valid = await cryptoFor(env).subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      joseSignatureToWebCrypto(signature),
      new TextEncoder().encode(`${head}.${body}`),
    );
    if (!valid) throw new Error('invalid signature');
    return payload;
  } catch (error) {
    if (error?.code === 'invalid_apple_token') throw error;
    throw marketError('invalid_apple_token', 401);
  }
}

export async function exchangeAppleAuthorizationCode(authorizationCode, clientId, env) {
  requireAllowedClientId(clientId, env);
  if (!isConfiguredString(authorizationCode)) throw marketError('invalid_apple_credential', 400);
  const clientSecret = await createAppleClientSecret(clientId, env);
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code: authorizationCode,
    grant_type: 'authorization_code',
  });
  const response = await fetchFor(env)(APPLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const result = await responseJson(response);
  if (!response.ok
    || !isConfiguredString(result?.refresh_token)
    || !isConfiguredString(result?.id_token)) {
    throw marketError('apple_token_exchange_failed', 502);
  }
  return result;
}

export async function revokeAppleRefreshToken(refreshToken, clientId, env) {
  requireAllowedClientId(clientId, env);
  if (!isConfiguredString(refreshToken)) throw marketError('invalid_apple_credential', 400);
  const clientSecret = await createAppleClientSecret(clientId, env);
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    token: refreshToken,
    token_type_hint: 'refresh_token',
  });
  const response = await fetchFor(env)(APPLE_REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!response.ok) throw marketError('apple_token_revocation_failed', 502);
}

export async function encryptRefreshToken(refreshToken, env) {
  if (!isConfiguredString(refreshToken)) throw marketError('invalid_apple_credential', 400);
  const keyVersion = currentAppleTokenKeyVersion(env);
  const rawKey = appleTokenEncryptionKey(keyVersion, env);

  const cryptoApi = cryptoFor(env);
  const key = await cryptoApi.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = randomBytes(12, env);
  const ciphertext = await cryptoApi.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(refreshToken),
  );
  return `v1.${encodeBase64Url(iv)}.${encodeBase64Url(ciphertext)}`;
}

export async function decryptRefreshToken(encryptedRefreshToken, tokenKeyVersion, env) {
  const rawKey = appleTokenEncryptionKey(tokenKeyVersion, env);
  try {
    const parts = String(encryptedRefreshToken || '').split('.');
    if (parts.length !== 3 || parts[0] !== 'v1' || !parts[1] || !parts[2]) {
      throw new Error('invalid encrypted credential');
    }
    const iv = decodeBase64(parts[1]);
    if (iv.byteLength !== 12) throw new Error('invalid iv');
    const cryptoApi = cryptoFor(env);
    const key = await cryptoApi.subtle.importKey(
      'raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt'],
    );
    const plaintext = await cryptoApi.subtle.decrypt(
      { name: 'AES-GCM', iv }, key, decodeBase64(parts[2]),
    );
    return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
  } catch (error) {
    if (error?.code === 'apple_configuration_unavailable') throw error;
    throw marketError('invalid_apple_credential', 400);
  }
}

export function currentAppleTokenKeyVersion(env) {
  const configured = env?.APPLE_TOKEN_KEY_VERSION ?? 1;
  const version = Number(configured);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw marketError('apple_configuration_unavailable', 503);
  }
  return version;
}

async function importAppleKey(kid, env) {
  let jwks = env?.APPLE_JWKS;
  let usedCachedFetch = false;
  if (!jwks) {
    usedCachedFetch = Boolean(cachedAppleKeys && cachedAppleKeysUntil > nowFor(env));
    jwks = await fetchAppleKeys(env);
  }
  let jwk = findAppleKey(jwks, kid);
  if (!jwk && usedCachedFetch) {
    jwks = await fetchAppleKeys(env, true);
    jwk = findAppleKey(jwks, kid);
  }
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256') throw new Error('unknown Apple key');
  return cryptoFor(env).subtle.importKey(
    'jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
  );
}

function findAppleKey(jwks, kid) {
  return Array.isArray(jwks?.keys) ? jwks.keys.find((candidate) => candidate.kid === kid) : null;
}

async function fetchAppleKeys(env, forceRefresh = false) {
  const now = nowFor(env);
  if (!forceRefresh && cachedAppleKeys && cachedAppleKeysUntil > now) return cachedAppleKeys;
  const response = await fetchFor(env)(APPLE_KEYS_URL);
  const result = await responseJson(response);
  if (!response.ok || !Array.isArray(result?.keys)) throw new Error('Apple keys unavailable');
  cachedAppleKeys = result;
  cachedAppleKeysUntil = now + JWKS_CACHE_MS;
  return result;
}

async function createAppleClientSecret(clientId, env) {
  const teamId = configuredValue(env?.APPLE_TEAM_ID);
  const keyId = configuredValue(env?.APPLE_KEY_ID);
  const privateKeyPem = configuredValue(env?.APPLE_PRIVATE_KEY);
  if (!teamId || !keyId || !privateKeyPem) throw marketError('apple_configuration_unavailable', 503);

  const nowSeconds = Math.floor(nowFor(env) / 1000);
  const head = encodeJsonPart({ alg: 'ES256', kid: keyId, typ: 'JWT' });
  const body = encodeJsonPart({
    iss: teamId,
    iat: nowSeconds,
    exp: nowSeconds + CLIENT_SECRET_LIFETIME_SECONDS,
    aud: APPLE_ISSUER,
    sub: clientId,
  });
  const key = await cryptoFor(env).subtle.importKey(
    'pkcs8',
    pemToBytes(privateKeyPem),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = await cryptoFor(env).subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${encodeBase64Url(signature)}`;
}

function requireAllowedClientId(clientId, env) {
  if (!isConfiguredString(clientId) || !allowedAudiences(env).has(clientId)) {
    throw marketError('invalid_apple_audience', 401);
  }
}

function audienceIsAllowed(audience, env) {
  const values = Array.isArray(audience) ? audience : [audience];
  const allowed = allowedAudiences(env);
  return values.length > 0 && values.every((value) => typeof value === 'string')
    && values.some((value) => allowed.has(value));
}

function allowedAudiences(env) {
  const configured = env?.APPLE_CLIENT_IDS;
  const values = Array.isArray(configured) ? configured : String(configured || '').split(',');
  return new Set(values.map((value) => String(value).trim()).filter(Boolean));
}

function joseSignatureToWebCrypto(value) {
  const signature = decodeBase64Url(value);
  if (signature.byteLength !== 64) throw new Error('invalid ES256 signature');
  return signature;
}

function decodeJsonPart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

function encodeJsonPart(value) {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeBase64Url(value) {
  try {
    return decodeBase64(value);
  } catch {
    return new Uint8Array();
  }
}

function decodeBase64(value) {
  const input = String(value || '');
  const standard = /^[A-Za-z0-9+/]*={0,2}$/.test(input);
  const url = /^[A-Za-z0-9_-]*={0,2}$/.test(input);
  if (!input || (!standard && !url)) throw new Error('invalid base64');
  const firstPadding = input.indexOf('=');
  const unpadded = firstPadding < 0 ? input : input.slice(0, firstPadding);
  if (firstPadding >= 0 && input.length % 4 !== 0) throw new Error('invalid base64 padding');
  if (unpadded.length % 4 === 1) throw new Error('invalid base64 length');

  const normalized = unpadded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const canonical = btoa(binary).replace(/=+$/g, '');
  if (canonical !== normalized) throw new Error('non-canonical base64');
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function appleTokenEncryptionKey(tokenKeyVersion, env) {
  const version = Number(tokenKeyVersion);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw marketError('apple_configuration_unavailable', 503);
  }

  const keyring = appleTokenEncryptionKeyring(env);
  let encodedKey = keyring && Object.hasOwn(keyring, String(version))
    ? keyring[String(version)]
    : null;
  if (!isConfiguredString(encodedKey) && version === currentAppleTokenKeyVersion(env)) {
    encodedKey = env?.APPLE_TOKEN_ENCRYPTION_KEY;
  }
  if (!isConfiguredString(encodedKey)) {
    throw marketError('apple_configuration_unavailable', 503);
  }

  try {
    const rawKey = decodeBase64(encodedKey.trim());
    if (rawKey.byteLength !== 32) throw new Error('incorrect AES key length');
    return rawKey;
  } catch {
    throw marketError('apple_configuration_unavailable', 503);
  }
}

function appleTokenEncryptionKeyring(env) {
  const configured = env?.APPLE_TOKEN_ENCRYPTION_KEYS;
  if (configured == null || configured === '') return null;
  if (typeof configured === 'object' && !Array.isArray(configured)) return configured;
  if (typeof configured !== 'string') throw marketError('apple_configuration_unavailable', 503);
  try {
    const parsed = JSON.parse(configured);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid keyring');
    return parsed;
  } catch {
    throw marketError('apple_configuration_unavailable', 503);
  }
}

function encodeBase64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToBytes(value) {
  const base64 = value
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const bytes = decodeBase64Url(base64);
  if (!bytes.byteLength) throw marketError('apple_configuration_unavailable', 503);
  return bytes;
}

function randomBytes(length, env) {
  if (typeof env?.RANDOM_BYTES === 'function') {
    const bytes = env.RANDOM_BYTES(length);
    if (bytes instanceof Uint8Array && bytes.byteLength === length) return bytes;
    throw marketError('apple_configuration_unavailable', 503);
  }
  const bytes = new Uint8Array(length);
  cryptoFor(env).getRandomValues(bytes);
  return bytes;
}

function cryptoFor(env) {
  return env?.CRYPTO || globalThis.crypto;
}

function fetchFor(env) {
  return env?.FETCH || globalThis.fetch;
}

function nowFor(env) {
  const candidate = typeof env?.NOW === 'function' ? env.NOW() : env?.NOW;
  return Number.isFinite(candidate) ? Number(candidate) : Date.now();
}

function configuredValue(value) {
  return isConfiguredString(value) ? value.trim() : '';
}

function isConfiguredString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

async function responseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function marketError(code, status) {
  return Object.assign(new Error(code), { code, status });
}
