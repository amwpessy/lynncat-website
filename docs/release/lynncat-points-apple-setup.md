# Lynncat account and points rollout

This release adds Apple-backed Lynncat accounts, foreground points, public leaderboard entries, and three-point authenticated message publishing. Deploy it in `optional` mode first. Switching to `required` needs a separate explicit approval after real-device acceptance.

## Required configuration names

Configure the following names in Cloudflare and the release environment. Keep all values out of this document, source control, logs, screenshots, and review notes.

| Name | Kind | Requirement |
| --- | --- | --- |
| `APPLE_TEAM_ID` | Secret | Required |
| `APPLE_KEY_ID` | Secret | Required |
| `APPLE_PRIVATE_KEY` | Secret | Required |
| `APPLE_CLIENT_IDS` | Secret | Required |
| `APPLE_TOKEN_ENCRYPTION_KEY` | Secret | Required |
| `APPLE_TOKEN_ENCRYPTION_KEYS` | Secret | Required while historical key versions remain referenced by live data or recoverable backups |
| `APPLE_TOKEN_KEY_VERSION` | Configuration | Required |
| `APPLE_SUBJECT_HASH_SALT` | Secret | Required |
| `INSTALLATION_HASH_SALT` | Secret | Required |
| `SESSION_HASH_SALT` | Secret | Required |
| `AUTHOR_HASH_SALT` | Secret | Required |
| `AUTHOR_KEY_SECRET` | Secret | Required |
| `MARKET_POINTS_MODE` | Configuration | Required |

Use Cloudflare's interactive secret command once per secret name so values are entered without being included in shell history. Treat the token-encryption key version and rollout mode as non-secret deployment configuration, but still review their changes.

### Token-encryption key lifecycle

`APPLE_TOKEN_ENCRYPTION_KEYS` is a JSON object mapping positive string versions to 32-byte standard Base64 or Base64URL keys. The following is structure-only documentation with placeholder values, not usable secret material:

```json
{
  "1": "<standard-Base64-or-Base64URL-encoded-32-byte-key>",
  "<next-positive-version>": "<standard-Base64-or-Base64URL-encoded-32-byte-key>"
}
```

Keep every historical key available until D1 has zero `market_apple_credentials` rows referencing that old `token_key_version`, and until the rollback and backup policy allows its removal. Rotating the current key does not rewrite old credentials; each stored credential keeps the token key version used when it was encrypted.

The single `APPLE_TOKEN_ENCRYPTION_KEY` fallback is only for the current APPLE_TOKEN_KEY_VERSION. It cannot decrypt a credential that references another version. Account deletion will return retry and preserve account data if the referenced old key is absent. Before removing a historical key, check the live D1 row count for its version and confirm retained backups cannot require that key during an approved rollback or recovery window.

## Apple setup

1. Choose the existing primary App ID that owns Sign in with Apple, then group the macOS, iOS, and watchOS App IDs with that primary App ID in Apple Developer.
2. Enable the Sign in with Apple capability for every participating app target and provisioning profile.
3. Put every shipped platform client identifier in the `APPLE_CLIENT_IDS` allowlist. Do not admit wildcard, development-only, or unrelated identifiers.
4. Create or select the Sign in with Apple key associated with the same developer team and primary App ID. Record only its configuration names in release notes.
5. Confirm the macOS, iOS, and independent watchOS sign-in flows all resolve to the same Apple subject for the same person.

## Database migration

1. Back up or export the production D1 database according to the normal release procedure.
2. Review `migrations/0002_lynncat_accounts_points.sql` against the target database.
3. Apply the migration to a non-production D1 database and run the complete Worker test suite.
4. Apply the same migration to production before enabling account routes.
5. Verify the new account, device, session, credential, lease, and ledger tables and the nullable message linkage columns exist. Do not backfill legacy guest messages.

## Optional deployment

1. Upload every required secret and configure the current token key version.
2. Deploy once with `MARKET_POINTS_MODE` set to `disabled`. Confirm message reads, reports, and legacy guest publishing still work while account, point, and leaderboard endpoints return no-store `503` JSON.
3. Change `MARKET_POINTS_MODE` to `optional` in a reviewed deployment. Confirm account routes become available, headerless legacy posts remain guest posts, and every POST carrying an Authorization header uses the authenticated three-point path and fails closed on invalid credentials.
4. Inspect Worker logs for error codes only. Do not log Apple credentials, session tokens, installation identifiers, or secret material.

## Real-device acceptance

- macOS: sign in, read the account, edit the profile, earn one point after a continuous foreground minute, stop on background, post for three points, log out, and delete the account.
- iPhone: repeat sign-in, foreground/background, ledger, leaderboard visibility, posting, cooldown, insufficient-balance, and session-expiry checks.
- Apple Watch: test independent sign-in, foreground earning, stop behavior when the app is no longer active, dictation/input posting, cooldown, and the shared cross-device balance.
- Cross-device: confirm one Apple account is reused, each visible device earns only for its own foreground lease, authenticated cooldown is per user and room, and retries do not duplicate credits, messages, or debits.
- Legacy compatibility: confirm public reads and reports in all modes; guest publishing in `disabled` and headerless `optional`; malformed Bearer rejection in `optional`; and `login_required` for guests in `required`.
- Privacy: verify responses and logs omit Apple subjects, installation hashes, token hashes, refresh tokens, and session tokens except the one-time login response intended for the client.

Record the devices, OS versions, app builds, test time, and pass/fail result without recording credentials or identifiers.

## Rollback and required-mode approval

If account, point, Apple, D1, or client behavior is unhealthy, set `MARKET_POINTS_MODE` back to `disabled` and redeploy. This immediately disables account/point/leaderboard endpoints and restores legacy guest posting while retaining reads, reports, moderation, and bans. Do not roll back the additive migration as an incident response step.

Do not switch to `required` as part of the optional deployment. That change requires separate explicit approval after the supported macOS, iOS, and watchOS builds pass real-device acceptance and the old-client policy is approved. After approval, deploy `MARKET_POINTS_MODE` as `required`, then verify guest posts return `login_required` and authenticated posts still debit exactly three points atomically.
