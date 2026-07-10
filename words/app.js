const WORDS = [
  { word: "apple", phonetic: "/ˈæpəl/", part: "名词", meaning: "苹果", image: "assets/apple.jpg", example: "An apple a day keeps the doctor away." },
  { word: "bicycle", phonetic: "/ˈbaɪsɪkəl/", part: "名词", meaning: "自行车", image: "assets/bicycle.jpg", example: "I ride my bicycle to the park." },
  { word: "camera", phonetic: "/ˈkæmərə/", part: "名词", meaning: "相机", image: "assets/camera.jpg", example: "She takes a photo with her camera." },
  { word: "coffee", phonetic: "/ˈkɔːfi/", part: "名词", meaning: "咖啡", image: "assets/coffee.jpg", example: "The coffee smells wonderful." },
  { word: "sunflower", phonetic: "/ˈsʌnflaʊər/", part: "名词", meaning: "向日葵", image: "assets/sunflower.jpg", example: "The sunflower turns toward the sun." },
  { word: "key", phonetic: "/kiː/", part: "名词", meaning: "钥匙", image: "assets/key.jpg", example: "This key opens the front door." },
  { word: "rain", phonetic: "/reɪn/", part: "名词", meaning: "雨", image: "assets/rain.jpg", example: "We listened to the rain." },
  { word: "clock", phonetic: "/klɒk/", part: "名词", meaning: "时钟", image: "assets/clock.jpg", example: "The clock is on the wall." }
];

const els = {
  quizScreen: document.querySelector("#quizScreen"),
  resultScreen: document.querySelector("#resultScreen"),
  wordTitle: document.querySelector("#wordTitle"),
  phonetic: document.querySelector("#phonetic"),
  part: document.querySelector("#partOfSpeech"),
  choiceGrid: document.querySelector("#choiceGrid"),
  current: document.querySelector("#currentNumber"),
  total: document.querySelector("#totalNumber"),
  score: document.querySelector("#scoreCount"),
  progress: document.querySelector("#progressFill"),
  feedback: document.querySelector("#feedback"),
  feedbackIcon: document.querySelector("#feedbackIcon"),
  feedbackTitle: document.querySelector("#feedbackTitle"),
  feedbackMeaning: document.querySelector("#feedbackMeaning"),
  feedbackExample: document.querySelector("#feedbackExample"),
  continueButton: document.querySelector("#continueButton"),
  speakButton: document.querySelector("#speakButton"),
  soundToggle: document.querySelector("#soundToggle"),
  streak: document.querySelector("#streakCount"),
  restartButton: document.querySelector("#restartButton"),
  finalCorrect: document.querySelector("#finalCorrect"),
  finalAccuracy: document.querySelector("#finalAccuracy"),
  bestScore: document.querySelector("#bestScore"),
  resultLead: document.querySelector("#resultLead"),
  reviewList: document.querySelector("#reviewList"),
  reviewWords: document.querySelector("#reviewWords")
};

let round = [];
let currentIndex = 0;
let score = 0;
let answered = false;
let mistakes = [];
let soundEnabled = true;
let feedbackHideTimer = null;
let feedbackFocusTimer = null;

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function safeGet(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch (_) { return fallback; }
}

function safeSet(key, value) {
  try { localStorage.setItem(key, value); } catch (_) { /* storage is optional */ }
}

function updateStreak() {
  const today = new Date().toLocaleDateString("en-CA");
  const lastVisit = safeGet("word-garden-last-visit", "");
  let streak = Number(safeGet("word-garden-streak", "0"));

  if (lastVisit !== today) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = yesterday.toLocaleDateString("en-CA");
    streak = lastVisit === yesterdayKey ? streak + 1 : 1;
    safeSet("word-garden-last-visit", today);
    safeSet("word-garden-streak", String(streak));
  }
  els.streak.textContent = String(Math.max(streak, 1));
}

