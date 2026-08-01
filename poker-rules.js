(function installLynncatPokerRules(root) {
  "use strict";

  const BIG_BLIND = 50;
  const TABLE_RAISE_CAP = 1_000;

  function nonNegativeInteger(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function raiseBounds({ currentBet = 0, stack = 0, bet = 0 } = {}) {
    const tableBet = nonNegativeInteger(currentBet);
    const available = nonNegativeInteger(stack) + nonNegativeInteger(bet);
    const minimum = Math.max(BIG_BLIND, tableBet + BIG_BLIND);
    const cap = Math.min(TABLE_RAISE_CAP, available);
    const canRaise = cap >= minimum;
    const maximum = canRaise
      ? Math.max(minimum, Math.floor(cap / BIG_BLIND) * BIG_BLIND)
      : minimum;
    return { minimum, maximum, cap, canRaise };
  }

  function normalizeTarget(requested, situation = {}) {
    const bounds = raiseBounds(situation);
    if (!bounds.canRaise) return null;
    const numeric = Number(requested);
    const fallback = Number.isFinite(numeric) ? numeric : bounds.minimum;
    const snapped = Math.round(fallback / BIG_BLIND) * BIG_BLIND;
    return clamp(snapped, bounds.minimum, bounds.maximum);
  }

  function presetTarget(fraction, situation = {}) {
    const ratio = Number(fraction);
    const bounds = raiseBounds(situation);
    if (!bounds.canRaise || !Number.isFinite(ratio) || ratio <= 0) return null;
    const tableBet = nonNegativeInteger(situation.currentBet);
    const playerBet = nonNegativeInteger(situation.bet);
    const pot = nonNegativeInteger(situation.pot);
    const due = Math.max(0, tableBet - playerBet);
    const potAfterCall = pot + due;
    return normalizeTarget(tableBet + (potAfterCall * ratio), situation);
  }

  root.LynncatPokerRules = Object.freeze({
    BIG_BLIND,
    TABLE_RAISE_CAP,
    raiseBounds,
    normalizeTarget,
    presetTarget,
  });
}(globalThis));
