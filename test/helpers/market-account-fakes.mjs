import { createHash } from 'node:crypto';

const DEFAULT_NOW = 1_700_000_000_000;

function digest(salt, value) {
  return createHash('sha256').update(`${salt}:${value}`).digest('hex');
}

function deterministicBytes() {
  let seed = 0;
  return (length) => {
    seed += 1;
    return new Uint8Array(length).fill(seed);
  };
}

export function createAccountEnv(options = {}) {
  let now = options.now ?? DEFAULT_NOW;
  const repo = createAccountRepository();
  const env = {
    NOW: () => now,
    APPLE_CLIENT_IDS: 'com.lynncat.ios,com.lynncat.macos,com.lynncat.watchos',
    APPLE_SUBJECT_HASH_SALT: 'subject-salt',
    INSTALLATION_HASH_SALT: 'installation-salt',
    SESSION_HASH_SALT: 'session-salt',
    RANDOM_BYTES: deterministicBytes(),
    MARKET_AUTH_REPOSITORY: repo,
    repo,
    VERIFY_APPLE_IDENTITY_TOKEN: async (_token, nonce) => ({
      iss: 'https://appleid.apple.com',
      aud: 'com.lynncat.ios',
      exp: Math.floor(now / 1000) + 300,
      nonce,
      sub: options.appleSubject ?? 'apple-user-1',
    }),
    EXCHANGE_APPLE_AUTHORIZATION_CODE: async () => ({
      refresh_token: 'raw-refresh-token',
      id_token: 'exchanged-id-token',
    }),
    ENCRYPT_REFRESH_TOKEN: async () => 'sealed-refresh-token',
  };

  env.advance = (milliseconds) => {
    now += milliseconds;
  };

  if (options.sessionExpired || options.sessionRevoked) {
    const user = {
      id: 'user-existing', publicId: 'public-existing', nickname: 'Lynncat 1234',
      pointsBalance: 7, pointsEarnedTotal: 7, leaderboardVisible: true, status: 'active',
    };
    const device = { id: 'device-existing', userId: user.id, platform: 'ios' };
    const session = {
      id: 'session-existing', userId: user.id, deviceId: device.id,
      tokenHash: digest(env.SESSION_HASH_SALT, options.sessionToken ?? 'expired-token'),
      expiresAt: options.sessionExpired ? now - 1 : now + 60_000,
      revokedAt: options.sessionRevoked ? now - 1 : null,
      lastUsedAt: now - 10_000,
    };
    repo.users.set(user.id, user);
    repo.devices.set(device.id, device);
    repo.sessions.set(session.tokenHash, session);
  }

  return env;
}

export function appleCredentialRequest(platform = 'ios', installationId = 'ios-install') {
  return new Request('https://unit.test/markets/auth/apple', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identityToken: 'identity-token',
      authorizationCode: 'authorization-code',
      nonce: 'nonce-12345678',
      installationId,
      platform,
    }),
  });
}

export function bearerRequest(token) {
  return new Request('https://unit.test/markets/account', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

function createAccountRepository() {
  const users = new Map();
  const credentials = new Map();
  const devices = new Map();
  const sessions = new Map();
  const leases = new Map();
  const ledger = new Map();
  let nextHeartbeatConflict = null;

  return {
    users,
    credentials,
    devices,
    sessions,
    leases,
    ledger,

    set nextHeartbeatConflict(value) {
      nextHeartbeatConflict = value;
    },

    get user() {
      return users.values().next().value;
    },

    async findUserByAppleSubjectHash(appleSubjectHash) {
      return [...users.values()].find((user) => user.appleSubjectHash === appleSubjectHash) ?? null;
    },

    async createUser(user) {
      users.set(user.id, { ...user });
      return users.get(user.id);
    },

    async saveAppleCredential(credential) {
      credentials.set(credential.userId, { ...credential });
    },

    async findDevice(userId, installationHash) {
      return [...devices.values()].find((device) => (
        device.userId === userId && device.installationHash === installationHash
      )) ?? null;
    },

    async saveDevice(device) {
      devices.set(device.id, { ...device });
      return devices.get(device.id);
    },

    async createSession(session) {
      sessions.set(session.tokenHash, { ...session });
      return sessions.get(session.tokenHash);
    },

    async findSessionByTokenHash(tokenHash) {
      const session = sessions.get(tokenHash);
      if (!session) return null;
      return {
        ...session,
        user: users.get(session.userId),
        device: devices.get(session.deviceId),
      };
    },

    async touchSession(sessionId, lastUsedAt) {
      const session = [...sessions.values()].find((candidate) => candidate.id === sessionId);
      if (session) session.lastUsedAt = lastUsedAt;
    },

    async loadPointState(userId, deviceId) {
      return {
        user: users.get(userId) ?? null,
        lease: leases.get(deviceId) ?? null,
      };
    },

    async commitHeartbeat({ userId, deviceId, expectedVersion, lease, credit, idempotencyKey, now }) {
      if (nextHeartbeatConflict) {
        leases.set(deviceId, { ...nextHeartbeatConflict });
        nextHeartbeatConflict = null;
        return { updated: false, credited: false };
      }
      const current = leases.get(deviceId);
      const currentVersion = current?.leaseVersion ?? 0;
      if (currentVersion !== expectedVersion) return { updated: false, credited: false };
      if (credit && ledger.has(idempotencyKey)) return { updated: false, credited: false };

      const nextLease = { ...lease, leaseVersion: expectedVersion + 1 };
      leases.set(deviceId, nextLease);
      if (!credit) return { updated: true, credited: false };

      const user = users.get(userId);
      const balanceAfter = user.pointsBalance + 1;
      ledger.set(idempotencyKey, {
        id: `ledger-${idempotencyKey}`,
        userId,
        deviceId,
        kind: 'online_credit',
        amount: 1,
        balanceAfter,
        idempotencyKey,
        createdAt: now,
      });
      user.pointsBalance = balanceAfter;
      user.pointsEarnedTotal += 1;
      user.balanceChangedAt = now;
      user.updatedAt = now;
      return { updated: true, credited: true };
    },

    async stopLease({ userId, deviceId, expectedVersion }) {
      const current = leases.get(deviceId);
      if (!current || current.userId !== userId || current.leaseVersion !== expectedVersion) {
        return { removed: false, lease: current ?? null };
      }
      leases.delete(deviceId);
      return { removed: true, lease: current };
    },
  };
}
