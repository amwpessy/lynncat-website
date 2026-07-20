import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticateMarketRequest, handleMarketAuth } from '../src/marketAuth.js';
import {
  appleCredentialRequest,
  bearerRequest,
  createAccountEnv,
} from './helpers/market-account-fakes.mjs';

test('same Apple subject reuses one account on two platforms', async () => {
  const env = createAccountEnv({ appleSubject: 'apple-user-1' });
  const ios = await handleMarketAuth(appleCredentialRequest('ios', 'ios-install'), env);
  const mac = await handleMarketAuth(appleCredentialRequest('macos', 'mac-install'), env);

  assert.equal((await ios.clone().json()).account.id, (await mac.clone().json()).account.id);
  assert.equal(env.repo.users.size, 1);
  assert.equal(env.repo.devices.size, 2);
});

test('authorization exchange verifies a matching identity with the same nonce before writes', async () => {
  const env = createAccountEnv({ appleSubject: 'apple-user-1' });
  const verifications = [];
  env.VERIFY_APPLE_IDENTITY_TOKEN = async (token, nonce) => {
    verifications.push([token, nonce]);
    return {
      iss: 'https://appleid.apple.com',
      aud: 'com.lynncat.ios',
      exp: Math.floor(env.NOW() / 1000) + 300,
      nonce,
      sub: 'apple-user-1',
    };
  };

  const response = await handleMarketAuth(appleCredentialRequest(), env);

  assert.equal(response.status, 201);
  assert.deepEqual(verifications, [
    ['identity-token', 'nonce-12345678'],
    ['exchanged-id-token', 'nonce-12345678'],
  ]);
  assert.equal(env.repo.users.size, 1);
  assert.equal(env.repo.sessions.size, 1);
});

for (const [claim, exchangedIdentity] of [
  ['subject', { sub: 'different-apple-user', aud: 'com.lynncat.ios' }],
  ['audience', { sub: 'apple-user-1', aud: 'com.lynncat.macos' }],
]) {
  test(`authorization exchange rejects a mismatched ${claim} with zero persistent mutations`, async () => {
    const env = createAccountEnv({ appleSubject: 'apple-user-1' });
    env.VERIFY_APPLE_IDENTITY_TOKEN = async (token, nonce) => ({
      iss: 'https://appleid.apple.com',
      aud: token === 'exchanged-id-token' ? exchangedIdentity.aud : 'com.lynncat.ios',
      exp: Math.floor(env.NOW() / 1000) + 300,
      nonce,
      sub: token === 'exchanged-id-token' ? exchangedIdentity.sub : 'apple-user-1',
    });

    const response = await handleMarketAuth(appleCredentialRequest(), env);

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'invalid_apple_token' });
    assert.deepEqual({
      users: env.repo.users.size,
      credentials: env.repo.credentials.size,
      devices: env.repo.devices.size,
      sessions: env.repo.sessions.size,
    }, { users: 0, credentials: 0, devices: 0, sessions: 0 });
  });
}

test('Apple authentication stores only protected identifiers, credential and session values', async () => {
  const env = createAccountEnv({ appleSubject: 'apple-private-subject' });
  const response = await handleMarketAuth(appleCredentialRequest('watchos', 'private-installation'), env);
  const body = await response.json();
  const persisted = JSON.stringify({
    users: [...env.repo.users.values()],
    credentials: [...env.repo.credentials.values()],
    devices: [...env.repo.devices.values()],
    sessions: [...env.repo.sessions.values()],
  });

  assert.equal(response.status, 201);
  assert.deepEqual(Object.keys(body).sort(), ['account', 'sessionToken']);
  assert.deepEqual(Object.keys(body.account).sort(), [
    'id', 'leaderboardVisible', 'nickname', 'pointsBalance', 'pointsEarnedTotal',
  ]);
  assert.doesNotMatch(persisted, /apple-private-subject|private-installation|raw-refresh-token/);
  assert.doesNotMatch(persisted, new RegExp(body.sessionToken));
  assert.equal(env.repo.credentials.values().next().value.encryptedRefreshToken, 'sealed-refresh-token');
});

test('Apple authentication rejects invalid platform, installation ID and nonce before persistence', async () => {
  const cases = [
    [appleCredentialRequest('android', 'valid-install'), 'invalid_platform'],
    [appleCredentialRequest('ios', 'bad value'), 'invalid_installation_id'],
    [requestWith({ nonce: 'short' }), 'invalid_nonce'],
  ];

  for (const [request, code] of cases) {
    const env = createAccountEnv();
    const response = await handleMarketAuth(request, env);

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: code });
    assert.equal(env.repo.users.size, 0);
  }
});

test('invalid current credential key version fails before any account persistence', async () => {
  const env = createAccountEnv();
  env.APPLE_TOKEN_KEY_VERSION = 'invalid';

  const response = await handleMarketAuth(appleCredentialRequest(), env);

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'apple_configuration_unavailable' });
  assert.deepEqual({
    users: env.repo.users.size,
    credentials: env.repo.credentials.size,
    devices: env.repo.devices.size,
    sessions: env.repo.sessions.size,
  }, { users: 0, credentials: 0, devices: 0, sessions: 0 });
});

test('a valid bearer session returns the complete principal and updates last use', async () => {
  const env = createAccountEnv();
  const login = await handleMarketAuth(appleCredentialRequest(), env);
  const { sessionToken } = await login.json();

  const principal = await authenticateMarketRequest(bearerRequest(sessionToken), env);

  assert.deepEqual(Object.keys(principal).sort(), [
    'deviceId', 'nickname', 'pointsBalance', 'publicId', 'sessionId', 'userId',
  ]);
  assert.equal(principal.pointsBalance, 0);
  assert.equal([...env.repo.sessions.values()][0].lastUsedAt, env.NOW());
});

test('expired sessions fail closed', async () => {
  const env = createAccountEnv({ sessionExpired: true });
  await assert.rejects(
    authenticateMarketRequest(bearerRequest('expired-token'), env),
    (error) => error.code === 'session_expired' && error.status === 401,
  );
});

test('revoked sessions fail closed', async () => {
  const env = createAccountEnv({ sessionRevoked: true, sessionToken: 'revoked-token' });
  await assert.rejects(
    authenticateMarketRequest(bearerRequest('revoked-token'), env),
    (error) => error.code === 'session_revoked' && error.status === 401,
  );
});

function requestWith(overrides) {
  return new Request('https://unit.test/markets/auth/apple', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identityToken: 'identity-token',
      authorizationCode: 'authorization-code',
      nonce: 'nonce-12345678',
      installationId: 'ios-install',
      platform: 'ios',
      ...overrides,
    }),
  });
}
