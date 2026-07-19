# Lynncat 账号、在线积分与排行榜 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Lynncat Markets 的 macOS、iOS 与 watchOS 客户端交付统一 Apple 登录、前台每分钟积分、3 分留言消费和按当前余额排序的全平台排行榜。

**Architecture:** 现有 Cloudflare Worker 与 D1 继续作为唯一服务端，在独立模块中实现 Apple 身份校验、会话、在线租约、积分流水、账户资料与排行榜，再把逐品种交流写入改成服务端原子扣分。三个客户端各自使用原生 AuthenticationServices、Keychain 和 SwiftUI 调用同一 API；游客读取路径保持可用。

**Tech Stack:** Cloudflare Workers、D1、Web Crypto、Node.js `node:test`、Swift 6、SwiftUI、AuthenticationServices、Security/Keychain、XCTest、Xcode 26。

## Global Constraints

- 登录固定使用 Apple；不增加邮箱验证码、密码、Firebase、Supabase 或邮件服务。
- 游客可查看行情、资讯和交流内容，但不能获得积分或发送交流内容。
- 只有前台可见、可交互状态计分；后台、锁屏、待机和熄屏不计分。
- 每个设备连续在线满 60 秒获得 1 分；不同设备可以叠加，同一设备不能重复加分。
- 断网不补发；服务端时间、余额和流水是唯一事实来源。
- 每条交流内容消耗 3 分，并保留同一用户、同一品种 3 分钟发送间隔。
- 排行榜是全平台总榜，按当前余额排序，默认参与但允许隐藏。
- Watch 完整支持独立登录、积分、昵称、发送、举报和屏蔽；主界面不增加留言滚动条，也不恢复价格提醒。
- 简体中文、繁体中文和英文必须覆盖新增界面及错误消息。
- 账号删除必须删除关联资料和交流内容、撤销全部会话并调用 Apple token revocation。
- Apple 姓名、邮箱、`sub`、会话令牌和设备摘要不得进入公开榜单或普通日志。
- Lynncat.com 当前未跟踪的 `dist/` 保持不动，不加入提交。
- Mac 工作区现有用户修改 `.superpowers/sdd/progress.md` 与 `AurumMac.xcodeproj/project.pbxproj` 必须保留。
- `/Users/laosuer/Xcode/60604gold/AurumGold 11` 当前不是 Git 仓库；未经授权不得初始化 Git，移动端任务以测试、构建和文件清单作为检查点。
- 每个任务先写失败测试并确认失败，再实现、运行目标测试和全量回归；异常使用 `superpowers:systematic-debugging`，完成声明前使用 `superpowers:verification-before-completion`。
- 远程 D1、Secrets、Apple Developer、部署和 App Store Connect 修改均在执行时单独请求授权，不在仓库写入真实私钥。

## Exact File Map

```text
/Users/laosuer/Lynncat.com/
├── migrations/0002_lynncat_accounts_points.sql
├── src/marketCrypto.js
├── src/marketAuth.js
├── src/marketPoints.js
├── src/marketAccount.js
├── src/messages.js                       # modify
├── src/worker.js                         # modify
├── src/community-schema.sql              # modify
├── test/helpers/market-account-fakes.mjs
├── test/fixtures/community-v1.sql
├── test/market-schema.test.mjs
├── test/market-crypto.test.mjs
├── test/market-auth.test.mjs
├── test/market-points.test.mjs
├── test/market-account.test.mjs
├── test/market-worker.test.mjs
└── docs/release/lynncat-points-apple-setup.md

/Users/laosuer/Xcode/60604gold/AurumMac 18/
├── AurumMac/LynncatAccountModels.swift
├── AurumMac/LynncatAccountAPI.swift
├── AurumMac/LynncatAccountStore.swift
├── AurumMac/LynncatAccountViews.swift
├── AurumMac/MacForegroundTracker.swift
├── AurumMac/MessageBoardView.swift        # modify
├── AurumMac/SettingsMacView.swift         # modify
├── AurumMac/AurumMacApp.swift             # modify
├── AurumMac/AurumMac.entitlements         # modify
├── AurumMacTests/LynncatAccountStoreTests.swift
└── AurumMacTests/MacForegroundTrackerTests.swift

/Users/laosuer/Xcode/60604gold/AurumGold 11/
├── AurumGold/LynncatAccountModels.swift
├── AurumGold/LynncatAccountAPI.swift
├── AurumGold/LynncatAccountStore.swift
├── AurumGold/LynncatAccountViews.swift
├── AurumGold/AurumGold.entitlements
├── AurumGold/AurumApp.swift               # modify
├── AurumGold/CommunityFeature.swift       # modify
├── AurumGold/SettingsView.swift           # modify
├── AurumGoldTests/LynncatAccountStoreTests.swift
├── AurumGoldWatch/WatchAccountModels.swift
├── AurumGoldWatch/WatchAccountAPI.swift
├── AurumGoldWatch/WatchAccountStore.swift
├── AurumGoldWatch/WatchAccountViews.swift
├── AurumGoldWatch/AurumGoldWatch.entitlements
├── AurumGoldWatch/AurumGoldWatchApp.swift # modify
├── AurumGoldWatch/WatchServices.swift     # modify
├── AurumGoldWatch/WatchViews.swift        # modify
└── AurumGoldWatchTests/WatchAccountStoreTests.swift
```

The Mac project file must explicitly add new sources while preserving current edits. The iOS/watchOS project uses synchronized groups, so only entitlement build settings require project-file edits.

---

### Task 1: Add the D1 account and point schema

**Files:**
- Create: `migrations/0002_lynncat_accounts_points.sql`
- Create: `test/market-schema.test.mjs`
- Create: `test/fixtures/community-v1.sql`
- Modify: `src/community-schema.sql`

**Interfaces:**
- Consumes: existing `market_messages`, reports and banned-author tables.
- Produces: user, Apple credential, device, session, lease and ledger tables; nullable message account/debit/idempotency columns.

