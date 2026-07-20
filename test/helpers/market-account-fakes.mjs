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

function compareBinary(left, right) {
  return left < right ? -1 : (left > right ? 1 : 0);
}

export function createAccountEnv(options = {}) {
  let now = options.now ?? DEFAULT_NOW;
  let encryptedCredentialPayload = null;
  let encryptedCredentialKeyVersion = null;
  const operationLog = [];
  const apple = { revocationAttempts: [], revokedTokens: [] };
  const repo = createAccountRepository(operationLog);
  const env = {
    NOW: () => now,
    APPLE_CLIENT_IDS: 'com.lynncat.ios,com.lynncat.macos,com.lynncat.watchos',
    APPLE_SUBJECT_HASH_SALT: 'subject-salt',
    INSTALLATION_HASH_SALT: 'installation-salt',
    SESSION_HASH_SALT: 'session-salt',
    RANDOM_BYTES: deterministicBytes(),
    MARKET_AUTH_REPOSITORY: repo,
    MARKET_ACCOUNT_REPOSITORY: repo,
    repo,
    apple,
    operationLog,
    VERIFY_APPLE_IDENTITY_TOKEN: async (_token, nonce) => ({
      iss: 'https://appleid.apple.com',
      aud: options.appleClientId ?? 'com.lynncat.ios',
      exp: Math.floor(now / 1000) + 300,
      nonce,
      sub: options.appleSubject ?? 'apple-user-1',
    }),
    EXCHANGE_APPLE_AUTHORIZATION_CODE: async () => ({
      refresh_token: 'raw-refresh-token',
      id_token: 'exchanged-id-token',
    }),
    ENCRYPT_REFRESH_TOKEN: async (value, encryptionEnv) => {
      encryptedCredentialPayload = value;
      encryptedCredentialKeyVersion = Number(encryptionEnv.APPLE_TOKEN_KEY_VERSION ?? 1);
      return 'sealed-refresh-token';
    },
    DECRYPT_APPLE_CREDENTIAL: async (value, tokenKeyVersion) => {
      if (value !== 'sealed-refresh-token'
        || !encryptedCredentialPayload
        || tokenKeyVersion !== encryptedCredentialKeyVersion) {
        throw new Error('unreadable credential');
      }
      return JSON.parse(encryptedCredentialPayload);
    },
    REVOKE_APPLE_REFRESH_TOKEN: async (refreshToken, clientId) => {
      apple.revocationAttempts.push({ refreshToken, clientId });
      operationLog.push('apple-revocation');
      if (options.revocationFails) throw new Error('Apple unavailable');
      apple.revokedTokens.push({ refreshToken, clientId });
    },
  };

  Object.defineProperty(env, 'encryptedCredentialPayload', {
    get: () => encryptedCredentialPayload,
  });

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

export function authenticatedRequest(path, token, { method = 'GET', body } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return new Request(`https://unit.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function authenticatedPostMessage({
  roomId, text, requestKey, token = 'message-session-token', nickname, clientId,
} = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (requestKey !== undefined) headers['Idempotency-Key'] = requestKey;
  return new Request('https://unit.test/markets/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify({ roomId, text, nickname, clientId }),
  });
}

export function createMessageAccountEnv(options = {}) {
  const env = createAccountEnv({ now: options.now });
  env.MARKET_POINTS_MODE = options.mode ?? 'required';
  env.AUTHOR_HASH_SALT = 'hash-salt';
  env.AUTHOR_KEY_SECRET = 'key-secret';
  env.addAccount = ({
    userId = 'message-user', deviceId = 'message-device', token = 'message-session-token',
    points = 0, nickname = 'Lynncat 1234', sessionState = 'active',
  } = {}) => {
    const user = {
      id: userId,
      publicId: `public-${userId}`,
      nickname,
      pointsBalance: points,
      pointsEarnedTotal: points,
      balanceChangedAt: env.NOW(),
      leaderboardVisible: true,
      status: 'active',
      createdAt: env.NOW(),
      updatedAt: env.NOW(),
    };
    const device = {
      id: deviceId,
      userId,
      platform: 'ios',
      revokedAt: null,
    };
    const session = {
      id: `session-${userId}`,
      userId,
      deviceId,
      tokenHash: digest(env.SESSION_HASH_SALT, token),
      expiresAt: sessionState === 'expired' ? env.NOW() - 1 : env.NOW() + (24 * 60 * 60 * 1000),
      revokedAt: sessionState === 'revoked' ? env.NOW() - 1 : null,
      lastUsedAt: env.NOW(),
    };
    env.repo.users.set(userId, user);
    env.repo.devices.set(deviceId, device);
    env.repo.sessions.set(session.tokenHash, session);
    return { userId, deviceId, token };
  };
  env.defaultAccount = env.addAccount({
    points: options.points ?? 0,
    nickname: options.nickname,
    sessionState: options.sessionState,
  });
  env.DB = createMessageD1(env.repo);

  if (options.existingMessage) {
    env.repo.messages.set('existing-message', {
      id: 'existing-message',
      roomId: 'XAU',
      nickname: env.repo.user.nickname,
      text: '已有观点',
      authorHash: null,
      authorKey: null,
      status: 'active',
      createdAt: env.NOW() - 1_000,
      expiresAt: env.NOW() + 60_000,
      userId: env.repo.user.id,
      pointLedgerId: 'existing-ledger',
      requestKey: 'existing-request',
    });
  }
  if (options.banned) env.DB.banUser(env.repo.user.id);
  return env;
}

export function visibleUsers(count, options = {}) {
  return Array.from({ length: count }, (_, index) => ({
    id: `rank-user-${String(index + 1).padStart(3, '0')}`,
    publicId: `rank-public-${String(index + 1).padStart(3, '0')}`,
    appleSubjectHash: `rank-subject-${index + 1}`,
    nickname: `Rank ${index + 1}`,
    pointsBalance: (options.highestPoints ?? count) - index,
    pointsEarnedTotal: (options.highestPoints ?? count) - index,
    leaderboardVisible: true,
    balanceChangedAt: (options.balanceChangedAt ?? DEFAULT_NOW) + index,
    status: 'active',
    createdAt: DEFAULT_NOW,
    updatedAt: DEFAULT_NOW,
  }));
}

function createAccountRepository(operationLog) {
  const users = new Map();
  const credentials = new Map();
  const devices = new Map();
  const sessions = new Map();
  const leases = new Map();
  const ledger = new Map();
  const messages = new Map();
  const reports = new Map();
  let nextHeartbeatConflict = null;

  return {
    users,
    credentials,
    devices,
    sessions,
    leases,
    ledger,
    messages,
    reports,

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

    async loadAccount(userId) {
      return users.get(userId) ?? null;
    },

    async updateProfile(userId, updates, updatedAt) {
      const user = users.get(userId);
      if (!user) return null;
      Object.assign(user, updates, { updatedAt });
      return user;
    },

    async loadLeaderboard(currentPublicId) {
      const ranked = [...users.values()]
        .filter((user) => user.status === 'active' && user.leaderboardVisible)
        .sort((left, right) => (
          right.pointsBalance - left.pointsBalance
          || left.balanceChangedAt - right.balanceChangedAt
          || compareBinary(left.id, right.id)
        ))
        .map((user, index) => ({ ...user, rank: index + 1 }));
      return ranked.filter((user) => user.rank <= 100 || user.publicId === currentPublicId);
    },

    async loadPointLedger(userId, { beforeCreatedAt, beforeId, limit }) {
      return [...ledger.values()]
        .filter((entry) => entry.userId === userId)
        .filter((entry) => beforeCreatedAt == null
          || entry.createdAt < beforeCreatedAt
          || (entry.createdAt === beforeCreatedAt && entry.id < beforeId))
        .sort((left, right) => (
          right.createdAt - left.createdAt || compareBinary(right.id, left.id)
        ))
        .slice(0, limit);
    },

    async revokeSession(userId, sessionId, revokedAt) {
      const session = [...sessions.values()].find((candidate) => (
        candidate.id === sessionId && candidate.userId === userId
      ));
      if (session) session.revokedAt = revokedAt;
    },

    async findAppleCredential(userId) {
      return credentials.get(userId) ?? null;
    },

    async deleteAccountData(userId, expectedCredential) {
      const currentCredential = credentials.get(userId);
      if (!currentCredential
        || currentCredential.encryptedRefreshToken !== expectedCredential.encryptedRefreshToken
        || currentCredential.tokenKeyVersion !== expectedCredential.tokenKeyVersion) {
        operationLog.push('account-delete-guard-miss');
        return false;
      }
      const user = users.get(userId);
      if (!user || user.status !== 'active') {
        operationLog.push('account-delete-guard-miss');
        return false;
      }
      operationLog.push('account-delete-batch');
      user.status = 'deleted';
      const activeMessageIds = new Set(
        [...messages.values()]
          .filter((message) => message.userId === userId && message.status === 'active')
          .map((message) => message.id),
      );
      for (const [id, report] of reports) {
        if (activeMessageIds.has(report.messageId)) reports.delete(id);
      }
      for (const id of activeMessageIds) messages.delete(id);
      for (const [key, session] of sessions) {
        if (session.userId === userId) sessions.delete(key);
      }
      for (const [key, lease] of leases) {
        if (lease.userId === userId) leases.delete(key);
      }
      for (const [key, entry] of ledger) {
        if (entry.userId === userId) ledger.delete(key);
      }
      for (const [key, device] of devices) {
        if (device.userId === userId) devices.delete(key);
      }
      credentials.delete(userId);
      users.delete(userId);
      return true;
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

function createMessageD1(repo) {
  const bannedAuthors = new Map();
  let batchQueue = Promise.resolve();
  const db = {
    publishBatches: [],
    bannedAuthors,
    actions: [],
    failNextPublishBatchAt: null,
    banUser(userId) {
      const authorHash = digest('hash-salt', userId);
      bannedAuthors.set(authorHash, { author_hash: authorHash });
    },
    banGuest(clientId) {
      const authorHash = digest('hash-salt', clientId);
      bannedAuthors.set(authorHash, { author_hash: authorHash });
    },
    batch(statements) {
      const operation = batchQueue.then(async () => {
        const kinds = statements.map((statement) => statement.kind);
        const isPublishBatch = kinds.includes('message_insert');
        if (isPublishBatch) db.publishBatches.push(kinds);
        const snapshots = snapshotRepository(repo);
        const failureKind = isPublishBatch ? db.failNextPublishBatchAt : null;
        if (isPublishBatch) db.failNextPublishBatchAt = null;
        try {
          const results = [];
          for (const statement of statements) {
            if (statement.kind === failureKind) throw new Error(`Injected ${failureKind} failure`);
            results.push(await statement.run());
          }
          return results;
        } catch (error) {
          restoreRepository(repo, snapshots);
          throw error;
        }
      });
      batchQueue = operation.catch(() => {});
      return operation;
    },
    prepare(sql) {
      return {
        bind(...values) {
          const kind = statementKind(sql);
          return {
            kind,
            async run() {
              if (/^\s*DELETE\s+FROM\s+market_messages/i.test(sql)) {
                const [now] = values;
                for (const [id, message] of repo.messages) {
                  if (Number(message.expiresAt) <= now) repo.messages.delete(id);
                }
                return changed(0);
              }
              if (/^\s*DELETE\s+FROM\s+market_banned_authors/i.test(sql)) {
                const removed = bannedAuthors.delete(values[0]);
                return changed(removed ? 1 : 0);
              }
              if (/^\s*INSERT\s+INTO\s+market_banned_authors/i.test(sql)) {
                const [authorHash, bannedAt, note] = values;
                bannedAuthors.set(authorHash, { author_hash: authorHash, banned_at: bannedAt, note });
                return changed(1);
              }
              if (/^\s*INSERT\s+INTO\s+market_moderation_actions/i.test(sql)) {
                const [id, targetType, targetId, action, note, createdAt] = values;
                db.actions.push({ id, targetType, targetId, action, note, createdAt });
                return changed(1);
              }
              if (/^\s*INSERT\s+INTO\s+market_messages/i.test(sql)) {
                if (!/user_id/i.test(sql)) {
                  const [
                    id, roomId, nickname, text, authorHash, authorKey, createdAt, expiresAt,
                    cooldownAuthorHash, cooldownRoomId, cooldownCutoff,
                  ] = values;
                  const coolingDown = [...repo.messages.values()].some((message) => (
                    message.authorHash === cooldownAuthorHash && message.roomId === cooldownRoomId
                    && message.createdAt > cooldownCutoff
                  ));
                  if (coolingDown) return changed(0);
                  repo.messages.set(id, {
                    id, roomId, nickname, text, authorHash, authorKey, status: 'active',
                    createdAt, expiresAt, userId: null, pointLedgerId: null, requestKey: null,
                  });
                  return changed(1);
                }
                const [
                  id, roomId, nickname, text, authorHash, authorKey, createdAt, expiresAt,
                  userId, pointLedgerId, requestKey,
                ] = values;
                const user = repo.users.get(userId);
                const duplicate = repo.ledger.has(requestKey)
                  || [...repo.messages.values()].some((message) => message.requestKey === requestKey);
                const coolingDown = [...repo.messages.values()].some((message) => (
                  message.userId === userId && message.roomId === roomId
                  && message.createdAt > createdAt - (3 * 60 * 1000)
                ));
                if (!user || user.status !== 'active' || user.pointsBalance < 3
                  || duplicate || coolingDown || bannedAuthors.has(authorHash)) return changed(0);
                repo.messages.set(id, {
                  id, roomId, nickname, text, authorHash, authorKey, status: 'active',
                  createdAt, expiresAt, userId, pointLedgerId, requestKey,
                });
                return changed(1);
              }
              if (/^\s*INSERT\s+INTO\s+market_point_ledger/i.test(sql)) {
                const [ledgerId, userId, deviceId, messageId, requestKey, createdAt] = values;
                const user = repo.users.get(userId);
                const message = repo.messages.get(messageId);
                if (!user || user.status !== 'active' || user.pointsBalance < 3
                  || repo.ledger.has(requestKey) || !message
                  || message.userId !== userId || message.pointLedgerId !== ledgerId
                  || message.requestKey !== requestKey) return changed(0);
                repo.ledger.set(requestKey, {
                  id: ledgerId,
                  userId,
                  deviceId,
                  kind: 'message_debit',
                  amount: -3,
                  balanceAfter: user.pointsBalance - 3,
                  referenceType: 'message',
                  referenceId: messageId,
                  idempotencyKey: requestKey,
                  createdAt,
                });
                return changed(1);
              }
              if (/^\s*UPDATE\s+market_users/i.test(sql)) {
                const [balanceChangedAt, updatedAt, userId, ledgerId] = values;
                const user = repo.users.get(userId);
                const ledger = [...repo.ledger.values()].find((entry) => (
                  entry.id === ledgerId && entry.userId === userId
                ));
                if (!user || !ledger || user.pointsBalance < 3) return changed(0);
                user.pointsBalance -= 3;
                user.balanceChangedAt = balanceChangedAt;
                user.updatedAt = updatedAt;
                return changed(1);
              }
              throw new Error(`Unsupported message fake write: ${sql}`);
            },
            async first() {
              if (/FROM\s+market_banned_authors/i.test(sql)) {
                return bannedAuthors.get(values[0]) ?? null;
              }
              if (/FROM\s+market_messages/i.test(sql) && /request_key\s*=\s*\?/i.test(sql)) {
                const [requestKey, userId, now] = values;
                const message = [...repo.messages.values()].find((candidate) => (
                  candidate.requestKey === requestKey && candidate.userId === userId
                  && (now === undefined || candidate.expiresAt > now)
                ));
                return message ? messageRow(message) : null;
              }
              if (/FROM\s+market_point_ledger/i.test(sql) && /idempotency_key\s*=\s*\?/i.test(sql)) {
                const [requestKey, userId] = values;
                const ledger = repo.ledger.get(requestKey);
                return ledger?.userId === userId && ledger.kind === 'message_debit'
                  && ledger.referenceType === 'message' ? { 1: 1 } : null;
              }
              if (/FROM\s+market_users/i.test(sql) && /points_balance/i.test(sql)) {
                const user = repo.users.get(values[0]);
                return user ? { points_balance: user.pointsBalance, status: user.status } : null;
              }
              if (/FROM\s+market_point_ledger/i.test(sql) && /balance_after/i.test(sql)) {
                const [ledgerId, userId] = values;
                const ledger = [...repo.ledger.values()].find((entry) => (
                  entry.id === ledgerId && entry.userId === userId
                ));
                return ledger ? { balance_after: ledger.balanceAfter } : null;
              }
              if (/FROM\s+market_messages/i.test(sql) && /created_at/i.test(sql)) {
                const [identity, roomId] = values;
                const usesGuestIdentity = /author_hash\s*=\s*\?/i.test(sql);
                const message = [...repo.messages.values()]
                  .filter((candidate) => (
                    (usesGuestIdentity ? candidate.authorHash === identity : candidate.userId === identity)
                    && candidate.roomId === roomId
                  ))
                  .sort((left, right) => right.createdAt - left.createdAt)[0];
                return message ? { created_at: message.createdAt } : null;
              }
              return null;
            },
            async all() {
              if (/SELECT\s+DISTINCT\s+author_hash\s+FROM\s+market_messages/i.test(sql)) {
                const hashes = new Set(
                  [...repo.messages.values()]
                    .filter((message) => message.authorKey === values[0])
                    .map((message) => message.authorHash),
                );
                return { results: [...hashes].filter(Boolean).map((author_hash) => ({ author_hash })) };
              }
              if (/FROM\s+market_messages/i.test(sql) && /room_id\s*=\s*\?/i.test(sql)) {
                const [roomId, status, now] = values;
                return {
                  results: [...repo.messages.values()]
                    .filter((message) => (
                      message.roomId === roomId && message.status === status && message.expiresAt > now
                    ))
                    .sort((left, right) => right.createdAt - left.createdAt)
                    .slice(0, 50)
                    .map(messageRow),
                };
              }
              return { results: [] };
            },
          };
        },
      };
    },
  };
  return db;
}

function statementKind(sql) {
  if (/^\s*INSERT\s+INTO\s+market_messages/i.test(sql)) return 'message_insert';
  if (/^\s*INSERT\s+INTO\s+market_point_ledger/i.test(sql)) return 'ledger_insert';
  if (/^\s*UPDATE\s+market_users/i.test(sql)) return 'balance_update';
  if (/^\s*INSERT\s+INTO\s+market_banned_authors/i.test(sql)) return 'author_ban';
  if (/^\s*INSERT\s+INTO\s+market_moderation_actions/i.test(sql)) return 'moderation_action';
  return 'other';
}

function snapshotRepository(repo) {
  return {
    users: cloneMap(repo.users),
    messages: cloneMap(repo.messages),
    ledger: cloneMap(repo.ledger),
  };
}

function restoreRepository(repo, snapshots) {
  restoreMap(repo.users, snapshots.users);
  restoreMap(repo.messages, snapshots.messages);
  restoreMap(repo.ledger, snapshots.ledger);
}

function cloneMap(source) {
  return new Map([...source].map(([key, value]) => [key, { ...value }]));
}

function restoreMap(target, snapshot) {
  target.clear();
  for (const [key, value] of snapshot) target.set(key, value);
}

function messageRow(message) {
  return {
    id: message.id,
    room_id: message.roomId,
    nickname: message.nickname,
    text: message.text,
    author_hash: message.authorHash,
    author_key: message.authorKey,
    status: message.status,
    created_at: message.createdAt,
    expires_at: message.expiresAt,
    user_id: message.userId,
    point_ledger_id: message.pointLedgerId,
    request_key: message.requestKey,
  };
}

function changed(changes) {
  return { success: true, meta: { changes } };
}
