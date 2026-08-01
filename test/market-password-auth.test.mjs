import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMarketAuth } from '../src/marketAuth.js';
import { handleMarketAccount } from '../src/marketAccount.js';
import {
  databasePlatformFor,
  handleMarketPasswordAuth,
} from '../src/marketPasswordAuth.js';
import {
  appleCredentialRequest,
  createAccountEnv,
} from './helpers/market-account-fakes.mjs';

const PASSWORD = 'correct-horse-42';

test('password registration creates a session without retaining raw login secrets', async () => {
  const env = createAccountEnv();
  const response = await handleMarketPasswordAuth(passwordRequest(
    '/markets/auth/password/register',
  ), env);
  const body = await response.json();
  const persisted = JSON.stringify({
    users: [...env.repo.users.values()],
    credentials: [...env.repo.passwordCredentials.values()],
    sessions: [...env.repo.sessions.values()],
  });
  const protectedPersistence = JSON.stringify({
    credentials: [...env.repo.passwordCredentials.values()],
    sessions: [...env.repo.sessions.values()],
  });

  assert.equal(response.status, 201);
  assert.equal(body.account.nickname, 'LC pilot-user');
  assert.equal(body.account.pointsBalance, 0);
  assert.equal(env.repo.users.size, 1);
  assert.equal(env.repo.passwordCredentials.size, 1);
  assert.doesNotMatch(protectedPersistence, /pilot-user|correct-horse-42/);
  assert.doesNotMatch(persisted, /correct-horse-42/);
  assert.doesNotMatch(persisted, new RegExp(body.sessionToken));
});

test('an eight-character password with letters and numbers is accepted', async () => {
  const env = createAccountEnv();
  const response = await handleMarketPasswordAuth(passwordRequest(
    '/markets/auth/password/register',
    { password: 'market88' },
  ), env);

  assert.equal(response.status, 201);
  assert.equal(env.repo.passwordCredentials.size, 1);
});

test('the web client is an accepted password-account platform', async () => {
  const env = createAccountEnv();
  const response = await handleMarketPasswordAuth(passwordRequest(
    '/markets/auth/password/register',
    { platform: 'web', installationId: 'web-browser-001' },
  ), env);

  assert.equal(response.status, 201);
  assert.equal(env.repo.devices.values().next().value.platform, 'web');
});

test('the D1 compatibility layer stores web devices in the legacy desktop platform bucket', () => {
  assert.equal(databasePlatformFor('web'), 'macos');
  assert.equal(databasePlatformFor('macos'), 'macos');
  assert.equal(databasePlatformFor('ios'), 'ios');
  assert.equal(databasePlatformFor('watchos'), 'watchos');
});

test('password login returns the same account and data on another installation', async () => {
  const env = createAccountEnv();
  const registration = await handleMarketPasswordAuth(passwordRequest(
    '/markets/auth/password/register',
  ), env);
  const registered = await registration.json();
  env.repo.user.pointsBalance = 4321;

  const login = await handleMarketPasswordAuth(passwordRequest(
    '/markets/auth/password/login',
    { installationId: 'direct-mac-002' },
  ), env);
  const body = await login.json();

  assert.equal(login.status, 200);
  assert.equal(body.account.id, registered.account.id);
  assert.equal(body.account.pointsBalance, 4321);
  assert.equal(env.repo.users.size, 1);
  assert.equal(env.repo.devices.size, 2);
});

test('login restores a legacy truncated default nickname from the full account name', async () => {
  const env = createAccountEnv();
  await handleMarketPasswordAuth(passwordRequest('/markets/auth/password/register'), env);
  env.repo.user.nickname = 'LC pilot-';

  const login = await handleMarketPasswordAuth(passwordRequest(
    '/markets/auth/password/login',
    { installationId: 'restore-mac-002' },
  ), env);
  const body = await login.json();

  assert.equal(login.status, 200);
  assert.equal(body.account.nickname, 'LC pilot-user');
  assert.equal(env.repo.user.nickname, 'LC pilot-user');
});

test('login never replaces a custom nickname', async () => {
  const env = createAccountEnv();
  await handleMarketPasswordAuth(passwordRequest('/markets/auth/password/register'), env);
  env.repo.user.nickname = 'My Market Name';

  const login = await handleMarketPasswordAuth(passwordRequest(
    '/markets/auth/password/login',
    { installationId: 'custom-name-mac-002' },
  ), env);
  const body = await login.json();

  assert.equal(login.status, 200);
  assert.equal(body.account.nickname, 'My Market Name');
  assert.equal(env.repo.user.nickname, 'My Market Name');
});

