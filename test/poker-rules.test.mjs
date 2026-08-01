import test from 'node:test';
import assert from 'node:assert/strict';

await import(new URL('../poker-rules.js', import.meta.url));

const {
  BIG_BLIND,
  TABLE_RAISE_CAP,
  raiseBounds,
  normalizeTarget,
  presetTarget,
} = globalThis.LynncatPokerRules;

test('poker raise bounds mirror the Mac 50-point step and 1000-point table cap', () => {
  assert.equal(BIG_BLIND, 50);
  assert.equal(TABLE_RAISE_CAP, 1_000);
  assert.deepEqual(
    raiseBounds({ currentBet: 100, stack: 1_075, bet: 50 }),
    { minimum: 150, maximum: 1_000, cap: 1_000, canRaise: true },
  );
  assert.deepEqual(
    raiseBounds({ currentBet: 100, stack: 925, bet: 50 }),
    { minimum: 150, maximum: 950, cap: 975, canRaise: true },
  );
  assert.deepEqual(
    raiseBounds({ currentBet: 50, stack: 150, bet: 25 }),
    { minimum: 100, maximum: 150, cap: 175, canRaise: true },
  );
});

test('a short stack that can only call cannot submit a fake raise', () => {
  const situation = { currentBet: 100, stack: 75, bet: 50 };
  assert.deepEqual(
    raiseBounds(situation),
    { minimum: 150, maximum: 150, cap: 125, canRaise: false },
  );
  assert.equal(normalizeTarget(150, situation), null);
});

test('raise targets snap to a big-blind step and stay within the legal range', () => {
  const situation = { currentBet: 100, stack: 1_075, bet: 50 };
  assert.equal(normalizeTarget(174, situation), 150);
  assert.equal(normalizeTarget(176, situation), 200);
  assert.equal(normalizeTarget(2_000, situation), 1_000);
});

test('half-pot and pot presets calculate a raise-to target after calling', () => {
  const situation = {
    currentBet: 100,
    pot: 350,
    stack: 2_500,
    bet: 0,
  };
  assert.equal(presetTarget(0.5, situation), 350);
  assert.equal(presetTarget(1, situation), 550);
});

test('the Mac table cap prevents a zero-increment raise at 1000 points', () => {
  const situation = { currentBet: 1_000, pot: 2_000, stack: 2_500, bet: 1_000 };
  assert.equal(raiseBounds(situation).canRaise, false);
  assert.equal(presetTarget(1, situation), null);
});
