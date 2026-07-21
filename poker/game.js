(function () {
  "use strict";

  const SUITS = ["♠", "♥", "♦", "♣"];
  const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const NAMES = ["牌手", "林默", "高桥", "乔安"];
  const TIPS = [
    "位置越靠后，你掌握的信息越多。按钮位通常可以打得稍宽一些。",
    "听牌时别只看能否补中，也要比较跟注成本与底池大小。",
    "小对子翻牌前有潜力，但没击中三条时不必执着到底。",
    "同花听牌通常有 9 张提升牌；从翻牌到河牌约有三成机会补中。",
    "过牌不等于示弱。用强牌过牌，有时能让对手主动投入更多。"
  ];
  const CATEGORY = ["高牌", "一对", "两对", "三条", "顺子", "同花", "葫芦", "四条", "同花顺"];
  const state = {
    players: NAMES.map((name, i) => ({ name, chips: 2500, cards: [], folded: false, bet: 0, id: i })),
    deck: [], community: [], pot: 0, currentBet: 0, street: "idle", dealer: 3,
    handNo: 0, locked: false, sound: true, finished: true, logs: []
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    pot: $("potAmount"), community: $("communityCards"), hole: $("holeCards"),
    status: $("roundStatus"), strength: $("handStrength"), outs: $("outsText"),
    fold: $("foldBtn"), call: $("callBtn"), raise: $("raiseBtn"), deal: $("dealBtn"),
    range: $("raiseRange"), raiseValue: $("raiseValue"), log: $("handLog"),
    handNo: $("handNumber"), tip: $("tableTip"), toast: $("toast"), sound: $("soundToggle")
  };

  function buildDeck() {
    return SUITS.flatMap((suit) => RANKS.map((rank, value) => ({ suit, rank, value: value + 2 })));
  }

  function shuffle(cards) {
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
  }

  function cardHtml(card, small) {
    if (!card) return '<div class="card-placeholder"></div>';
    const red = card.suit === "♥" || card.suit === "♦" ? " red" : "";
    return `<div class="card${red}${small ? " small-card" : ""}"><span class="corner">${card.rank}<small>${card.suit}</small></span><span class="suit-big">${card.suit}</span></div>`;
  }

  function backHtml() { return '<div class="card card-back"></div>'; }
  function money(n) { return Math.max(0, n).toLocaleString("zh-CN"); }
  function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  function render() {
    els.pot.textContent = money(state.pot);
    els.community.innerHTML = Array.from({ length: 5 }, (_, i) => state.community[i] ? cardHtml(state.community[i]) : '<div class="card-placeholder"></div>').join("");
    els.hole.innerHTML = state.players[0].cards.length ? state.players[0].cards.map((c) => cardHtml(c)).join("") : backHtml() + backHtml();
    document.querySelectorAll(".seat").forEach((seat) => {
      const p = state.players[Number(seat.dataset.seat)];
      seat.querySelector(".player-chips").textContent = money(p.chips);
      seat.classList.toggle("folded", p.folded);
      const dealer = seat.querySelector(".dealer-chip");
      dealer.hidden = p.id !== state.dealer;
      const mini = seat.querySelector(".mini-cards");
      if (mini) {
        const show = state.finished && p.cards.length && !p.folded;
        mini.innerHTML = p.cards.length ? p.cards.map((c) => show ? cardHtml(c, true) : backHtml()).join("") : "";
      }
    });
    updateStrength();
    updateControls();
  }

  function updateControls() {
    const active = !state.finished && !state.locked && !state.players[0].folded;
    const owed = Math.max(0, state.currentBet - state.players[0].bet);
    els.fold.disabled = !active;
    els.call.disabled = !active;
    els.raise.disabled = !active || state.players[0].chips <= owed;
    els.range.disabled = els.raise.disabled;
    els.deal.disabled = !state.finished || state.locked;
    els.deal.textContent = state.handNo ? "下一手" : "发牌";
    els.call.textContent = owed ? `跟注 ${money(Math.min(owed, state.players[0].chips))}` : "过牌";
    const minRaise = Math.max(50, state.currentBet + 50);
    const maxRaise = Math.max(minRaise, Math.min(1000, state.players[0].chips + state.players[0].bet));
    els.range.min = minRaise;
    els.range.max = maxRaise;
    els.range.step = 50;
    if (+els.range.value < minRaise || +els.range.value > maxRaise) els.range.value = minRaise;
    els.raiseValue.textContent = money(+els.range.value);
  }

  function updateStrength() {
    const cards = state.players[0].cards.concat(state.community);
    if (!state.players[0].cards.length) {
      els.strength.textContent = "尚未发牌"; els.outs.textContent = "—"; return;
    }
    if (state.players[0].folded) { els.strength.textContent = "已弃牌"; els.outs.textContent = "等待下一手"; return; }
    if (cards.length < 5) {
      const [a, b] = state.players[0].cards;
      let label = "高牌";
      if (a.value === b.value) label = a.value >= 11 ? "大口袋对子" : "口袋对子";
      else if (a.value >= 12 && b.value >= 10) label = a.suit === b.suit ? "同花大牌" : "两张大牌";
      else if (Math.abs(a.value - b.value) === 1) label = a.suit === b.suit ? "同花连张" : "连张";
      els.strength.textContent = label;
      els.outs.textContent = `${a.rank}${a.suit} · ${b.rank}${b.suit}`;
      return;
    }
    const score = bestScore(cards);
    els.strength.textContent = CATEGORY[score[0]];
    if (state.community.length < 5) {
      const known = new Set(cards.map(key));
      const outs = buildDeck().filter((c) => !known.has(key(c)) && compareScores(bestScore(cards.concat(c)), score) > 0).length;
      els.outs.textContent = outs ? `约 ${outs} 张牌可提升` : "当前已成牌";
    } else els.outs.textContent = "最终牌型";
  }

  function key(c) { return c.rank + c.suit; }
  function contribute(player, amount) {
    const paid = Math.min(Math.max(0, amount), player.chips);
    player.chips -= paid; player.bet += paid; state.pot += paid; return paid;
  }

  function postBlind(id, amount, label) {
    const paid = contribute(state.players[id], amount);
    log(`<strong>${state.players[id].name}</strong> ${label} ${money(paid)}`);
  }

  async function startHand() {
    if (!state.finished || state.locked) return;
    if (state.players[0].chips < 50) {
      state.players.forEach((p) => { p.chips = 2500; });
      toast("筹码已自动补充至 2,500");
    }
    state.locked = true; state.finished = false; state.handNo += 1; state.dealer = (state.dealer + 1) % 4;
    state.deck = shuffle(buildDeck()); state.community = []; state.pot = 0; state.currentBet = 50; state.street = "preflop"; state.logs = [];
    state.players.forEach((p) => { if (p.chips < 50) p.chips = 2500; p.cards = [state.deck.pop(), state.deck.pop()]; p.folded = false; p.bet = 0; });
    const sb = (state.dealer + 1) % 4, bb = (state.dealer + 2) % 4;
    els.handNo.textContent = `第 ${state.handNo} 手`;
    els.tip.textContent = TIPS[(state.handNo - 1) % TIPS.length];
    log(`<strong>第 ${state.handNo} 手</strong> · 按钮位在 ${state.players[state.dealer].name}`);
    postBlind(sb, 25, "投入小盲"); postBlind(bb, 50, "投入大盲");
    els.status.textContent = "翻牌前 · 轮到你行动";
    sound("deal"); render();
    await delay(360); state.locked = false; updateControls();
  }

  async function playerAction(type) {
    if (state.finished || state.locked || state.players[0].folded) return;
    state.locked = true; updateControls();
    const you = state.players[0];
    if (type === "fold") {
      you.folded = true; showAction(0, "弃牌"); log("<strong>你</strong> 弃牌"); sound("fold"); render();
    } else if (type === "call") {
      const owed = Math.max(0, state.currentBet - you.bet);
      const paid = contribute(you, owed);
      showAction(0, owed ? `跟注 ${money(paid)}` : "过牌"); log(`<strong>你</strong> ${owed ? `跟注 ${money(paid)}` : "过牌"}`); sound("chip"); render();
    } else {
      const target = Math.min(+els.range.value, you.chips + you.bet);
      const paid = contribute(you, Math.max(0, target - you.bet));
      state.currentBet = you.bet;
      showAction(0, `加注到 ${money(you.bet)}`); log(`<strong>你</strong> 加注到 ${money(you.bet)}`); sound("chip"); render();
    }
    await delay(420);
    await botRound();
    if (activePlayers().length === 1) { finishByFold(activePlayers()[0]); return; }
    if (you.folded) { await runOutAfterFold(); return; }
    if (state.street === "river") await showdown();
    else await nextStreet();
  }

  async function runOutAfterFold() {
    els.status.textContent = "你已弃牌 · 其余牌手继续到摊牌";
    while (state.community.length < 5) {
      const count = state.community.length === 0 ? 3 : 1;
      for (let i = 0; i < count; i++) state.community.push(state.deck.pop());
      sound("deal"); render(); await delay(420);
    }
    await showdown();
  }

  async function botRound() {
    for (const bot of state.players.slice(1)) {
      if (bot.folded) continue;
      const owed = Math.max(0, state.currentBet - bot.bet);
      const strength = estimateStrength(bot.cards, state.community);
      const pressure = owed / Math.max(1, state.pot + owed);
      const foldChance = owed ? Math.max(.02, .45 - strength * .42 + pressure * .38) : 0;
      if (Math.random() < foldChance) {
        bot.folded = true; showAction(bot.id, "弃牌"); log(`<strong>${bot.name}</strong> 弃牌`); sound("fold");
      } else {
        const paid = contribute(bot, owed);
        showAction(bot.id, owed ? `跟注 ${money(paid)}` : "过牌");
        log(`<strong>${bot.name}</strong> ${owed ? `跟注 ${money(paid)}` : "过牌"}`); sound("chip");
      }
      render(); await delay(320);
      if (activePlayers().length === 1) break;
    }
  }

  async function nextStreet() {
    state.players.forEach((p) => { p.bet = 0; }); state.currentBet = 0;
    if (state.street === "preflop") {
      state.street = "flop"; state.community.push(state.deck.pop(), state.deck.pop(), state.deck.pop()); els.status.textContent = "翻牌 · 三张公共牌已发出";
    } else if (state.street === "flop") {
      state.street = "turn"; state.community.push(state.deck.pop()); els.status.textContent = "转牌 · 第四张公共牌";
    } else {
      state.street = "river"; state.community.push(state.deck.pop()); els.status.textContent = "河牌 · 最后一轮行动";
    }
    log(`<strong>${streetName()}</strong> · ${state.community.map((c) => c.rank + c.suit).join(" ")}`);
    sound("deal"); render(); await delay(500); state.locked = false; els.status.textContent += " · 轮到你"; updateControls();
  }

  async function showdown() {
    while (state.community.length < 5) state.community.push(state.deck.pop());
    const active = activePlayers();
    const scored = active.map((p) => ({ p, score: bestScore(p.cards.concat(state.community)) }));
    scored.sort((a, b) => compareScores(b.score, a.score));
    const best = scored[0].score;
    const winners = scored.filter((x) => compareScores(x.score, best) === 0);
    const share = Math.floor(state.pot / winners.length);
    winners.forEach((w) => { w.p.chips += share; });
    const names = winners.map((w) => w.p.id === 0 ? "你" : w.p.name).join("、");
    const result = `${names}以${CATEGORY[best[0]]}赢得 ${money(state.pot)}`;
    log(`<strong>摊牌</strong> · ${result}`); els.status.textContent = result; state.pot = 0; state.finished = true; state.locked = false; sound("win"); render(); toast(result);
  }

  function finishByFold(winner) {
    winner.chips += state.pot;
    const name = winner.id === 0 ? "你" : winner.name;
    const result = `${name}收下无人跟注的 ${money(state.pot)}`;
    log(`<strong>本手结束</strong> · ${result}`); els.status.textContent = result; state.pot = 0; state.finished = true; state.locked = false; render(); toast(result);
  }

  function activePlayers() { return state.players.filter((p) => !p.folded); }
  function streetName() { return ({ flop: "翻牌", turn: "转牌", river: "河牌" })[state.street] || "翻牌前"; }

  function estimateStrength(cards, community) {
    const all = cards.concat(community);
    if (all.length >= 5) return (bestScore(all)[0] + .5) / 9;
    const pair = cards[0].value === cards[1].value;
    const high = Math.max(cards[0].value, cards[1].value) / 14;
    const suited = cards[0].suit === cards[1].suit ? .1 : 0;
    const connected = Math.abs(cards[0].value - cards[1].value) <= 2 ? .08 : 0;
    return Math.min(1, high * .55 + (pair ? .35 : 0) + suited + connected);
  }

  function scoreFive(cards) {
    const values = cards.map((c) => c.value).sort((a, b) => b - a);
    const counts = {};
    values.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
    const groups = Object.entries(counts).map(([v, count]) => ({ v: +v, count })).sort((a, b) => b.count - a.count || b.v - a.v);
    const flush = cards.every((c) => c.suit === cards[0].suit);
    const unique = [...new Set(values)];
    if (unique[0] === 14) unique.push(1);
    let straightHigh = 0;
    for (let i = 0; i <= unique.length - 5; i++) if (unique[i] - unique[i + 4] === 4) { straightHigh = unique[i]; break; }
    if (flush && straightHigh) return [8, straightHigh];
    if (groups[0].count === 4) return [7, groups[0].v, groups[1].v];
    if (groups[0].count === 3 && groups[1].count === 2) return [6, groups[0].v, groups[1].v];
    if (flush) return [5].concat(values);
    if (straightHigh) return [4, straightHigh];
    if (groups[0].count === 3) return [3, groups[0].v].concat(groups.slice(1).map((g) => g.v).sort((a,b) => b-a));
    if (groups[0].count === 2 && groups[1].count === 2) return [2, Math.max(groups[0].v, groups[1].v), Math.min(groups[0].v, groups[1].v), groups[2].v];
    if (groups[0].count === 2) return [1, groups[0].v].concat(groups.slice(1).map((g) => g.v).sort((a,b) => b-a));
    return [0].concat(values);
  }

  function bestScore(cards) {
    if (cards.length === 5) return scoreFive(cards);
    let best = null;
    for (let a = 0; a < cards.length - 4; a++) for (let b = a + 1; b < cards.length - 3; b++) for (let c = b + 1; c < cards.length - 2; c++) for (let d = c + 1; d < cards.length - 1; d++) for (let e = d + 1; e < cards.length; e++) {
      const score = scoreFive([cards[a], cards[b], cards[c], cards[d], cards[e]]);
      if (!best || compareScores(score, best) > 0) best = score;
    }
    return best || [0];
  }

  function compareScores(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const diff = (a[i] || 0) - (b[i] || 0); if (diff) return diff;
    }
    return 0;
  }

  function showAction(id, text) {
    const el = document.querySelector(`.seat[data-seat="${id}"] .player-action`);
    el.textContent = text; el.classList.add("show");
    clearTimeout(el._timer); el._timer = setTimeout(() => el.classList.remove("show"), 1500);
  }

  function log(html) {
    state.logs.push(html);
    els.log.innerHTML = state.logs.map((item) => `<li>${item}</li>`).join("");
    els.log.scrollTop = els.log.scrollHeight;
  }

  function toast(text) {
    els.toast.textContent = text; els.toast.classList.add("show");
    clearTimeout(els.toast._timer); els.toast._timer = setTimeout(() => els.toast.classList.remove("show"), 2400);
  }

  let audio;
  function sound(type) {
    if (!state.sound) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audio.createOscillator(), gain = audio.createGain();
      const freq = type === "deal" ? 210 : type === "win" ? 520 : type === "fold" ? 130 : 320;
      osc.type = type === "win" ? "sine" : "triangle"; osc.frequency.value = freq;
      gain.gain.setValueAtTime(.025, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .09);
      osc.connect(gain); gain.connect(audio.destination); osc.start(); osc.stop(audio.currentTime + .1);
    } catch (e) { /* Audio is optional. */ }
  }

  els.deal.addEventListener("click", startHand);
  els.fold.addEventListener("click", () => playerAction("fold"));
  els.call.addEventListener("click", () => playerAction("call"));
  els.raise.addEventListener("click", () => playerAction("raise"));
  els.range.addEventListener("input", () => { els.raiseValue.textContent = money(+els.range.value); });
  $("resetBtn").addEventListener("click", () => {
    if (!state.finished && !window.confirm("当前牌局还没结束，确定重置吗？")) return;
    state.players.forEach((p) => { p.chips = 2500; p.cards = []; p.bet = 0; p.folded = false; });
    state.community = []; state.pot = 0; state.currentBet = 0; state.street = "idle"; state.finished = true; state.locked = false; state.logs = [];
    els.log.innerHTML = '<li class="empty-log"><span>♣</span><p>筹码已经重置<br>准备开始新牌局</p></li>';
    els.status.textContent = "筹码已重置，准备发牌"; render(); toast("所有玩家恢复 2,500 筹码");
  });
  els.sound.addEventListener("click", () => { state.sound = !state.sound; els.sound.setAttribute("aria-pressed", String(state.sound)); els.sound.textContent = state.sound ? "♪" : "×"; toast(state.sound ? "音效已开启" : "音效已关闭"); });
  const rulesDialog = $("rulesDialog");
  $("rulesOpen").addEventListener("click", () => rulesDialog.showModal());
  $("rulesClose").addEventListener("click", () => rulesDialog.close());
  rulesDialog.addEventListener("click", (event) => { if (event.target === rulesDialog) rulesDialog.close(); });
  $("logToggle").addEventListener("click", () => document.body.classList.add("log-open"));
  $("logClose").addEventListener("click", () => document.body.classList.remove("log-open"));
  document.addEventListener("keydown", (event) => {
    if (/input/i.test(event.target.tagName)) return;
    const k = event.key.toLowerCase();
    if (k === "f" && !els.fold.disabled) playerAction("fold");
    if (k === "c" && !els.call.disabled) playerAction("call");
    if (k === "r" && !els.raise.disabled) playerAction("raise");
  });

  render();
})();