test('an Apple account can link a Lynncat login and reuse its existing user ID', async () => {
  const env = createAccountEnv();
  const appleLogin = await handleMarketAuth(appleCredentialRequest('macos', 'store-mac-001'), env);
  const appleBody = await appleLogin.json();
  env.repo.user.pointsBalance = 9750;

  const link = await handleMarketPasswordAuth(passwordRequest(
    '/markets/auth/password/link',
    {},
    appleBody.sessionToken,
  ), env);
  const directLogin = await handleMarketPasswordAuth(passwordRequest(
    '/markets/auth/password/login',
    { installationId: 'direct-mac-001' },
  ), env);
  const directBody = await directLogin.json();

  assert.equal(link.status, 200);
  assert.deepEqual(await link.json(), { linked: true });
  assert.equal(directLogin.status, 200);
  assert.equal(directBody.account.id, appleBody.account.id);
  assert.equal(directBody.account.pointsBalance, 9750);
  assert.equal(env.repo.users.size, 1);
});

test('a username cannot be attached to a different account', async () => {
  const env = createAccountEnv();
  await handleMarketPasswordAuth(passwordRequest('/markets/auth/password/register'), env);
  const originalUserId = env.repo.user.id;

  const secondApple = createAccountEnv({ appleSubject: 'apple-user-2' });
  const appleLogin = await handleMarketAuth(appleCredentialRequest(), secondApple);
  const { sessionToken } = await appleLogin.json();
  secondApple.repo.passwordCredentials = env.repo.passwordCredentials;

  const response = await handleMarketPasswordAuth(passwordRequest(
    '/markets/auth/password/link',
    {},
    sessionToken,
  ), {
    ...secondApple,
    MARKET_PASSWORD_REPOSITORY: {
      ...secondApple.repo,
      findPasswordCredential: env.repo.findPasswordCredential.bind(env.repo),
    },
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'username_unavailable' });
  assert.equal(env.repo.passwordCredentials.values().next().value.userId, originalUserId);
});

test('a normalized username can register only one account', async () => {
  const env = createAccountEnv();
  const first = await handleMarketPasswordAuth(passwordRequest(
    '/markets/auth/password/register',
  ), env);
  const duplicate = await handleMarketPasswordAuth(passwordRequest(
    '/markets/auth/password/register',
    { username: 'Pilot-User' },
  ), env);

  assert.equal(first.status, 201);
  assert.equal(duplicate.status, 409);
  assert.deepEqual(await duplicate.json(), { error: 'username_unavailable' });
  assert.equal(env.repo.users.size, 1);
  assert.equal(env.repo.passwordCredentials.size, 1);
});

test('five invalid password attempts temporarily lock the login key', async () => {
  const env = createAccountEnv();
  await handleMarketPasswordAuth(passwordRequest('/markets/auth/password/register'), env);

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await handleMarketPasswordAuth(passwordRequest(
      '/markets/auth/password/login',
      { password: 'incorrect-pass-99' },
    ), env);
    assert.equal(response.status, 401);
  }
  const locked = await handleMarketPasswordAuth(passwordRequest(
    '/markets/auth/password/login',
  ), env);

  assert.equal(locked.status, 429);
  assert.deepEqual(await locked.json(), { error: 'login_temporarily_locked' });
});

test('invalid usernames and weak passwords are rejected before persistence', async () => {
  for (const overrides of [
    { username: 'bad name' },
    { password: 'short' },
    { password: 'abc1234' },
    { password: 'long-but-no-number' },
  ]) {
    const env = createAccountEnv();
    const response = await handleMarketPasswordAuth(passwordRequest(
      '/markets/auth/password/register',
      overrides,
    ), env);
    assert.equal(response.status, 422);
    assert.equal(env.repo.users.size, 0);
  }
});

test('a password-only account can delete itself and all linked credentials', async () => {
  const env = createAccountEnv();
  const registration = await handleMarketPasswordAuth(passwordRequest(
    '/markets/auth/password/register',
  ), env);
  const { sessionToken } = await registration.json();

  const response = await handleMarketAccount(new Request(
    'https://unit.test/markets/account',
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${sessionToken}` },
    },
  ), env);

  assert.equal(response.status, 204);
  assert.equal(env.repo.users.size, 0);
  assert.equal(env.repo.passwordCredentials.size, 0);
  assert.equal(env.repo.sessions.size, 0);
});

function passwordRequest(path, overrides = {}, sessionToken) {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.4' };
  if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
  return new Request(`https://unit.test${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      username: 'pilot-user',
      password: PASSWORD,
      installationId: 'direct-mac-001',
      platform: 'macos',
      ...overrides,
    }),
  });
}
