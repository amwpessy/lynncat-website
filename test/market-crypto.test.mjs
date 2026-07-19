import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptRefreshToken,
  exchangeAppleAuthorizationCode,
  revokeAppleRefreshToken,
  verifyAppleIdentityToken,
} from '../src/marketCrypto.js';

const encoder = new TextEncoder();
const NOW = 1_700_000_000_000;

test('verifyAppleIdentityToken accepts a valid Apple ES256 identity token', async () => {
  const fixture = await appleTokenFixture();
  const payload = await verifyAppleIdentityToken(fixture.token, 'nonce-123', fixture.env);

  assert.equal(payload.sub, 'apple-user-1');
});

for (const [label, mutate] of [
  ['signature', async (fixture) => {
    const other = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    return signedToken(fixture.header, fixture.payload, other.privateKey);
  }],
  ['iss', async (fixture) => signedToken(fixture.header, { ...fixture.payload, iss: 'https://attacker.test' }, fixture.privateKey)],
  ['aud', async (fixture) => signedToken(fixture.header, { ...fixture.payload, aud: 'com.attacker.app' }, fixture.privateKey)],
  ['exp', async (fixture) => signedToken(fixture.header, { ...fixture.payload, exp: Math.floor(NOW / 1000) }, fixture.privateKey)],
  ['nonce', async (fixture) => signedToken(fixture.header, { ...fixture.payload, nonce: 'wrong-nonce' }, fixture.privateKey)],
  ['kid', async (fixture) => signedToken({ ...fixture.header, kid: 'unknown-key' }, fixture.payload, fixture.privateKey)],
]) {
  test(`verifyAppleIdentityToken rejects wrong ${label}`, async () => {
    const fixture = await appleTokenFixture();
    const token = await mutate(fixture);

    await assert.rejects(
      verifyAppleIdentityToken(token, 'nonce-123', fixture.env),
      (error) => error.code === 'invalid_apple_token' && error.status === 401,
    );
  });
}

test('Apple token exchange signs a client secret for an allowed audience', async () => {
  const fixture = await appleClientFixture();
  let submitted;
  fixture.env.FETCH = async (url, init) => {
    submitted = { url, init, body: new URLSearchParams(init.body) };
    return Response.json({ refresh_token: 'apple-refresh-token' });
  };

  const tokens = await exchangeAppleAuthorizationCode('authorization-code', 'com.lynncat.ios', fixture.env);
  const claims = decodePart(submitted.body.get('client_secret').split('.')[1]);

  assert.equal(tokens.refresh_token, 'apple-refresh-token');
  assert.equal(submitted.url, 'https://appleid.apple.com/auth/token');
  assert.equal(submitted.body.get('grant_type'), 'authorization_code');
  assert.equal(submitted.body.get('code'), 'authorization-code');
  assert.equal(submitted.body.get('client_id'), 'com.lynncat.ios');
  assert.deepEqual(
    { iss: claims.iss, aud: claims.aud, sub: claims.sub },
    { iss: 'TEAM123', aud: 'https://appleid.apple.com', sub: 'com.lynncat.ios' },
  );
});

test('Apple refresh-token revocation uses the signed client credentials', async () => {
  const fixture = await appleClientFixture();
  let submitted;
  fixture.env.FETCH = async (_url, init) => {
    submitted = new URLSearchParams(init.body);
    return new Response(null, { status: 200 });
  };

  await revokeAppleRefreshToken('apple-refresh-token', 'com.lynncat.ios', fixture.env);

  assert.equal(submitted.get('token'), 'apple-refresh-token');
  assert.equal(submitted.get('token_type_hint'), 'refresh_token');
  assert.equal(submitted.get('client_id'), 'com.lynncat.ios');
  assert.ok(submitted.get('client_secret'));
});

test('refresh-token encryption uses AES-GCM and never returns plaintext', async () => {
  const key = new Uint8Array(32).fill(9);
  const encrypted = await encryptRefreshToken('apple-refresh-token', {
    APPLE_TOKEN_ENCRYPTION_KEY: base64url(key),
    RANDOM_BYTES: (length) => new Uint8Array(length).fill(4),
  });

  assert.match(encrypted, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.doesNotMatch(encrypted, /apple-refresh-token/);
});

async function appleTokenFixture() {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
  );
  const header = { alg: 'ES256', kid: 'apple-key-1', typ: 'JWT' };
  const payload = {
    iss: 'https://appleid.apple.com',
    aud: 'com.lynncat.ios',
    exp: Math.floor(NOW / 1000) + 300,
    nonce: 'nonce-123',
    sub: 'apple-user-1',
  };
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  return {
    header,
    payload,
    privateKey: keyPair.privateKey,
    token: await signedToken(header, payload, keyPair.privateKey),
    env: {
      NOW: () => NOW,
      APPLE_CLIENT_IDS: 'com.lynncat.ios,com.lynncat.macos,com.lynncat.watchos',
      APPLE_JWKS: { keys: [{ ...publicJwk, kid: header.kid, alg: 'ES256', use: 'sig' }] },
    },
  };
}

async function appleClientFixture() {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
  );
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(pkcs8).toString('base64')}\n-----END PRIVATE KEY-----`;
  return {
    env: {
      NOW: () => NOW,
      APPLE_CLIENT_IDS: 'com.lynncat.ios,com.lynncat.macos,com.lynncat.watchos',
      APPLE_TEAM_ID: 'TEAM123',
      APPLE_KEY_ID: 'KEY123',
      APPLE_PRIVATE_KEY: pem,
    },
  };
}

async function signedToken(header, payload, privateKey) {
  const head = base64url(encoder.encode(JSON.stringify(header)));
  const body = base64url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, privateKey, encoder.encode(`${head}.${body}`),
  );
  return `${head}.${body}.${base64url(signature)}`;
}

function decodePart(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}