- [ ] **Step 1: Write the failing schema contract test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('migration has all account and point constraints', async () => {
  const sql = await readFile(new URL('../migrations/0002_lynncat_accounts_points.sql', import.meta.url), 'utf8');
  for (const table of ['market_users', 'market_apple_credentials', 'market_user_devices',
    'market_user_sessions', 'market_online_leases', 'market_point_ledger']) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table}`));
  }
  assert.match(sql, /points_balance INTEGER NOT NULL DEFAULT 0 CHECK \(points_balance >= 0\)/);
  assert.match(sql, /UNIQUE\(user_id, installation_hash\)/);
  assert.match(sql, /idempotency_key TEXT NOT NULL UNIQUE/);
  assert.match(sql, /ALTER TABLE market_messages ADD COLUMN request_key TEXT/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test test/market-schema.test.mjs`

Expected: FAIL with `ENOENT` for the migration.

- [ ] **Step 3: Create the migration and canonical schema**

Before changing `src/community-schema.sql`, copy its current pre-account contents verbatim:

```bash
mkdir -p test/fixtures
cp src/community-schema.sql test/fixtures/community-v1.sql
```

The migration must define:

```sql
PRAGMA foreign_keys = ON;
CREATE TABLE market_users (
  id TEXT PRIMARY KEY, public_id TEXT NOT NULL UNIQUE, apple_subject_hash TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL, points_balance INTEGER NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
  points_earned_total INTEGER NOT NULL DEFAULT 0 CHECK (points_earned_total >= 0),
  leaderboard_visible INTEGER NOT NULL DEFAULT 1 CHECK (leaderboard_visible IN (0, 1)),
  balance_changed_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE TABLE market_apple_credentials (
  user_id TEXT PRIMARY KEY REFERENCES market_users(id) ON DELETE CASCADE,
  encrypted_refresh_token TEXT NOT NULL, token_key_version INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE market_user_devices (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES market_users(id) ON DELETE CASCADE,
  installation_hash TEXT NOT NULL, platform TEXT NOT NULL CHECK (platform IN ('macos','ios','watchos')),
  created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, revoked_at INTEGER,
  UNIQUE(user_id, installation_hash)
);
CREATE TABLE market_user_sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES market_users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES market_user_devices(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, revoked_at INTEGER
);
CREATE TABLE market_online_leases (
  device_id TEXT PRIMARY KEY REFERENCES market_user_devices(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES market_users(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL, last_heartbeat_at INTEGER NOT NULL,
  active_seconds INTEGER NOT NULL DEFAULT 0, lease_version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
CREATE TABLE market_point_ledger (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES market_users(id) ON DELETE CASCADE,
  device_id TEXT REFERENCES market_user_devices(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('online_credit','message_debit','admin_adjustment','reversal')),
  amount INTEGER NOT NULL CHECK (amount <> 0), balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  reference_type TEXT, reference_id TEXT, idempotency_key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
);
ALTER TABLE market_messages ADD COLUMN user_id TEXT;
ALTER TABLE market_messages ADD COLUMN point_ledger_id TEXT;
ALTER TABLE market_messages ADD COLUMN request_key TEXT;
CREATE UNIQUE INDEX idx_market_messages_request_key ON market_messages(request_key) WHERE request_key IS NOT NULL;
CREATE INDEX idx_market_users_leaderboard ON market_users(leaderboard_visible, points_balance DESC, balance_changed_at ASC);
```

Append equivalent `IF NOT EXISTS` table/index definitions to `src/community-schema.sql`; one-time `ALTER TABLE` statements remain only in the migration.

- [ ] **Step 4: Validate schema and regressions**

Run:

```bash
SCHEMA_TMP=$(mktemp -d)
sqlite3 "$SCHEMA_TMP/canonical.db" < src/community-schema.sql
sqlite3 "$SCHEMA_TMP/migrated.db" < test/fixtures/community-v1.sql
sqlite3 "$SCHEMA_TMP/migrated.db" < migrations/0002_lynncat_accounts_points.sql
node --test test/*.test.mjs
```

Expected: SQLite exits 0 and all Node tests pass.

- [ ] **Step 5: Commit**

```bash
git add migrations/0002_lynncat_accounts_points.sql src/community-schema.sql \
  test/fixtures/community-v1.sql test/market-schema.test.mjs
git commit -m "feat: add lynncat account and point schema"
```

---

### Task 2: Implement Apple verification and sessions

**Files:**
- Create: `src/marketCrypto.js`
- Create: `src/marketAuth.js`
- Create: `test/helpers/market-account-fakes.mjs`
- Create: `test/market-crypto.test.mjs`
- Create: `test/market-auth.test.mjs`

**Interfaces:**
- Produces: `verifyAppleIdentityToken`, `exchangeAppleAuthorizationCode`, `revokeAppleRefreshToken`, `encryptRefreshToken`, `authenticateMarketRequest`, `handleMarketAuth`.
- Principal: `{ userId, publicId, deviceId, sessionId, nickname, pointsBalance }`.

- [ ] **Step 1: Write failing tests**

```js
test('same Apple subject reuses one account on two platforms', async () => {
  const env = createAccountEnv({ appleSubject: 'apple-user-1' });
  const ios = await handleMarketAuth(appleCredentialRequest('ios', 'ios-install'), env);
  const mac = await handleMarketAuth(appleCredentialRequest('macos', 'mac-install'), env);
  assert.equal((await ios.clone().json()).account.id, (await mac.clone().json()).account.id);
  assert.equal(env.repo.users.size, 1);
  assert.equal(env.repo.devices.size, 2);
});

test('expired sessions fail closed', async () => {
  const env = createAccountEnv({ sessionExpired: true });
  await assert.rejects(authenticateMarketRequest(bearerRequest('expired-token'), env),
    (error) => error.code === 'session_expired');
});
```

The crypto test generates a P-256 key and rejects wrong signature, `iss`, `aud`, `exp`, nonce and `kid`.

- [ ] **Step 2: Run and verify missing modules**

Run: `node --test test/market-crypto.test.mjs test/market-auth.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement Web Crypto and sessions**

```js
export async function verifyAppleIdentityToken(token, expectedNonce, env) {
  const [head, body, signature] = String(token).split('.');
  const header = decodeJsonPart(head);
  const payload = decodeJsonPart(body);
  if (header.alg !== 'ES256' || payload.iss !== 'https://appleid.apple.com') throw marketError('invalid_apple_token', 401);
  if (!allowedAudiences(env).has(payload.aud) || Number(payload.exp) * 1000 <= nowFor(env)) throw marketError('invalid_apple_token', 401);
  if (payload.nonce !== expectedNonce) throw marketError('invalid_apple_token', 401);
  const key = await importAppleKey(header.kid, env);
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, key, joseSignatureToWebCrypto(signature),
    new TextEncoder().encode(`${head}.${body}`),
  );
  if (!valid) throw marketError('invalid_apple_token', 401);
  return payload;
}
```

Create Apple client-secret JWTs from `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` and allowed client ID. Encrypt refresh tokens with AES-GCM and `APPLE_TOKEN_ENCRYPTION_KEY`. `handleMarketAuth` validates platform, installation ID and nonce; creates/reuses account; stores encrypted refresh token; registers device; returns a random session token once. Bearer authentication hashes tokens with `SESSION_HASH_SALT` and rejects expired/revoked sessions.

- [ ] **Step 4: Run focused and full tests**

Run:

```bash
node --test test/market-crypto.test.mjs test/market-auth.test.mjs
node --test test/*.test.mjs
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/marketCrypto.js src/marketAuth.js test/helpers/market-account-fakes.mjs test/market-crypto.test.mjs test/market-auth.test.mjs
git commit -m "feat: add apple-backed lynncat sessions"
```

---

### Task 3: Implement foreground leases and online credits

**Files:**
- Create: `src/marketPoints.js`
- Create: `test/market-points.test.mjs`
- Modify: `test/helpers/market-account-fakes.mjs`

**Interfaces:**
- Produces: `handleMarketHeartbeat`, `handleMarketHeartbeatStop`.
- Response: `{ credited, pointsBalance, activeSeconds, leaseVersion, serverTime, nextCreditAt }`.

- [ ] **Step 1: Write failing tests**

```js
test('regular heartbeats credit exactly one point', async () => {
  const env = signedInEnv({ now: 1_000_000, points: 0 });
  await heartbeat(env, 'h1', 0);
  for (const [key, version] of [['h2', 1], ['h3', 2], ['h4', 3]]) {
    env.advance(20_000);
    await heartbeat(env, key, version);
  }
  assert.equal(env.repo.user.pointsBalance, 1);
  assert.equal(env.repo.ledger.size, 1);
});

test('stale and duplicate heartbeats never backfill', async () => {
  const env = signedInEnv({ now: 1_000_000, points: 0 });
  await heartbeat(env, 'same', 0);
  env.advance(90_000);
  const stale = await heartbeat(env, 'same', 1);
  assert.equal(stale.credited, false);
  assert.equal(stale.activeSeconds, 0);
  assert.equal(env.repo.user.pointsBalance, 0);
});
```

Also test two devices credit independently and stop clears only its device.

- [ ] **Step 2: Run and verify missing handler**

Run: `node --test test/market-points.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement optimistic leases**

```js
export const HEARTBEAT_MIN_GAP_MS = 15_000;
export const HEARTBEAT_STALE_MS = 45_000;
export const CREDIT_SECONDS = 60;

export function nextLeaseState(lease, now) {
  if (!lease || now - lease.lastHeartbeatAt > HEARTBEAT_STALE_MS) {
    return { activeSeconds: 0, credited: false, reset: true };
  }
  const elapsed = now - lease.lastHeartbeatAt;
  if (elapsed < HEARTBEAT_MIN_GAP_MS) return { activeSeconds: lease.activeSeconds, credited: false, reset: false };
  const total = lease.activeSeconds + Math.min(30, Math.floor(elapsed / 1000));
  return { activeSeconds: total >= CREDIT_SECONDS ? total - CREDIT_SECONDS : total, credited: total >= CREDIT_SECONDS, reset: false };
}
```

For credits, one D1 batch performs optimistic lease update by version, inserts one unique `online_credit` ledger row, then increments balance/earned total only when that ledger exists. One request credits at most 1 point; conflicts return fresh server state.

- [ ] **Step 4: Run point and full tests**

Run:

```bash
node --test test/market-points.test.mjs
node --test test/*.test.mjs
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/marketPoints.js test/market-points.test.mjs test/helpers/market-account-fakes.mjs
git commit -m "feat: credit lynncat points for foreground leases"
```

---

### Task 4: Add profile, ledger, deletion and leaderboard

**Files:**
- Create: `src/marketAccount.js`
- Create: `test/market-account.test.mjs`
- Modify: `src/marketAuth.js`
- Modify: `test/helpers/market-account-fakes.mjs`

**Interfaces:**
- Produces: `handleMarketAccount`, `handleMarketProfile`, `handleMarketLeaderboard`, `handlePointLedger`, `handleLogout`, `handleDeleteMarketAccount`.
- Public entry: `{ rank, publicId, nickname, pointsBalance, isCurrentUser }`.

- [ ] **Step 1: Write failing tests**

```js
test('leaderboard returns top 100 and self outside top 100', async () => {
  const env = leaderboardEnv(visibleUsers(105));
  const body = await json(await handleMarketLeaderboard(authenticatedGet('/markets/leaderboard'), env));
  assert.equal(body.entries.length, 100);
  assert.equal(body.me.rank, 106);
});

test('hidden user disappears and deletion revokes every session', async () => {
  const env = signedInEnv({ points: 42 });
  await handleMarketProfile(authenticatedPut('/markets/account/profile', { nickname: 'Lynn', leaderboardVisible: false }), env);
  assert.equal((await leaderboardBody(env)).entries.length, 0);
  assert.equal((await handleDeleteMarketAccount(authenticatedDelete('/markets/account'), env)).status, 204);
  assert.equal(env.repo.sessions.size, 0);
  assert.equal(env.apple.revokedTokens.length, 1);
});
```

- [ ] **Step 2: Run and verify missing module**

Run: `node --test test/market-account.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement mapping and ranking**

```js
export function toPublicAccount(row) {
  return {
    id: row.public_id, nickname: row.nickname,
    pointsBalance: Number(row.points_balance),
    pointsEarnedTotal: Number(row.points_earned_total),
    leaderboardVisible: Boolean(row.leaderboard_visible),
  };
}
```

Nickname is 1–14 normalized characters and reuses message safety classification. Default is stable `Lynncat 4821`-style output derived by HMAC, never Apple name/email. Rank with:

```sql
WITH ranked AS (
 SELECT public_id, nickname, points_balance,
 ROW_NUMBER() OVER (ORDER BY points_balance DESC, balance_changed_at ASC, id ASC) AS rank
 FROM market_users WHERE status='active' AND leaderboard_visible=1
)
SELECT * FROM ranked WHERE rank <= 100 OR public_id = ? ORDER BY rank ASC
```

Deletion first revokes encrypted Apple refresh token, then removes active messages, related reports, sessions, leases, ledger, devices, credentials and user in one batch. Revocation failure returns `account_deletion_retry` without partial deletion.

- [ ] **Step 4: Run focused and full tests**

Run:

```bash
node --test test/market-account.test.mjs
node --test test/*.test.mjs
```

Expected: profile, ranking, hiding, ledger, logout and deletion pass.

- [ ] **Step 5: Commit**

```bash
git add src/marketAccount.js src/marketAuth.js test/market-account.test.mjs test/helpers/market-account-fakes.mjs
git commit -m "feat: add lynncat profiles and leaderboard"
```

---

### Task 5: Require points for publishing messages

**Files:**
- Modify: `src/messages.js`
- Modify: `test/messages.test.mjs`
- Modify: `test/helpers/market-account-fakes.mjs`

**Interfaces:**
- Consumes: authenticated principal and `Idempotency-Key`.
- Produces: POST `{ message, remainingCooldown, pointsBalance }`; stable errors `login_required`, `insufficient_points`, `cooldown`, plus existing moderation errors.

- [ ] **Step 1: Replace guest-post expectations with failing debit tests**

```js
test('authenticated POST debits three points and publishes once', async () => {
  const env = createMessageAccountEnv({ points: 3 });
  const request = authenticatedPostMessage({ roomId: 'XAU', text: '关注实际利率', requestKey: 'publish-1' });
  const first = await handleMessages(request, env);
  const duplicate = await handleMessages(request, env);
  assert.equal(first.status, 201);
  assert.equal(duplicate.status, 200);
  assert.equal((await first.clone().json()).pointsBalance, 0);
  assert.equal(env.repo.messages.size, 1);
  assert.equal(env.repo.ledger.size, 1);
});

test('moderation, cooldown and insufficient balance never debit', async () => {
  for (const scenario of ['objectionable', 'cooldown', 'insufficient']) {
    const env = createMessageAccountEnv({ points: scenario === 'insufficient' ? 2 : 10, scenario });
    const response = await handleMessages(authenticatedPostMessage({
      roomId: 'XAU', text: scenario === 'objectionable' ? '加我微信' : '正常观点', requestKey: scenario,
    }), env);
    assert.equal(response.status >= 400, true);
    assert.equal(env.repo.ledger.size, 0);
  }
});
```

Keep public GET, report, block, auto-hide, ban, room isolation and one-hour expiry tests.

- [ ] **Step 2: Run and confirm current anonymous behavior fails**

Run: `node --test test/messages.test.mjs`

Expected: FAIL because POST still trusts `clientId` and does not debit.

- [ ] **Step 3: Implement authenticated idempotent debit**

```js
const principal = await authenticateMarketRequest(request, env);
const requestKey = cleanIdempotencyKey(request.headers.get('Idempotency-Key'));
if (!requestKey) return json({ error: 'missing_idempotency_key' }, 400);
return publishWithPoints({ env, principal, room, text, requestKey, now });
```

One D1 batch:

1. Inserts message via `SELECT` from `market_users` only when balance is at least 3, room cooldown is empty and request key is new.
2. Inserts one `message_debit` ledger row selected from that message with `balance_after = points_balance - 3`.
3. Updates user balance only when the ledger row exists.

For zero changes, query existing request key first (return 200), then balance (422), cooldown (429), then generic conflict. Derive author keys from stable `userId` and server secrets; ignore body nickname/client ID.

- [ ] **Step 4: Run message and full tests**

Run:

```bash
node --test test/messages.test.mjs
node --test test/*.test.mjs
```

Expected: safety and debit tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/messages.js test/messages.test.mjs test/helpers/market-account-fakes.mjs
git commit -m "feat: charge lynncat points for market posts"
```

---

### Task 6: Wire routes and safe rollout mode

**Files:**
- Modify: `src/worker.js`
- Modify: `wrangler.toml`
- Create: `test/market-worker.test.mjs`
- Create: `docs/release/lynncat-points-apple-setup.md`

**Interfaces:**
- Produces public account/point routes and `disabled`, `optional`, `required` rollout modes.

- [ ] **Step 1: Write failing route/cache tests**

```js
test('account and point routes are registered', async () => {
  const env = workerAccountEnv();
  for (const [method, path] of [
    ['POST', '/markets/auth/apple'], ['GET', '/markets/account'],
    ['POST', '/markets/points/heartbeat'], ['POST', '/markets/points/heartbeat/stop'],
    ['GET', '/markets/points/ledger'], ['GET', '/markets/leaderboard'],
  ]) {
    const response = await marketWorker.fetch(accountRequest(method, path), env, {});
    assert.notEqual(response.status, 404, `${method} ${path}`);
  }
});

test('private account responses are no-store and omit private fields', async () => {
  const response = await marketWorker.fetch(accountRequest('GET', '/markets/account'), workerAccountEnv(), {});
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.doesNotMatch(await response.text(), /token_hash|apple_subject|installation_hash/);
});
```

- [ ] **Step 2: Run and verify 404 failures**

Run: `node --test test/market-worker.test.mjs`

Expected: FAIL because routes are absent.

- [ ] **Step 3: Dispatch routes and document rollout**

Register account routes before static assets. OPTIONS allows `Authorization`, `Content-Type`, `Idempotency-Key`.

```js
export function marketPointsMode(env) {
  return new Set(['disabled', 'optional', 'required']).has(env.MARKET_POINTS_MODE)
    ? env.MARKET_POINTS_MODE
    : 'disabled';
}
```

- `disabled`: account endpoints return 503 and anonymous posting stays unchanged.
- `optional`: account/points work; authenticated posts charge, legacy clients may still post during rollout.
- `required`: every new post requires login and 3 points.

The release document lists these secret names without values:

```text
APPLE_TEAM_ID
APPLE_KEY_ID
APPLE_PRIVATE_KEY
APPLE_CLIENT_IDS=com.lynncat.markets,com.lynncat.markets.watchkitapp
APPLE_TOKEN_ENCRYPTION_KEY
APPLE_SUBJECT_HASH_SALT
SESSION_HASH_SALT
MARKET_POINTS_MODE
```

It also lists App ID grouping, capabilities, migration, optional deployment, real-device tests and separate approval for `required`.

- [ ] **Step 4: Run all backend checks**

Run:

```bash
node --check src/marketCrypto.js
node --check src/marketAuth.js
node --check src/marketPoints.js
node --check src/marketAccount.js
node --check src/messages.js
node --check src/worker.js
node --test test/*.test.mjs
```

Expected: every check exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/worker.js wrangler.toml test/market-worker.test.mjs docs/release/lynncat-points-apple-setup.md
git commit -m "feat: expose lynncat account and point APIs"
```

---

### Task 7: Build the macOS account API, Keychain and Store

**Files:**
- Create: `AurumMac/LynncatAccountModels.swift`
- Create: `AurumMac/LynncatAccountAPI.swift`
- Create: `AurumMac/LynncatAccountStore.swift`
- Create: `AurumMacTests/LynncatAccountStoreTests.swift`
- Modify: `AurumMac.xcodeproj/project.pbxproj`

**Interfaces:**
- Produces: account/ledger/leaderboard DTOs, `LynncatAccountAPI`, `KeychainLynncatTokenStore`, `@MainActor @Observable LynncatAccountStore`.

- [ ] **Step 1: Write failing Store tests**

```swift
@MainActor
func testHeartbeatUsesServerBalance() async {
    let api = FakeLynncatAPI()
    api.heartbeatResult = .init(credited: true, pointsBalance: 7, activeSeconds: 0, leaseVersion: 4)
    let store = LynncatAccountStore(api: api, tokenStore: MemoryTokenStore(token: "session"))
    store.loadPreviewAccount(points: 6)
    await store.heartbeatTick()
    XCTAssertEqual(store.account?.pointsBalance, 7)
    XCTAssertEqual(api.heartbeatCalls.count, 1)
}

@MainActor
func testBackgroundStopsWithoutQueuedCredit() {
    let api = FakeLynncatAPI()
    let store = LynncatAccountStore(api: api, tokenStore: MemoryTokenStore(token: "session"))
    store.setForeground(true)
    store.setForeground(false)
    XCTAssertEqual(api.stopCalls, 1)
    XCTAssertFalse(store.isAccruing)
}
```

- [ ] **Step 2: Add source references and verify failure**

Run:

```bash
xcodebuild test -project AurumMac.xcodeproj -scheme AurumMac \
  -destination 'platform=macOS' \
  -derivedDataPath /tmp/AurumMacPointsDerivedData CODE_SIGNING_ALLOWED=NO
```

Expected: FAIL because account types are undefined.

- [ ] **Step 3: Implement models, API, Keychain and Store**

```swift
struct LynncatAccount: Codable, Equatable {
    let id: String
    var nickname: String
    var pointsBalance: Int
    var pointsEarnedTotal: Int
    var leaderboardVisible: Bool
}

struct AppleCredentialPayload: Encodable {
    let identityToken: String
    let authorizationCode: String
    let nonce: String
    let installationId: String
    let platform: String
}

struct LynncatSessionEnvelope: Decodable {
    let sessionToken: String
    let account: LynncatAccount
}

struct HeartbeatEnvelope: Decodable {
    let credited: Bool
    let pointsBalance: Int
    let activeSeconds: Int
    let leaseVersion: Int
    let serverTime: Int64
    let nextCreditAt: Int64
}

struct LynncatLeaderboardEntry: Codable, Identifiable, Equatable {
    let rank: Int
    let publicId: String
    let nickname: String
    let pointsBalance: Int
    let isCurrentUser: Bool
    var id: String { publicId }
}

struct LynncatPointEntry: Codable, Identifiable, Equatable {
    let id: String
    let kind: String
    let amount: Int
    let balanceAfter: Int
    let createdAt: Date
}

struct LeaderboardEnvelope: Decodable {
    let entries: [LynncatLeaderboardEntry]
    let me: LynncatLeaderboardEntry?
}

struct PointLedgerEnvelope: Decodable {
    let entries: [LynncatPointEntry]
    let nextCursor: String?
}

protocol LynncatAccountAPI {
    func signIn(_ credential: AppleCredentialPayload) async throws -> LynncatSessionEnvelope
    func account(token: String) async throws -> LynncatAccount
    func heartbeat(token: String, leaseVersion: Int, idempotencyKey: String) async throws -> HeartbeatEnvelope
    func stopHeartbeat(token: String, leaseVersion: Int) async
    func updateProfile(token: String, nickname: String, leaderboardVisible: Bool) async throws -> LynncatAccount
    func leaderboard(token: String?) async throws -> LeaderboardEnvelope
    func ledger(token: String, cursor: String?) async throws -> PointLedgerEnvelope
    func logout(token: String) async
    func deleteAccount(token: String) async throws
}
```

API base is `https://lynncat.com/markets`, timeout 8 seconds, reload cache policy, Bearer and idempotency headers. Keychain service is `com.lynncat.markets.account`. The Store owns the only 20-second heartbeat Task and never increments balance locally.

- [ ] **Step 4: Run Mac tests**

Run the Step 2 command.

Expected: `** TEST SUCCEEDED **`.

- [ ] **Step 5: Commit only account files**

```bash
git add AurumMac/LynncatAccountModels.swift AurumMac/LynncatAccountAPI.swift \
  AurumMac/LynncatAccountStore.swift AurumMacTests/LynncatAccountStoreTests.swift \
  AurumMac.xcodeproj/project.pbxproj
git commit -m "feat: add lynncat account store on mac"
```

Inspect staged diff first; do not stage `.superpowers/sdd/progress.md`, and preserve pre-existing project-file edits.

---

### Task 8: Add macOS foreground tracking, UI and charged messages

**Files:**
- Create: `AurumMac/MacForegroundTracker.swift`
- Create: `AurumMac/LynncatAccountViews.swift`
- Create: `AurumMacTests/MacForegroundTrackerTests.swift`
- Modify: `AurumMac/AurumMacApp.swift`
- Modify: `AurumMac/SettingsMacView.swift`
- Modify: `AurumMac/MessageBoardView.swift`
- Modify: `AurumMac/AurumMac.entitlements`
- Modify: `AurumMac.xcodeproj/project.pbxproj`

**Interfaces:**
- Produces: `MacPresenceState`, tracker, account settings, leaderboard and Bearer/idempotent message send.

- [ ] **Step 1: Write failing presence tests**

```swift
func testAccruesOnlyWhenActiveAndVisible() {
    XCTAssertFalse(MacPresenceState(appIsActive: false, visibleWindowCount: 1).shouldAccrue)
    XCTAssertFalse(MacPresenceState(appIsActive: true, visibleWindowCount: 0).shouldAccrue)
    XCTAssertTrue(MacPresenceState(appIsActive: true, visibleWindowCount: 1).shouldAccrue)
}

func testTwoWindowsStillCountAsOneDevice() {
    XCTAssertTrue(MacPresenceState(appIsActive: true, visibleWindowCount: 2).shouldAccrue)
}
```

- [ ] **Step 2: Run and verify missing presence type**

Run the Task 7 test command.

Expected: FAIL because `MacPresenceState` is undefined.

- [ ] **Step 3: Implement presence and account views**

Observe app active/resign and window visible/miniaturize/deminiaturize/close notifications. Update Store with:

```swift
let visible = NSApp.windows.filter { $0.isVisible && !$0.isMiniaturized }.count
account.setForeground(MacPresenceState(appIsActive: NSApp.isActive, visibleWindowCount: visible).shouldAccrue)
```

Start tracker in `AppDelegate`. Settings account section uses system `SignInWithAppleButton`, balance, nickname, visibility toggle, ledger, leaderboard, logout and deletion confirmation. Leaderboard is a compact list with rank, nickname, balance and “本人/You”.

Entitlement:

```xml
<key>com.apple.developer.applesignin</key>
<array><string>Default</string></array>
```

- [ ] **Step 4: Integrate messages and verify**

`CommunityStore.send` requires account session, sends Bearer/idempotency headers, uses account nickname, decodes server balance and updates account Store. Composer shows balance/login, opens leaderboard, disables under 3 points, preserves draft on insufficient points, and retains cooldown/report/block/expiry.

In `LynncatAccountModels.swift`, all new copy uses:

```swift
func lynncatText(region: Region, hans: String, hant: String, en: String) -> String {
    switch region {
    case .mainland: return hans
    case .hongKong: return hant
    case .usd: return en
    }
}
```

Run:

```bash
xcodebuild test -project AurumMac.xcodeproj -scheme AurumMac \
  -destination 'platform=macOS' -derivedDataPath /tmp/AurumMacPointsDerivedData CODE_SIGNING_ALLOWED=NO
xcodebuild build -project AurumMac.xcodeproj -scheme AurumMac \
  -configuration Release -destination 'platform=macOS' \
  -derivedDataPath /tmp/AurumMacPointsRelease CODE_SIGNING_ALLOWED=NO
```

Expected: test and build succeed.

- [ ] **Step 5: Commit**

```bash
git add AurumMac/MacForegroundTracker.swift AurumMac/LynncatAccountViews.swift \
  AurumMac/AurumMacApp.swift AurumMac/SettingsMacView.swift AurumMac/MessageBoardView.swift \
  AurumMac/AurumMac.entitlements AurumMacTests/MacForegroundTrackerTests.swift \
  AurumMac.xcodeproj/project.pbxproj
git commit -m "feat: add mac points and leaderboard experience"
```

---

### Task 9: Build the iOS account core and foreground lease

**Files:**
- Create: `AurumGold/LynncatAccountModels.swift`
- Create: `AurumGold/LynncatAccountAPI.swift`
- Create: `AurumGold/LynncatAccountStore.swift`
- Create: `AurumGoldTests/LynncatAccountStoreTests.swift`
- Modify: `AurumGold/AurumApp.swift`

**Interfaces:**
- Produces the same JSON field names as Mac, platform fixed to `ios`.

- [ ] **Step 1: Write failing iOS Store test**

```swift
@MainActor
func testSceneActivityControlsOneHeartbeatLoop() async {
    let api = FakeLynncatAPI()
    let store = LynncatAccountStore(api: api, tokenStore: MemoryTokenStore(token: "session"))
    store.loadPreviewAccount(points: 2)
    store.setSceneActive(true)
    await store.heartbeatTick()
    store.setSceneActive(false)
    XCTAssertEqual(api.heartbeatCalls.count, 1)
    XCTAssertEqual(api.stopCalls, 1)
}
```

- [ ] **Step 2: Run and verify missing Store**

Run:

```bash
xcodebuild test -project AurumGold.xcodeproj -scheme AurumGold \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -derivedDataPath /tmp/AurumGoldPointsDerivedData CODE_SIGNING_ALLOWED=NO
```

Expected with healthy CoreSimulator: FAIL because Store is undefined. Record the environment error if CoreSimulator remains unavailable.

- [ ] **Step 3: Implement iOS account core**

Mirror Mac DTO/API behavior and add `static func preview(points:token:)` only for deterministic previews/tests. Keychain service stays `com.lynncat.markets.account`. In `AurumApp`:

```swift
@Environment(\.scenePhase) private var scenePhase
@State private var account = LynncatAccountStore.shared

.onChange(of: scenePhase, initial: true) { _, phase in
    account.setSceneActive(phase == .active)
}
```

Only the Store owns heartbeat Task; scene exit stops lease.

- [ ] **Step 4: Run tests and generic build**

Run:

```bash
xcodebuild test -project AurumGold.xcodeproj -scheme AurumGold \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -derivedDataPath /tmp/AurumGoldPointsDerivedData CODE_SIGNING_ALLOWED=NO
xcodebuild build -project AurumGold.xcodeproj -scheme AurumGold \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/AurumGoldPointsBuild CODE_SIGNING_ALLOWED=NO
```

Expected: tests pass when Simulator is available; generic build succeeds.

- [ ] **Step 5: Record checkpoint**

Run:

```bash
find AurumGold AurumGoldTests -maxdepth 1 -name 'LynncatAccount*.swift' -o -name 'AurumApp.swift' | sort
```

Expected: three account source files, one test and `AurumApp.swift`. Do not initialize Git.

---

### Task 10: Add iOS account UI, leaderboard and charged messages

**Files:**
- Create: `AurumGold/LynncatAccountViews.swift`
- Create: `AurumGold/AurumGold.entitlements`
- Modify: `AurumGold/SettingsView.swift`
- Modify: `AurumGold/CommunityFeature.swift`
- Modify: `AurumGold.xcodeproj/project.pbxproj`

**Interfaces:**
- Consumes: `LynncatAccountStore.shared`.
- Produces: account settings, leaderboard and authenticated `CommunityStore.send`.

- [ ] **Step 1: Write failing CommunityStore test**

```swift
@MainActor
func testInsufficientPointsKeepsBalanceAndError() async {
    let account = LynncatAccountStore.preview(points: 2, token: "session")
    let community = CommunityStore.preview(
        accountStore: account,
        sendResult: .failure(.insufficientPoints(required: 3, balance: 2))
    )
    XCTAssertFalse(await community.send("观察美元", to: "XAU"))
    XCTAssertEqual(community.errorCode, "insufficient_points")
    XCTAssertEqual(account.account?.pointsBalance, 2)
}
```

- [ ] **Step 2: Run and verify anonymous behavior fails**

Run the Task 9 iOS test command.

Expected: FAIL because account-aware preview/send is absent.

- [ ] **Step 3: Implement iPhone-native UI and messages**

Use system `SignInWithAppleButton`. Add the account section near the top of Settings, not a new Tab. It includes balance, nickname, visibility toggle, leaderboard, ledger, logout and delete account.

Composer command:

```swift
Button {
    if account.isSignedIn {
        Task { await sendDraft() }
    } else {
        showingSignIn = true
    }
} label: {
    Image(systemName: account.isSignedIn ? "paperplane.fill" : "person.crop.circle.badge.plus")
}
```

Send Bearer/idempotency headers and room/text only; apply returned server balance. Keep current iPhone design, ticker, room IDs, report and block.

Extend `CommunityStore.preview(accountStore:sendResult:)` for tests, and define the same `lynncatText(region:hans:hant:en:)` switch as Mac so Hong Kong receives Traditional Chinese rather than Simplified Chinese.

Create entitlement:

```xml
<key>com.apple.developer.applesignin</key>
<array><string>Default</string></array>
```

Set `CODE_SIGN_ENTITLEMENTS = AurumGold/AurumGold.entitlements` in Debug and Release.

- [ ] **Step 4: Run iOS tests and build**

Run the Task 9 Step 4 commands.

Expected: tests pass when Simulator is healthy; generic build succeeds.

- [ ] **Step 5: Record checkpoint**

Run:

```bash
plutil -p AurumGold/AurumGold.entitlements
rg -n "LynncatAccountSettingsSection|LynncatLeaderboardView|Idempotency-Key|pointsBalance" AurumGold AurumGoldTests
```

Expected: Apple entitlement and four integration symbols are present.

---

### Task 11: Build independent Watch account and foreground lease

**Files:**
- Create: `AurumGoldWatch/WatchAccountModels.swift`
- Create: `AurumGoldWatch/WatchAccountAPI.swift`
- Create: `AurumGoldWatch/WatchAccountStore.swift`
- Create: `AurumGoldWatchTests/WatchAccountStoreTests.swift`
- Modify: `AurumGoldWatch/AurumGoldWatchApp.swift`

**Interfaces:**
- Produces: `WatchAccountStore.shared`, native Apple credential handling, Watch-local Keychain session and one foreground heartbeat.

- [ ] **Step 1: Write failing Watch Store test**

```swift
@MainActor
func testWatchStopsLeaseOutsideActiveScene() async {
    let api = FakeWatchAccountAPI()
    let store = WatchAccountStore(api: api, tokenStore: MemoryWatchTokenStore(token: "watch-session"))
    store.loadPreviewAccount(points: 5)
    store.setSceneActive(true)
    await store.heartbeatTick()
    store.setSceneActive(false)
    XCTAssertEqual(api.heartbeatCalls, 1)
    XCTAssertEqual(api.stopCalls, 1)
}
```

- [ ] **Step 2: Run and verify missing Store**

Run:

```bash
xcodebuild test -project AurumGold.xcodeproj -scheme AurumGoldWatch \
  -destination 'platform=watchOS Simulator,name=Apple Watch Series 10 (46mm)' \
  -derivedDataPath /tmp/AurumWatchPointsDerivedData CODE_SIGNING_ALLOWED=NO
```

Expected with healthy CoreSimulator: FAIL because Store is undefined.

- [ ] **Step 3: Implement independent Watch login**

Use SwiftUI `SignInWithAppleButton`, available on the installed watchOS SDK, with the same nonce/credential payload. Watch uses its own installation ID and Keychain token, platform `watchos`.

Add `static func preview(points:token:)` to `WatchAccountStore` for tests/previews; production initialization still uses Keychain and the live API.

```swift
@Environment(\.scenePhase) private var scenePhase
@State private var account = WatchAccountStore.shared

WindowGroup {
    WatchRootView()
        .onChange(of: scenePhase, initial: true) { _, phase in
            account.setSceneActive(phase == .active)
        }
}
```

Only one 20-second Task exists for the entire Watch app.

- [ ] **Step 4: Run Watch tests and generic build**

Run:

```bash
xcodebuild test -project AurumGold.xcodeproj -scheme AurumGoldWatch \
  -destination 'platform=watchOS Simulator,name=Apple Watch Series 10 (46mm)' \
  -derivedDataPath /tmp/AurumWatchPointsDerivedData CODE_SIGNING_ALLOWED=NO
xcodebuild build -project AurumGold.xcodeproj -scheme AurumGoldWatch \
  -destination 'generic/platform=watchOS Simulator' \
  -derivedDataPath /tmp/AurumWatchPointsBuild CODE_SIGNING_ALLOWED=NO
```

Expected: tests pass when Simulator is healthy; generic build succeeds.

- [ ] **Step 5: Record checkpoint**

Run: `find AurumGoldWatch AurumGoldWatchTests -maxdepth 1 -name 'WatchAccount*.swift' | sort`

Expected: three production files and one test file.

---

### Task 12: Add Watch UI, leaderboard and message composer

**Files:**
- Create: `AurumGoldWatch/WatchAccountViews.swift`
- Create: `AurumGoldWatch/AurumGoldWatch.entitlements`
- Modify: `AurumGoldWatch/WatchServices.swift`
- Modify: `AurumGoldWatch/WatchViews.swift`
- Modify: `AurumGold.xcodeproj/project.pbxproj`

**Interfaces:**
- Produces Watch settings, leaderboard, nickname editor and `WatchCommunityStore.send`.

- [ ] **Step 1: Write failing Watch community test**

```swift
@MainActor
func testWatchSendUsesServerBalanceAndCooldown() async {
    let account = WatchAccountStore.preview(points: 4, token: "session")
    let store = WatchCommunityStore.preview(accountStore: account, sendBalance: 1)
    XCTAssertTrue(await store.send("关注美元", to: "XAU"))
    XCTAssertEqual(account.account?.pointsBalance, 1)
    XCTAssertGreaterThan(store.remainingCooldown(for: "XAU"), 0)
}
```

- [ ] **Step 2: Run and verify send is missing**

Run the Task 11 Watch test command.

Expected: FAIL because `WatchCommunityStore.send` is absent.

- [ ] **Step 3: Implement compact Watch flows**

Settings top section: login, balance, nickname, visibility, leaderboard, logout and delete. `WatchMessagesView` adds balance/online state, nickname edit, `TextField` supporting dictation/Scribble/keyboard, and a send button requiring login, 3 points, text and zero cooldown.

`WatchCommunityStore.send` sends Bearer/idempotency, applies server balance, stores room cooldown and caps visible messages at 20. Keep report/block and 60-second refresh throttle. Do not add `WatchMessageTicker` to `WatchRootView`.

Extend `WatchCommunityStore.preview(accountStore:sendBalance:)` for tests. New Watch copy switches explicitly on `WatchRegion.mainland`, `.hongKong`, and `.usd` to provide Simplified Chinese, Traditional Chinese, and English.

Add Apple entitlement and set `CODE_SIGN_ENTITLEMENTS = AurumGoldWatch/AurumGoldWatch.entitlements` in Debug/Release.

- [ ] **Step 4: Run tests and build**

Run the Task 11 Step 4 commands.

Expected: Watch tests pass when Simulator is healthy and generic build succeeds without duplicate heartbeat tasks.

- [ ] **Step 5: Record checkpoint**

Run:

```bash
plutil -p AurumGoldWatch/AurumGoldWatch.entitlements
rg -n "SignInWithAppleButton|WatchLeaderboardView|func send|pointsBalance" AurumGoldWatch AurumGoldWatchTests
```

Expected: entitlement and four symbols are present.

---

### Task 13: Update privacy manifests, policy and App Store checklist

**Files:**
- Modify: `markets/privacy.html`
- Modify: `/Users/laosuer/Xcode/60604gold/AurumMac 18/AurumMac/PrivacyInfo.xcprivacy`
- Modify: `/Users/laosuer/Xcode/60604gold/AurumGold 11/AurumGold/PrivacyInfo.xcprivacy`
- Modify: `/Users/laosuer/Xcode/60604gold/AurumGold 11/AurumGoldWatch/PrivacyInfo.xcprivacy`
- Modify: `test/public-copy.test.mjs`
- Modify: `docs/release/lynncat-points-apple-setup.md`

**Interfaces:**
- Produces accurate English/Traditional Chinese policy and exact App Store privacy answers.

- [ ] **Step 1: Write failing policy assertions**

```js
test('privacy policy covers optional accounts, points, leaderboard and deletion', async () => {
  const html = await readFile(new URL('../markets/privacy.html', import.meta.url), 'utf8');
  for (const phrase of ['Sign in with Apple', 'Lynncat Points', 'leaderboard',
    'Delete Lynncat Account', '使用 Apple 登入', 'Lynncat 積分', '排行榜', '刪除 Lynncat 帳號']) {
    assert.match(html, new RegExp(phrase, 'i'));
  }
  assert.doesNotMatch(html, /No account or registration required/);
  assert.doesNotMatch(html, /無需註冊帳號/);
});
```

- [ ] **Step 2: Run and verify old policy fails**

Run: `node --test test/public-copy.test.mjs`

Expected: FAIL because policy still states no account.

- [ ] **Step 3: Update policy and manifests**

Both languages disclose optional account; Apple opaque user ID; nickname; install/device ID; foreground heartbeats; balance/ledger/visibility; posts/reports; no ads/tracking; public nickname/balance only; in-app deletion; no cash value.

In all three manifests:

- Other User Content and Device ID become linked.
- Add linked User ID for App Functionality and Fraud Prevention/Security.
- Add linked Product Interaction for App Functionality.
- Tracking remains false and domains remain empty.

The release checklist must mirror these four App Store Connect data categories.

- [ ] **Step 4: Validate**

Run:

```bash
node --test test/public-copy.test.mjs
plutil -lint '/Users/laosuer/Xcode/60604gold/AurumMac 18/AurumMac/PrivacyInfo.xcprivacy'
plutil -lint '/Users/laosuer/Xcode/60604gold/AurumGold 11/AurumGold/PrivacyInfo.xcprivacy'
plutil -lint '/Users/laosuer/Xcode/60604gold/AurumGold 11/AurumGoldWatch/PrivacyInfo.xcprivacy'
node --test test/*.test.mjs
```

Expected: copy passes, three manifests report `OK`, full backend passes.

- [ ] **Step 5: Commit repository-owned privacy files**

```bash
git add markets/privacy.html test/public-copy.test.mjs docs/release/lynncat-points-apple-setup.md
git commit -m "docs: disclose lynncat accounts and points"
```

Commit the Mac manifest separately without staging unrelated files:

```bash
cd '/Users/laosuer/Xcode/60604gold/AurumMac 18'
git add AurumMac/PrivacyInfo.xcprivacy
git commit -m "docs: link lynncat account privacy data"
```

Mobile has no Git step.

---

### Task 14: Configure, deploy and run end-to-end acceptance

**Files:**
- Verify all Tasks 1–13 files.
- Create no secret-bearing file.

**Interfaces:**
- Produces Apple configuration, migrated D1, Worker in `optional`, verified clients and a separately approved switch to `required`.

- [ ] **Step 1: Run complete local verification**

```bash
cd /Users/laosuer/Lynncat.com
node --test test/*.test.mjs
git status --short

cd '/Users/laosuer/Xcode/60604gold/AurumMac 18'
xcodebuild test -project AurumMac.xcodeproj -scheme AurumMac \
  -destination 'platform=macOS' -derivedDataPath /tmp/AurumMacPointsFinal CODE_SIGNING_ALLOWED=NO

cd '/Users/laosuer/Xcode/60604gold/AurumGold 11'
xcodebuild build -project AurumGold.xcodeproj -scheme AurumGold \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/AurumGoldPointsFinal CODE_SIGNING_ALLOWED=NO
xcodebuild build -project AurumGold.xcodeproj -scheme AurumGoldWatch \
  -destination 'generic/platform=watchOS Simulator' -derivedDataPath /tmp/AurumWatchPointsFinal CODE_SIGNING_ALLOWED=NO
```

Expected: backend and Mac tests pass; iOS/Watch builds succeed; `dist/` remains untouched.

- [ ] **Step 2: Configure Apple Developer with authorization**

1. Enable Sign in with Apple for `com.lynncat.markets` and `com.lynncat.markets.watchkitapp`.
2. Group identifiers under the same primary App ID.
3. Create one Sign in with Apple key; securely retain Team ID, Key ID and downloaded `.p8`.
4. Regenerate macOS, iOS and watchOS profiles.
5. Confirm Release archives contain Apple login entitlement.

Expected: all app targets show capability with no profile error.

- [ ] **Step 3: Apply migration and secrets with authorization**

```bash
npx wrangler d1 execute lynncat-market-community --remote --file migrations/0002_lynncat_accounts_points.sql
npx wrangler secret put APPLE_TEAM_ID
npx wrangler secret put APPLE_KEY_ID
npx wrangler secret put APPLE_PRIVATE_KEY
npx wrangler secret put APPLE_CLIENT_IDS
npx wrangler secret put APPLE_TOKEN_ENCRYPTION_KEY
npx wrangler secret put APPLE_SUBJECT_HASH_SALT
npx wrangler secret put SESSION_HASH_SALT
npx wrangler secret put MARKET_POINTS_MODE
```

Enter `optional` for rollout mode. Expected: migration and secret uploads succeed without echoing values.

- [ ] **Step 4: Deploy and test real devices**

Run only with authorization: `npx wrangler deploy`

Verify:

1. Guest reads; new client requests login before posting.
2. One foreground device gains 1 point after 60 seconds and none in background.
3. Mac+iPhone foreground together gain 2 points per minute.
4. One 3-point post deducts once, appears only in its room and starts cooldown.
5. Retry does not duplicate debit/message.
6. Watch login/input/send/report/block/leaderboard stays responsive.
7. Ranking changes after earn/spend; hiding removes user.
8. Logout keeps balance; deletion invalidates all devices and removes account.

Expected: all eight behaviors pass and logs contain no private tokens/IDs.

- [ ] **Step 5: Prepare App Store updates and final enforcement**

Update App Store privacy answers and review notes from the release document; do not submit without explicit authorization. After approved clients and a user decision on old-version policy, separately authorize `MARKET_POINTS_MODE=required` and any minimum-version change.

Final smoke:

```bash
curl -fsS 'https://lynncat.com/markets/leaderboard' | node -e '
let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
  const value=JSON.parse(s);
  if(!Array.isArray(value.entries)) process.exit(1);
  console.log(`leaderboard entries: ${value.entries.length}`);
});'
```

Expected: prints a nonnegative entry count and exposes no private fields.