function startRound() {
  round = shuffle(WORDS);
  currentIndex = 0;
  score = 0;
  answered = false;
  mistakes = [];
  els.total.textContent = String(round.length);
  els.score.textContent = "0";
  els.resultScreen.hidden = true;
  els.quizScreen.hidden = false;
  hideFeedback(true);
  renderQuestion();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function getChoices(correct) {
  const distractors = shuffle(WORDS.filter(item => item.word !== correct.word)).slice(0, 3);
  return shuffle([correct, ...distractors]);
}

function renderQuestion() {
  answered = false;
  const item = round[currentIndex];
  const choices = getChoices(item);

  els.current.textContent = String(currentIndex + 1);
  els.progress.style.width = `${((currentIndex + 1) / round.length) * 100}%`;
  els.wordTitle.textContent = item.word;
  els.phonetic.textContent = item.phonetic;
  els.part.textContent = item.part;
  document.title = `${item.word} · 单词花园`;
  els.choiceGrid.replaceChildren();

  choices.forEach((choice, index) => {
    const button = document.createElement("button");
    button.className = "choice-card";
    button.type = "button";
    button.dataset.word = choice.word;
    button.setAttribute("aria-label", `选项 ${index + 1}`);
    button.innerHTML = `
      <img src="${choice.image}" alt="" width="720" height="720" ${index === 0 ? "fetchpriority=high" : ""}>
      <span class="choice-number" aria-hidden="true">${index + 1}</span>
      <span class="choice-state" aria-hidden="true"></span>`;
    button.addEventListener("click", () => chooseAnswer(button, choice));
    els.choiceGrid.append(button);
  });
}

function chooseAnswer(button, choice) {
  if (answered) return;
  answered = true;

  const correct = round[currentIndex];
  const isCorrect = choice.word === correct.word;
  const buttons = [...els.choiceGrid.querySelectorAll(".choice-card")];

  buttons.forEach(card => {
    card.disabled = true;
    const state = card.querySelector(".choice-state");
    if (card.dataset.word === correct.word) {
      card.classList.add("correct");
      state.textContent = "✓";
    } else if (card === button) {
      card.classList.add("wrong");
      state.textContent = "×";
    } else {
      card.classList.add("dimmed");
    }
  });

  if (isCorrect) {
    score += 1;
    els.score.textContent = String(score);
    showFeedback("correct", "答对了，很棒！", correct);
    playTone(520, 0.09, "sine");
    window.setTimeout(() => playTone(690, 0.11, "sine"), 90);
  } else {
    mistakes.push(correct);
    showFeedback("wrong", `差一点，${correct.word} 是这个`, correct);
    playTone(190, 0.13, "triangle");
  }
}

function showFeedback(kind, title, item) {
  if (feedbackHideTimer) {
    window.clearTimeout(feedbackHideTimer);
    feedbackHideTimer = null;
  }
  if (feedbackFocusTimer) window.clearTimeout(feedbackFocusTimer);
  els.feedback.dataset.kind = kind;
  els.feedbackIcon.textContent = kind === "correct" ? "✓" : "×";
  els.feedbackTitle.textContent = title;
  els.feedbackMeaning.textContent = `${item.word} · ${item.meaning}`;
  els.feedbackExample.textContent = item.example;
  els.continueButton.textContent = currentIndex === round.length - 1 ? "查看结果 →" : "继续 →";
  els.feedback.hidden = false;
  requestAnimationFrame(() => els.feedback.classList.add("show"));
  feedbackFocusTimer = window.setTimeout(() => {
    els.continueButton.focus();
    feedbackFocusTimer = null;
  }, 200);
}

function hideFeedback(immediate = false) {
  if (feedbackHideTimer) {
    window.clearTimeout(feedbackHideTimer);
    feedbackHideTimer = null;
  }
  if (feedbackFocusTimer) {
    window.clearTimeout(feedbackFocusTimer);
    feedbackFocusTimer = null;
  }
  els.feedback.classList.remove("show");
  if (immediate) {
    els.feedback.hidden = true;
  } else {
    feedbackHideTimer = window.setTimeout(() => {
      els.feedback.hidden = true;
      feedbackHideTimer = null;
    }, 320);
  }
}

function continueRound() {
  if (!answered) return;
  if (currentIndex >= round.length - 1) {
    finishRound();
    return;
  }
  hideFeedback();
  currentIndex += 1;
  renderQuestion();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function finishRound() {
  hideFeedback(true);
  els.quizScreen.hidden = true;
  els.resultScreen.hidden = false;
  document.title = "练习完成 · 单词花园";

  const accuracy = Math.round((score / round.length) * 100);
  const previousBest = Number(safeGet("word-garden-best", "0"));
  const best = Math.max(previousBest, score);
  safeSet("word-garden-best", String(best));

  els.finalCorrect.textContent = String(score);
  els.finalAccuracy.textContent = `${accuracy}%`;
  els.bestScore.textContent = String(best);
  els.resultLead.textContent = accuracy === 100
    ? "全对！图片和单词已经牢牢连在一起了。"
    : accuracy >= 75
      ? "完成得很好，再看一眼易错词会记得更牢。"
      : "每次辨认都在加深记忆，再来一轮吧。";

  const uniqueMistakes = [...new Map(mistakes.map(item => [item.word, item])).values()];
  els.reviewWords.replaceChildren();
  if (uniqueMistakes.length) {
    uniqueMistakes.forEach(item => {
      const chip = document.createElement("span");
      chip.className = "review-chip";
      chip.innerHTML = `<strong>${item.word}</strong>${item.meaning}`;
      els.reviewWords.append(chip);
    });
    els.reviewList.hidden = false;
  } else {
    els.reviewList.hidden = true;
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
  window.setTimeout(() => els.restartButton.focus(), 250);
}

function speakWord() {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(round[currentIndex].word);
  utterance.lang = "en-US";
  utterance.rate = 0.82;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

function playTone(frequency, duration, type) {
  if (!soundEnabled || !(window.AudioContext || window.webkitAudioContext)) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.055, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + duration);
  oscillator.addEventListener("ended", () => context.close());
}

els.continueButton.addEventListener("click", continueRound);
els.restartButton.addEventListener("click", startRound);
els.speakButton.addEventListener("click", speakWord);
els.soundToggle.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  els.soundToggle.setAttribute("aria-pressed", String(soundEnabled));
  els.soundToggle.setAttribute("aria-label", soundEnabled ? "关闭音效" : "打开音效");
  safeSet("word-garden-sound", soundEnabled ? "on" : "off");
});

document.addEventListener("keydown", event => {
  if (!els.quizScreen.hidden && !answered && /^[1-4]$/.test(event.key)) {
    const choice = els.choiceGrid.children[Number(event.key) - 1];
    if (choice) choice.click();
  }
  if (event.key === "Enter" && answered && !els.feedback.hidden) {
    event.preventDefault();
    continueRound();
  }
});

soundEnabled = safeGet("word-garden-sound", "on") !== "off";
els.soundToggle.setAttribute("aria-pressed", String(soundEnabled));
els.soundToggle.setAttribute("aria-label", soundEnabled ? "关闭音效" : "打开音效");
updateStreak();
startRound();
