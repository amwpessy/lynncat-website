import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('support page publishes moderation contact and reporting information', async () => {
  const html = await readFile('markets/support.html', 'utf8');
  assert.match(html, /举报|Report/);
  assert.match(html, /href="community"/);
});

test('privacy page discloses community content and pseudonymous anti-abuse data', async () => {
  const html = await readFile('markets/privacy.html', 'utf8');
  assert.match(html, /昵称|nickname/i);
  assert.match(html, /举报|report/i);
  assert.match(html, /哈希|hashed/i);
});

test('privacy policy covers optional accounts, points, leaderboard and deletion', async () => {
  const html = await readFile('markets/privacy.html', 'utf8');
  for (const phrase of ['Sign in with Apple', 'Lynncat Points', 'leaderboard',
    'Delete Lynncat Account', '使用 Apple 登入', 'Lynncat 積分', '排行榜', '刪除 Lynncat 帳號']) {
    assert.match(html, new RegExp(phrase, 'i'));
  }
  assert.doesNotMatch(html, /No account or registration required/);
  assert.doesNotMatch(html, /無需註冊帳號/);
});

test('Lynncat Pilot pages distinguish App Store and Direct account and game features', async () => {
  const privacy = await readFile('codexpilot/privacy.html', 'utf8');
  const product = await readFile('codexpilot/index.html', 'utf8');

  for (const phrase of ['Optional account and login methods', 'Points and games by edition',
    'Direct edition only', 'not included in the Mac App Store binary',
    '7,500 points', 'Card faces and in-game decisions are not uploaded',
    '可选账户与登录方式', '各版本的积分与游戏', '仅限 Direct 版',
    '不包含在 Mac App Store 二进制中', '牌面和游戏操作不会上传']) {
    assert.match(privacy, new RegExp(phrase, 'i'));
  }
  assert.match(product, /Built specifically for Codex users on Mac/i);
  assert.match(product, /Codex quota signals/i);
  assert.match(product, /Water Margin 108/i);
  assert.match(product, /林猫驾驶舱/);
  assert.match(product, /downloads\/Lynncat-Pilot-1\.2-Direct-Build-7\.dmg/i);
  assert.match(product, /Apple notarized/i);
  assert.match(product, /258fe97e9cd6eb3fbff7062b1282452afa85c4a9c7aebed5c803c8d3f5f28de1/i);
  assert.match(product, /Build 7/i);
  assert.match(product, /passwords from 8 characters/i);
  assert.match(product, /Version 1\.2 Direct includes system monitoring/i);
  assert.match(product, /Texas Hold'em/i);
  assert.match(product, /Poker remains exclusive to the Direct edition and is not included in the Mac App Store binary/i);
  assert.doesNotMatch(product, /Lynncat DevPilot|灵猫开发驾驶舱/i);
  assert.doesNotMatch(product, /No cloud account/i);
});

test('Lynncat Pilot landing page keeps reveal content resilient and mobile navigation accessible', async () => {
  const product = await readFile('codexpilot/index.html', 'utf8');
  const css = await readFile('codexpilot/site.css', 'utf8');
  const script = await readFile('codexpilot/site.js', 'utf8');

  assert.match(product, /document\.documentElement\.classList\.add\("js"\)/);
  assert.match(product, /hero-window reveal is-visible/);
  assert.match(css, /\.js \.reveal/);
  assert.match(css, /background:\s*var\(--bg\)/);
  assert.match(css, /:focus-visible/);
  assert.match(script, /event\.key === "Escape"/);
  assert.match(script, /Close menu/);
  assert.match(script, /关闭菜单/);
});

test('Lynncat Pilot landing page eagerly loads every current pic screenshot from stable asset paths', async () => {
  const product = await readFile('codexpilot/index.html', 'utf8');
  const screenshots = ['cockpit.jpg', 'community.jpg', 'poker.jpg', 'cards.jpg'];

  for (const screenshot of screenshots) {
    const asset = await readFile(`codexpilot/assets/${screenshot}`);
    assert.ok(asset.byteLength > 100_000, `${screenshot} should contain the exported pic screenshot`);
    assert.match(product, new RegExp(`/codexpilot/assets/${screenshot.replace('.', '\\.')}\\?v=20260724-2`));
  }
  assert.doesNotMatch(product, /loading="lazy"/);
});

test('points release guide documents safe token-key rotation without embedding key material', async () => {
  const guide = await readFile('docs/release/lynncat-points-apple-setup.md', 'utf8');

  assert.match(guide, /APPLE_TOKEN_ENCRYPTION_KEYS[\s\S]*JSON object/i);
  assert.match(guide, /positive string versions/i);
  assert.match(guide, /32-byte[\s\S]*(standard Base64|Base64URL)/i);
  assert.match(guide, /zero[\s\S]*market_apple_credentials[\s\S]*token_key_version/i);
  assert.match(guide, /rollback[\s\S]*backup[\s\S]*remov/i);
  assert.match(guide, /rotating[\s\S]*does not rewrite old credentials/i);
  assert.match(guide, /APPLE_TOKEN_ENCRYPTION_KEY[\s\S]*fallback[\s\S]*current APPLE_TOKEN_KEY_VERSION/i);
  assert.match(guide, /account deletion[\s\S]*retry[\s\S]*old key/i);
  assert.match(guide, /placeholder/i);
  assert.doesNotMatch(guide, /"\d+"\s*:\s*"[A-Za-z0-9+/_-]{40,}={0,2}"/);
  assert.doesNotMatch(guide, /-----BEGIN (?:EC |RSA )?PRIVATE KEY-----/);
});

test('points release guide mirrors App Store privacy categories', async () => {
  const guide = await readFile('docs/release/lynncat-points-apple-setup.md', 'utf8');

  for (const category of ['User ID', 'Device ID', 'Other User Content', 'Product Interaction']) {
    assert.ok(guide.includes(`| \`${category}\` |`));
  }
  assert.match(guide, /Data Used to Track You[^\n]*No/i);
  assert.match(guide, /Delete Lynncat Account/i);
});

test('homepage exposes the Mac market dashboard feature set', async () => {
  const html = await readFile('index.html', 'utf8');
  const script = await readFile('markets-home.js', 'utf8');

  for (const phrase of [
    '更多市场', '市场情报流', '中国央行黄金储备', '价格提醒',
    '积分明细', '删除林猫账户及全部数据', '加注至 / Raise to',
    '水浒一百单八将卡册', '原 Lynncat 子网站入口',
  ]) {
    assert.match(html, new RegExp(phrase));
  }
  for (const feature of [
    'renderUSStocksDetail', 'renderDebtDetail', 'renderOilDetail', 'renderGoldDetail',
    'checkPriceAlerts', 'reportMessage', 'blockAuthor', 'loadLedger', 'toggleMarketDisplay',
  ]) {
    assert.match(script, new RegExp(`function ${feature}`));
  }
});

test('homepage exposes the current macOS and iOS direct downloads', async () => {
  const html = await readFile('index.html', 'utf8');
  const downloads = await readFile('markets/downloads.html', 'utf8');
  const css = await readFile('markets-home.css', 'utf8');
  const macBuild = await readFile('markets/downloads/Lynncat-Markets-1.5-Direct.dmg');
  const iosBuild = await readFile('markets/downloads/Lynncat-Markets-1.5-iOS-SelfSign.ipa');

  assert.match(html, /href="\/markets\/downloads\/Lynncat-Markets-1\.5-Direct\.dmg\?v=9"/);
  assert.match(html, /href="\/markets\/downloads\/Lynncat-Markets-1\.5-iOS-SelfSign\.ipa\?v=8"/);
  assert.match(html, /macOS 官网版[\s\S]*1\.5 \(9\)/);
  assert.match(html, /iOS 官网版[\s\S]*1\.5 \(8\) · 需自签/);
  assert.match(downloads, /macOS[\s\S]*Version 1\.5 · Build 9/);
  assert.match(downloads, /iOS[\s\S]*Version 1\.5 · Build 8/);
  assert.match(css, /\.client-download-inner/);
  assert.ok(macBuild.byteLength > 1_000_000);
  assert.ok(iosBuild.byteLength > 1_000_000);
});
