const WORD_SOURCE_URL = "总单词.txt";
const ROUND_SIZE = 10;
const GARDEN_MAX_LEVEL = 1000;
const CHOICE_COUNT = 4;
const IMAGE_BATCH_SIZE = 8;
const OPENVERSE_IMAGE_API = "https://api.openverse.org/v1/images/";
const DICTIONARY_AUDIO_API = "https://api.dictionaryapi.dev/api/v2/entries/en/";
const IMAGE_CACHE_KEY = "word-garden-openverse-cache-v2";
const IMAGE_CACHE_LIMIT = 360;
const AUDIO_CACHE_KEY = "word-garden-pronunciation-cache-v1";
const AUDIO_CACHE_LIMIT = 360;
const GARDEN_VITALITY_KEY = "word-garden-completed-sets-v2";
const MASTERED_WORDS_KEY = "word-garden-mastered-words-v1";
const FALLBACK_WORDS = Array.isArray(window.WORD_GARDEN_WORDS) ? window.WORD_GARDEN_WORDS : [];
const VISUAL_WORDS = {
  apple: { meaning: "苹果", query: "red apple fruit" },
  banana: { meaning: "香蕉", query: "banana fruit" },
  orange: { meaning: "橙子", query: "orange fruit" },
  grape: { meaning: "葡萄", query: "grapes fruit" },
  watermelon: { meaning: "西瓜", query: "watermelon fruit" },
  strawberry: { meaning: "草莓", query: "strawberry fruit" },
  peach: { meaning: "桃子", query: "peach fruit" },
  pear: { meaning: "梨", query: "pear fruit" },
  mango: { meaning: "芒果", query: "mango fruit" },
  lemon: { meaning: "柠檬", query: "lemon fruit" },
  cherry: { meaning: "樱桃", query: "cherry fruit" },
  pineapple: { meaning: "菠萝", query: "pineapple fruit" },
  kiwi: { meaning: "猕猴桃", query: "kiwi fruit" },
  tomato: { meaning: "西红柿", query: "tomato vegetable" },
  potato: { meaning: "土豆", query: "potato vegetable" },
  carrot: { meaning: "胡萝卜", query: "carrot vegetable" },
  corn: { meaning: "玉米", query: "corn vegetable" },
  onion: { meaning: "洋葱", query: "onion vegetable" },
  mushroom: { meaning: "蘑菇", query: "mushroom food" },
  bread: { meaning: "面包", query: "loaf bread food" },
  rice: { meaning: "米饭", query: "cooked rice bowl" },
  noodle: { meaning: "面条", query: "noodles bowl food" },
  egg: { meaning: "鸡蛋", query: "egg food" },
  milk: { meaning: "牛奶", query: "glass of milk" },
  juice: { meaning: "果汁", query: "orange juice glass" },
  tea: { meaning: "茶", query: "cup of tea" },
  cake: { meaning: "蛋糕", query: "cake dessert" },
  cookie: { meaning: "饼干", query: "cookie biscuit" },
  candy: { meaning: "糖果", query: "colorful candy" },
  pizza: { meaning: "披萨", query: "pizza food" },
  burger: { meaning: "汉堡", query: "hamburger food" },
  cheese: { meaning: "奶酪", query: "cheese food" },
  chocolate: { meaning: "巧克力", query: "chocolate bar" },
  cat: { meaning: "猫", query: "domestic cat animal" },
  dog: { meaning: "狗", query: "dog animal" },
  fish: { meaning: "鱼", query: "fish animal" },
  panda: { meaning: "熊猫", query: "giant panda animal" },
  rabbit: { meaning: "兔子", query: "rabbit animal" },
  zebra: { meaning: "斑马", query: "zebra animal" },
  elephant: { meaning: "大象", query: "elephant animal" },
  lion: { meaning: "狮子", query: "lion animal" },
  tiger: { meaning: "老虎", query: "tiger animal" },
  horse: { meaning: "马", query: "horse animal" },
  cow: { meaning: "奶牛", query: "cow animal" },
  pig: { meaning: "猪", query: "pig animal" },
  sheep: { meaning: "绵羊", query: "sheep animal" },
  duck: { meaning: "鸭子", query: "duck animal" },
  chicken: { meaning: "鸡", query: "chicken bird animal" },
  monkey: { meaning: "猴子", query: "monkey animal" },
  bear: { meaning: "熊", query: "bear animal" },
  frog: { meaning: "青蛙", query: "frog animal" },
  snake: { meaning: "蛇", query: "snake animal" },
  turtle: { meaning: "乌龟", query: "turtle animal" },
  whale: { meaning: "鲸鱼", query: "whale animal" },
  dolphin: { meaning: "海豚", query: "dolphin animal" },
  shark: { meaning: "鲨鱼", query: "shark animal" },
  butterfly: { meaning: "蝴蝶", query: "butterfly insect" },
  bee: { meaning: "蜜蜂", query: "bee insect" },
  ant: { meaning: "蚂蚁", query: "ant insect" },
  spider: { meaning: "蜘蛛", query: "spider animal" },
  ladybug: { meaning: "瓢虫", query: "ladybug insect" },
  penguin: { meaning: "企鹅", query: "penguin animal" },
  giraffe: { meaning: "长颈鹿", query: "giraffe animal" },
  parrot: { meaning: "鹦鹉", query: "parrot bird" },
  fox: { meaning: "狐狸", query: "fox animal" },
  wolf: { meaning: "狼", query: "wolf animal" },
  squirrel: { meaning: "松鼠", query: "squirrel animal" },
  camel: { meaning: "骆驼", query: "camel animal" },
  deer: { meaning: "鹿", query: "deer animal" },
  eagle: { meaning: "鹰", query: "eagle bird" },
  owl: { meaning: "猫头鹰", query: "owl bird" },
  crab: { meaning: "螃蟹", query: "crab animal" },
  eye: { meaning: "眼睛", query: "human eye" },
  ear: { meaning: "耳朵", query: "human ear" },
  nose: { meaning: "鼻子", query: "human nose" },
  mouth: { meaning: "嘴巴", query: "human mouth" },
  hand: { meaning: "手", query: "human hand" },
  foot: { meaning: "脚", query: "human foot" },
  arm: { meaning: "手臂", query: "human arm" },
  leg: { meaning: "腿", query: "human leg" },
  finger: { meaning: "手指", query: "human finger" },
  hair: { meaning: "头发", query: "human hair" },
  head: { meaning: "头", query: "human head" },
  face: { meaning: "脸", query: "human face" },
  teeth: { meaning: "牙齿", query: "human teeth" },
  tongue: { meaning: "舌头", query: "human tongue" },
  neck: { meaning: "脖子", query: "human neck" },
  knee: { meaning: "膝盖", query: "human knee" },
  elbow: { meaning: "肘部", query: "human elbow" },
  shoulder: { meaning: "肩膀", query: "human shoulder" },
  thumb: { meaning: "拇指", query: "thumb hand" },
  baby: { meaning: "婴儿", query: "baby person" },
  teacher: { meaning: "老师", query: "teacher classroom" },
  doctor: { meaning: "医生", query: "doctor medical" },
  nurse: { meaning: "护士", query: "nurse medical" },
  policeman: { meaning: "警察", query: "police officer" },
  fireman: { meaning: "消防员", query: "firefighter" },
  farmer: { meaning: "农民", query: "farmer field" },
  cook: { meaning: "厨师", query: "cook chef kitchen" },
  book: { meaning: "书", query: "book object" },
  pen: { meaning: "钢笔", query: "pen stationery" },
  pencil: { meaning: "铅笔", query: "pencil stationery" },
  ruler: { meaning: "尺子", query: "ruler stationery" },
  eraser: { meaning: "橡皮", query: "eraser stationery" },
  desk: { meaning: "书桌", query: "desk furniture" },
  chair: { meaning: "椅子", query: "chair furniture" },
  bag: { meaning: "包", query: "school bag backpack" },
  school: { meaning: "学校", query: "school building" },
  paper: { meaning: "纸", query: "paper sheets" },
  notebook: { meaning: "笔记本", query: "notebook stationery" },
  scissors: { meaning: "剪刀", query: "scissors tool" },
  glue: { meaning: "胶水", query: "glue bottle" },
  map: { meaning: "地图", query: "paper map" },
  globe: { meaning: "地球仪", query: "globe object" },
  bell: { meaning: "铃", query: "bell object" },
  blackboard: { meaning: "黑板", query: "blackboard classroom" },
  crayon: { meaning: "蜡笔", query: "crayons" },
  clock: { meaning: "时钟", query: "wall clock" },
  computer: { meaning: "电脑", query: "computer laptop" },
  sun: { meaning: "太阳", query: "sun sky" },
  moon: { meaning: "月亮", query: "moon night sky" },
  star: { meaning: "星星", query: "star night sky" },
  tree: { meaning: "树", query: "tree nature" },
  cloud: { meaning: "云", query: "cloud sky" },
  rain: { meaning: "雨", query: "rain weather" },
  snow: { meaning: "雪", query: "snow weather" },
  flower: { meaning: "花", query: "flower plant" },
  rose: { meaning: "玫瑰", query: "rose flower" },
  leaf: { meaning: "叶子", query: "green leaf" },
  river: { meaning: "河流", query: "river nature" },
  lake: { meaning: "湖", query: "lake nature" },
  sea: { meaning: "海", query: "sea ocean" },
  mountain: { meaning: "山", query: "mountain landscape" },
  forest: { meaning: "森林", query: "forest trees" },
  island: { meaning: "岛屿", query: "island landscape" },
  beach: { meaning: "海滩", query: "beach sea" },
  rainbow: { meaning: "彩虹", query: "rainbow sky" },
  fire: { meaning: "火", query: "fire flame" },
  rock: { meaning: "岩石", query: "rock stone" },
  grass: { meaning: "草", query: "green grass" },
  ice: { meaning: "冰", query: "ice cubes" },
  stone: { meaning: "石头", query: "stone rock" },
  door: { meaning: "门", query: "door object" },
  window: { meaning: "窗户", query: "window house" },
  key: { meaning: "钥匙", query: "key object" },
  bed: { meaning: "床", query: "bed furniture" },
  table: { meaning: "桌子", query: "table furniture" },
  sofa: { meaning: "沙发", query: "sofa furniture" },
  lamp: { meaning: "台灯", query: "lamp object" },
  mirror: { meaning: "镜子", query: "mirror object" },
  phone: { meaning: "电话", query: "phone smartphone" },
  cup: { meaning: "杯子", query: "cup object" },
  plate: { meaning: "盘子", query: "plate dish" },
  bowl: { meaning: "碗", query: "bowl dish" },
  spoon: { meaning: "勺子", query: "spoon utensil" },
  fork: { meaning: "叉子", query: "fork utensil" },
  knife: { meaning: "刀", query: "kitchen knife utensil" },
  towel: { meaning: "毛巾", query: "towel" },
  soap: { meaning: "肥皂", query: "soap bar" },
  toothbrush: { meaning: "牙刷", query: "toothbrush" },
  pillow: { meaning: "枕头", query: "pillow" },
  blanket: { meaning: "毯子", query: "blanket" },
  basket: { meaning: "篮子", query: "basket" },
  umbrella: { meaning: "雨伞", query: "umbrella" },
  candle: { meaning: "蜡烛", query: "candle" },
  gift: { meaning: "礼物", query: "gift box" },
  box: { meaning: "盒子", query: "cardboard box" },
  bottle: { meaning: "瓶子", query: "bottle object" },
  ring: { meaning: "戒指", query: "ring jewelry" },
  hammer: { meaning: "锤子", query: "hammer tool" },
  ladder: { meaning: "梯子", query: "ladder tool" },
  rope: { meaning: "绳子", query: "rope" },
  car: { meaning: "汽车", query: "car vehicle" },
  bus: { meaning: "公共汽车", query: "bus vehicle" },
  bike: { meaning: "自行车", query: "bicycle vehicle" },
  bicycle: { meaning: "自行车", query: "bicycle vehicle" },
  train: { meaning: "火车", query: "train vehicle" },
  plane: { meaning: "飞机", query: "airplane vehicle" },
  boat: { meaning: "小船", query: "boat vehicle" },
  ship: { meaning: "轮船", query: "ship vessel" },
  truck: { meaning: "卡车", query: "truck vehicle" },
  taxi: { meaning: "出租车", query: "taxi car" },
  helicopter: { meaning: "直升机", query: "helicopter aircraft" },
  rocket: { meaning: "火箭", query: "rocket spacecraft" },
  motorcycle: { meaning: "摩托车", query: "motorcycle vehicle" },
  tractor: { meaning: "拖拉机", query: "tractor vehicle" },
  scooter: { meaning: "滑板车", query: "scooter vehicle" },
  submarine: { meaning: "潜水艇", query: "submarine vehicle" },
  van: { meaning: "货车", query: "van vehicle" },
  sailboat: { meaning: "帆船", query: "sailboat" },
  balloon: { meaning: "气球", query: "balloon" },
  kite: { meaning: "风筝", query: "kite toy" },
  hat: { meaning: "帽子", query: "hat clothing" },
  shirt: { meaning: "衬衫", query: "shirt clothing" },
  pants: { meaning: "裤子", query: "pants clothing" },
  dress: { meaning: "连衣裙", query: "dress clothing" },
  shoes: { meaning: "鞋子", query: "shoes footwear" },
  socks: { meaning: "袜子", query: "socks clothing" },
  coat: { meaning: "外套", query: "coat clothing" },
  jacket: { meaning: "夹克", query: "jacket clothing" },
  gloves: { meaning: "手套", query: "gloves clothing" },
  scarf: { meaning: "围巾", query: "scarf clothing" },
  boots: { meaning: "靴子", query: "boots footwear" },
  sweater: { meaning: "毛衣", query: "sweater clothing" },
  skirt: { meaning: "裙子", query: "skirt clothing" },
  tie: { meaning: "领带", query: "necktie clothing" },
  crown: { meaning: "王冠", query: "crown object" },
  ball: { meaning: "球", query: "ball toy" },
  doll: { meaning: "玩偶", query: "doll toy" },
  drum: { meaning: "鼓", query: "drum instrument" },
  guitar: { meaning: "吉他", query: "guitar instrument" },
  piano: { meaning: "钢琴", query: "piano instrument" },
  swing: { meaning: "秋千", query: "playground swing" },
  slide: { meaning: "滑梯", query: "playground slide" },
  puzzle: { meaning: "拼图", query: "jigsaw puzzle" },
  camera: { meaning: "相机", query: "camera object" },
  television: { meaning: "电视", query: "television object" },
  flag: { meaning: "旗帜", query: "flag object" },
  tent: { meaning: "帐篷", query: "camping tent" },
  trophy: { meaning: "奖杯", query: "trophy cup" },
  anchor: { meaning: "锚", query: "ship anchor" },
  feather: { meaning: "羽毛", query: "feather" },
  nest: { meaning: "鸟巢", query: "bird nest" },
  shell: { meaning: "贝壳", query: "seashell" },
  sand: { meaning: "沙子", query: "sand beach" },
  park: { meaning: "公园", query: "park landscape" },
  zoo: { meaning: "动物园", query: "zoo entrance" },
  farm: { meaning: "农场", query: "farm field" },
  hospital: { meaning: "医院", query: "hospital building" },
  library: { meaning: "图书馆", query: "library building" },
  restaurant: { meaning: "餐厅", query: "restaurant dining room" },
  hotel: { meaning: "酒店", query: "hotel building" },
  airport: { meaning: "机场", query: "airport terminal" },
  cinema: { meaning: "电影院", query: "cinema theater" },
  museum: { meaning: "博物馆", query: "museum building" },
  garden: { meaning: "花园", query: "garden flowers" },
  market: { meaning: "市场", query: "market stalls" },
  castle: { meaning: "城堡", query: "castle building" },
  tower: { meaning: "塔", query: "tower building" },
  bamboo: { meaning: "竹子", query: "bamboo plant" },
  bathroom: { meaning: "浴室", query: "bathroom interior" },
  bean: { meaning: "豆子", query: "beans food" },
  bedroom: { meaning: "卧室", query: "bedroom interior" },
  beef: { meaning: "牛肉", query: "beef food" },
  bird: { meaning: "鸟", query: "bird animal" },
  biscuit: { meaning: "饼干", query: "biscuit cookie" },
  blouse: { meaning: "女式衬衫", query: "blouse clothing" },
  board: { meaning: "木板", query: "wooden board" },
  building: { meaning: "建筑物", query: "building exterior" },
  cap: { meaning: "帽子", query: "baseball cap" },
  card: { meaning: "卡片", query: "playing card" },
  chalk: { meaning: "粉笔", query: "chalk sticks" },
  chess: { meaning: "国际象棋", query: "chess board pieces" },
  chopsticks: { meaning: "筷子", query: "chopsticks" },
  classroom: { meaning: "教室", query: "classroom" }
};

const EMOJI_VISUALS = {
  apple: "🍎", banana: "🍌", orange: "🍊", grape: "🍇", watermelon: "🍉", strawberry: "🍓", peach: "🍑", pear: "🍐", mango: "🥭", lemon: "🍋", cherry: "🍒", pineapple: "🍍", kiwi: "🥝", tomato: "🍅", potato: "🥔", carrot: "🥕", corn: "🌽", onion: "🧅", mushroom: "🍄",
  bread: "🍞", rice: "🍚", noodle: "🍜", egg: "🥚", milk: "🥛", juice: "🧃", tea: "🍵", cake: "🍰", cookie: "🍪", candy: "🍬", pizza: "🍕", burger: "🍔", cheese: "🧀", chocolate: "🍫",
  cat: "🐱", dog: "🐶", fish: "🐟", panda: "🐼", rabbit: "🐰", zebra: "🦓", elephant: "🐘", lion: "🦁", tiger: "🐯", horse: "🐴", cow: "🐮", pig: "🐷", sheep: "🐑", duck: "🦆", chicken: "🐔", monkey: "🐵", bear: "🐻", frog: "🐸", snake: "🐍", turtle: "🐢", whale: "🐋", dolphin: "🐬", shark: "🦈", butterfly: "🦋", bee: "🐝", ant: "🐜", spider: "🕷️", ladybug: "🐞", penguin: "🐧", giraffe: "🦒", parrot: "🦜", fox: "🦊", wolf: "🐺", squirrel: "🐿️", camel: "🐫", deer: "🦌", eagle: "🦅", owl: "🦉", crab: "🦀",
  eye: "👁️", ear: "👂", nose: "👃", mouth: "👄", hand: "✋", foot: "🦶", arm: "💪", leg: "🦵", finger: "☝️", hair: "💇", head: "🙂", face: "😀", teeth: "🦷", tongue: "👅", neck: "🧍", knee: "🦵", elbow: "💪", shoulder: "🤷", thumb: "👍", baby: "👶",
  teacher: "🧑‍🏫", doctor: "🧑‍⚕️", nurse: "👩‍⚕️", policeman: "👮", fireman: "🧑‍🚒", farmer: "🧑‍🌾", cook: "🧑‍🍳",
  book: "📖", pen: "🖊️", pencil: "✏️", ruler: "📏", eraser: "🧽", desk: "🧑‍💻", chair: "🪑", bag: "🎒", school: "🏫", paper: "📄", notebook: "📓", scissors: "✂️", glue: "🧴", map: "🗺️", globe: "🌐", bell: "🔔", blackboard: "⬛", crayon: "🖍️", clock: "🕰️", computer: "💻",
  sun: "☀️", moon: "🌙", star: "⭐", tree: "🌳", cloud: "☁️", rain: "🌧️", snow: "❄️", flower: "🌸", rose: "🌹", leaf: "🍃", river: "🏞️", lake: "🏞️", sea: "🌊", mountain: "⛰️", forest: "🌲", island: "🏝️", beach: "🏖️", rainbow: "🌈", fire: "🔥", rock: "🪨", grass: "🌿", ice: "🧊", stone: "🪨", bamboo: "🎋",
  door: "🚪", window: "🪟", key: "🔑", bed: "🛏️", table: "🪑", sofa: "🛋️", lamp: "💡", mirror: "🪞", phone: "📱", cup: "☕", plate: "🍽️", bowl: "🥣", spoon: "🥄", fork: "🍴", knife: "🔪", towel: "🧺", soap: "🧼", toothbrush: "🪥", pillow: "🛏️", blanket: "🛌", basket: "🧺", umbrella: "☂️", candle: "🕯️", gift: "🎁", box: "📦", bottle: "🍾", ring: "💍", hammer: "🔨", ladder: "🪜", rope: "🪢",
  car: "🚗", bus: "🚌", bike: "🚲", bicycle: "🚲", train: "🚆", plane: "✈️", boat: "⛵", ship: "🚢", truck: "🚚", taxi: "🚕", helicopter: "🚁", rocket: "🚀", motorcycle: "🏍️", tractor: "🚜", scooter: "🛴", submarine: "🚢", van: "🚐", sailboat: "⛵",
  balloon: "🎈", kite: "🪁", hat: "🎩", shirt: "👕", pants: "👖", dress: "👗", shoes: "👟", socks: "🧦", coat: "🧥", jacket: "🧥", gloves: "🧤", scarf: "🧣", boots: "🥾", sweater: "🧥", skirt: "👗", tie: "👔", crown: "👑",
  ball: "⚽", doll: "🧸", drum: "🥁", guitar: "🎸", piano: "🎹", swing: "🛝", slide: "🛝", puzzle: "🧩", camera: "📷", television: "📺", flag: "🚩", tent: "⛺", trophy: "🏆", anchor: "⚓", feather: "🪶", nest: "🪺", shell: "🐚", sand: "🏖️",
  park: "🏞️", zoo: "🦁", farm: "🚜", hospital: "🏥", library: "🏛️", restaurant: "🍽️", hotel: "🏨", airport: "🛫", cinema: "🎬", museum: "🏛️", garden: "🌷", market: "🛒", castle: "🏰", tower: "🗼", bathroom: "🛁", bean: "🫘", bedroom: "🛏️", beef: "🥩", bird: "🐦", biscuit: "🍪", blouse: "👚", board: "🪵", building: "🏢", cap: "🧢", card: "🃏", chalk: "🖍️", chess: "♟️", chopsticks: "🥢", classroom: "🏫"
};

const els = {
  homeScreen: document.querySelector("#homeScreen"),
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
  totalWords: document.querySelector("#totalWordCount"),
  masteredWords: document.querySelector("#masteredWordCount"),
  gardenLifetime: document.querySelector("#gardenLifetimeCount"),
  gardenLevel: document.querySelector("#gardenLevelCount"),
  gardenMaxLevel: document.querySelector("#gardenMaxLevel"),
  gardenStageLabel: document.querySelector("#gardenStageLabel"),
  gardenStageSummary: document.querySelector("#gardenStageSummary"),
  gardenProgressText: document.querySelector("#gardenProgressText"),
  gardenProgressFill: document.querySelector("#gardenProgressFill"),
  gardenEntities: document.querySelector("#gardenEntities"),
  gardenScene: document.querySelector("#gardenScene"),
  gardenBoost: document.querySelector("#gardenBoost"),
  gardenAnnouncement: document.querySelector("#gardenAnnouncement"),
  startButton: document.querySelector("#startButton"),
  homeStatus: document.querySelector("#homeStatus"),
  feedback: document.querySelector("#feedback"),
  feedbackIcon: document.querySelector("#feedbackIcon"),
  feedbackTitle: document.querySelector("#feedbackTitle"),
  feedbackMeaning: document.querySelector("#feedbackMeaning"),
  feedbackExample: document.querySelector("#feedbackExample"),
  continueButton: document.querySelector("#continueButton"),
  speakButton: document.querySelector("#speakButton"),
  soundToggle: document.querySelector("#soundToggle"),
  streak: document.querySelector("#streakCount"),
  homeButton: document.querySelector("#homeButton"),
  restartButton: document.querySelector("#restartButton"),
  finalCorrect: document.querySelector("#finalCorrect"),
  finalAccuracy: document.querySelector("#finalAccuracy"),
  bestScore: document.querySelector("#bestScore"),
  resultTitle: document.querySelector("#resultTitle"),
  resultLead: document.querySelector("#resultLead"),
  reviewList: document.querySelector("#reviewList"),
  reviewWords: document.querySelector("#reviewWords")
};

let wordBank = [];
let round = [];
let currentQuestion = null;
let currentIndex = 0;
let wordCursor = 0;
let score = 0;
let answered = false;
let mistakes = [];
let soundEnabled = true;
let feedbackHideTimer = null;
let feedbackFocusTimer = null;
let autoAdvanceTimer = null;
let gardenBoostTimer = null;
let renderToken = 0;
let imageCache = loadImageCache();
let audioCache = loadAudioCache();
let nextQuestion = null;
let nextQuestionPromise = null;
let preferredVoice = null;
let roundRewardGranted = false;
let pendingGardenReveal = false;
let masteredWords = new Set();
const imageMisses = new Set();
const audioPromises = new Map();

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

function loadMasteredWords() {
  try {
    const saved = JSON.parse(localStorage.getItem(MASTERED_WORDS_KEY) || "[]");
    return new Set(Array.isArray(saved) ? saved.filter(word => typeof word === "string") : []);
  } catch (_) {
    return new Set();
  }
}

function saveMasteredWords() {
  safeSet(MASTERED_WORDS_KEY, JSON.stringify([...masteredWords].sort()));
}

function getRemainingWords() {
  return wordBank.filter(item => !masteredWords.has(item.word));
}

function getRoundSize() {
  return Math.min(ROUND_SIZE, round.length);
}

function setStartButtonText(title, detail = "") {
  const startCopy = els.startButton.querySelector("span");
  const startDetail = els.startButton.querySelector("small");

  if (startCopy) {
    startCopy.textContent = title;
    if (startDetail) startDetail.textContent = detail;
    return;
  }

  els.startButton.textContent = detail ? `${title} · ${detail}` : title;
}

function updateLearningDashboard() {
  const total = wordBank.length;
  const learned = masteredWords.size;
  const remaining = Math.max(0, total - learned);
  els.totalWords.textContent = String(total);
  els.masteredWords.textContent = String(learned);

  if (!total) return;

  const allMastered = remaining === 0;
  els.startButton.disabled = allMastered;
  setStartButtonText(
    allMastered ? "全部单词已学会" : "开始一组练习",
    allMastered ? "花园已经盛开" : `剩余 ${remaining} 个待学习单词`
  );
  els.homeStatus.textContent = allMastered
    ? `词库中的 ${total} 个单词都已学会，太棒了！`
    : `词库共 ${total} 个单词，已学会 ${learned} 个，还剩 ${remaining} 个`;
}

function markWordMastered(word) {
  if (masteredWords.has(word)) return false;
  masteredWords.add(word);
  saveMasteredWords();
  updateLearningDashboard();
  return true;
}

function getLifetimeVitality() {
  const value = Number(safeGet(GARDEN_VITALITY_KEY, "0"));
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), GARDEN_MAX_LEVEL) : 0;
}

const GARDEN_PHASES = [
  { threshold: 0, items: ["🪨", "🌱", "🍂"], size: .6, message: "广袤而荒芜的土地，偶尔可见几根杂草..." },
  { threshold: 100, items: ["🌱", "🌿", "🌾", "🍀"], size: .8, message: "绿意在平原上蔓延，种子破土而出。" },
  { threshold: 200, items: ["🌿", "🍀", "🪴", "🍄"], size: 1, message: "草地开始变得茂密，覆盖了大部分视野。" },
  { threshold: 300, items: ["🌷", "🥀", "🌼"], size: 1.2, message: "第一批野花点缀在辽阔的绿野之中。" },
  { threshold: 400, items: ["🌻", "🌼", "🌹"], size: 1.4, message: "花海初见雏形，五彩斑斓开始铺满大地！" },
  { threshold: 500, items: ["🌸", "🌺", "🌳", "🌲"], size: 1.8, message: "树木拔地而起，生态有了立体的层次感。" },
  { threshold: 600, items: ["🦋", "🐝", "🐞", "🦗"], size: 1, message: "昆虫群在花海上方翩翩起舞！" },
  { threshold: 700, items: ["🕊️", "🦜", "🦢", "🐇"], size: 1.2, message: "动物们将这里视为了庞大的生态乐园。" },
  { threshold: 800, items: ["🌲", "🍁", "🍄", "🌳"], size: 2.5, message: "巨树参天！前期的花草成为了森林的地毯。" },
  { threshold: 900, items: ["✨", "🧚", "🦄", "🔮"], size: 1.5, message: "魔力涌动！整个平原散发出奇幻的光芒！" },
  { threshold: 1000, items: ["🌟", "💎", "🌌", "🏰"], size: 2, message: "大功告成！这是传说中不朽的广袤魔法世界！" }
];

function getGardenMaxLevel() {
  return GARDEN_MAX_LEVEL;
}

function getGardenPhase(level) {
  return GARDEN_PHASES.reduce((current, phase) => (level >= phase.threshold ? phase : current), GARDEN_PHASES[0]);
}

function seededRandom(seed) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function createGardenEntity(index, level, animateLatest) {
  const birthLevel = index + 1;
  const phase = getGardenPhase(birthLevel);
  const entity = document.createElement("span");
  const random = seededRandom(birthLevel * 19.7 + 3);
  const depth = seededRandom(birthLevel * 7.1 + 11);
  const emoji = phase.items[Math.floor(seededRandom(index * 7.3 + birthLevel) * phase.items.length)];
  const distanceScale = 1 - depth * .55;
  const scale = phase.size * distanceScale * (.8 + seededRandom(birthLevel * 5.3) * .4);

  entity.className = "garden-entity";
  if (animateLatest && birthLevel === level) entity.classList.add("new-growth");
  entity.textContent = emoji;
  entity.style.left = `${2 + random * 94}%`;
  entity.style.bottom = `${depth * 90}%`;
  entity.style.zIndex = String(Math.floor(1000 - depth * 900));
  entity.style.setProperty("--entity-scale", scale.toFixed(2));
  entity.style.setProperty("--entity-tilt", "0deg");
  if (level > 850) entity.style.textShadow = "0 0 15px rgba(255,255,255,.9)";
  return entity;
}

function updateGardenEnvironment(level, maxLevel) {
  const ratio = maxLevel ? level / maxLevel : 0;
  let groundH = 35 + ratio * 80;
  const groundS = 25 + ratio * 45;
  let groundL = 55 - ratio * 15;

  if (level > 800) {
    const magicRatio = (level - 800) / 200;
    groundH = 115 + magicRatio * 165;
    groundL = 40 + magicRatio * 15;
  }

  const skyH = 200 + ratio * 45;
  const skyL = 90 - ratio * 75;

  els.gardenScene.style.setProperty("--ground-h", groundH.toFixed(2));
  els.gardenScene.style.setProperty("--ground-s", `${groundS.toFixed(2)}%`);
  els.gardenScene.style.setProperty("--ground-l", `${groundL.toFixed(2)}%`);
  els.gardenScene.style.setProperty("--sky-h", skyH.toFixed(2));
  els.gardenScene.style.setProperty("--sky-l", `${skyL.toFixed(2)}%`);
}

function renderGarden(options = {}) {
  const animateLatest = Boolean(options.animateLatest);
  const vitality = getLifetimeVitality();
  const maxLevel = getGardenMaxLevel();
  const level = Math.min(vitality, maxLevel);
  const phase = getGardenPhase(level);
  const phaseIndex = GARDEN_PHASES.indexOf(phase);

  if (gardenBoostTimer) {
    window.clearTimeout(gardenBoostTimer);
    gardenBoostTimer = null;
  }

  const entityCount = Math.min(level, maxLevel);
  const entities = Array.from(
    { length: entityCount },
    (_, index) => createGardenEntity(index, level, animateLatest)
  );

  els.gardenLifetime.textContent = String(vitality);
  els.gardenLevel.textContent = String(level);
  els.gardenMaxLevel.textContent = String(maxLevel);
  els.gardenStageLabel.textContent = phase.message;
  els.gardenStageSummary.textContent = phase.message;
  els.gardenProgressText.textContent = `生机 ${level} / ${maxLevel}`;
  els.gardenProgressFill.style.width = `${(level / maxLevel) * 100}%`;
  els.gardenEntities.replaceChildren(...entities);
  els.gardenScene.dataset.stage = String(phaseIndex);
  updateGardenEnvironment(level, maxLevel);
  els.gardenScene.classList.toggle("magic-glow", level >= maxLevel);
  els.gardenBoost.classList.remove("show");

  if (animateLatest && vitality > 0) {
    void els.gardenBoost.offsetWidth;
    els.gardenBoost.classList.add("show");
    els.gardenAnnouncement.textContent = "完成一组练习，花园生机增加 1";
    gardenBoostTimer = window.setTimeout(() => {
      els.gardenBoost.classList.remove("show");
      gardenBoostTimer = null;
    }, 1100);
  }
}

function rewardGardenForCompletedRound() {
  if (roundRewardGranted) return getLifetimeVitality();
  const vitality = Math.min(GARDEN_MAX_LEVEL, getLifetimeVitality() + 1);
  safeSet(GARDEN_VITALITY_KEY, String(vitality));
  roundRewardGranted = true;
  pendingGardenReveal = true;
  return vitality;
}

function loadImageCache() {
  try {
    const entries = JSON.parse(localStorage.getItem(IMAGE_CACHE_KEY) || "[]");
    return new Map(Array.isArray(entries) ? entries : []);
  } catch (_) {
    return new Map();
  }
}

function saveImageCache() {
  const entries = [...imageCache.entries()].slice(-IMAGE_CACHE_LIMIT);
  imageCache = new Map(entries);
  try { localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(entries)); } catch (_) { /* cache is optional */ }
}

function loadAudioCache() {
  try {
    const entries = JSON.parse(localStorage.getItem(AUDIO_CACHE_KEY) || "[]");
    return new Map(Array.isArray(entries) ? entries : []);
  } catch (_) {
    return new Map();
  }
}

function saveAudioCache() {
  const entries = [...audioCache.entries()].slice(-AUDIO_CACHE_LIMIT);
  audioCache = new Map(entries);
  try { localStorage.setItem(AUDIO_CACHE_KEY, JSON.stringify(entries)); } catch (_) { /* cache is optional */ }
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

function parseWordList(text) {
  let level = "词库";
  return text.split(/\r?\n/).reduce((words, rawLine) => {
    const line = rawLine.trim();
    const section = line.match(/^===\s*(.+?)\s*(?:\(|（)/);
    if (section) level = section[1].trim();

    const item = line.match(/^\d+\.\s*([a-z][a-z -]*)$/i);
    if (item) {
      const word = item[1].trim().toLowerCase();
      if (!words.some(entry => entry.word === word)) words.push({ word, level });
    }
    return words;
  }, []);
}

async function loadWordBank() {
  let words = [];

  try {
    const response = await fetch(WORD_SOURCE_URL, { cache: "no-cache" });
    if (!response.ok) throw new Error(`word list request failed: ${response.status}`);
    words = parseWordList(await response.text());
  } catch (error) {
    console.warn("Falling back to bundled word list.", error);
    words = FALLBACK_WORDS;
  }

  const visualWords = words
    .map(item => ({ ...item, ...VISUAL_WORDS[item.word], emoji: EMOJI_VISUALS[item.word] }))
    .filter(item => item.meaning && item.query && item.emoji);

  if (visualWords.length < CHOICE_COUNT) throw new Error("word list has too few visual words");
  return visualWords;
}

function setQuizLoading(message) {
  answered = true;
  els.wordTitle.textContent = "准备题目";
  els.phonetic.textContent = message;
  els.part.textContent = "精确图像库";
  els.choiceGrid.replaceChildren();

  for (let index = 0; index < CHOICE_COUNT; index += 1) {
    const card = document.createElement("button");
    card.className = "choice-card loading";
    card.type = "button";
    card.disabled = true;
    card.setAttribute("aria-label", "正在加载图片");

    const shimmer = document.createElement("span");
    shimmer.className = "image-loader";
    card.append(shimmer);
    els.choiceGrid.append(card);
  }
}

function showLoadError(title, message) {
  answered = true;
  els.wordTitle.textContent = title;
  els.phonetic.textContent = message;
  els.part.textContent = "请稍后重试";
  els.choiceGrid.replaceChildren();

  const panel = document.createElement("div");
  panel.className = "load-error";

  const copy = document.createElement("p");
  copy.textContent = "图片题需要读取词库并连接免费图库 API。网络恢复后可以重新开始。";

  const button = document.createElement("button");
  button.className = "primary-button";
  button.type = "button";
  button.textContent = "重新加载";
  button.addEventListener("click", init);

  panel.append(copy, button);
  els.choiceGrid.append(panel);
}

async function fetchWithTimeout(url, timeout = 9000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

function cleanText(value, fallback = "") {
  return String(value || fallback).replace(/\s+/g, " ").trim();
}

function selectPreferredVoice() {
  if (!("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices().filter(voice => /^en[-_]/i.test(voice.lang));
  const preferredNames = ["Samantha", "Alex", "Google US English", "Microsoft Aria", "Microsoft Jenny", "Daniel", "Karen"];
  preferredVoice = preferredNames
    .map(name => voices.find(voice => voice.name.toLowerCase().includes(name.toLowerCase())))
    .find(Boolean) || voices.find(voice => /en-US/i.test(voice.lang)) || voices[0] || null;
  return preferredVoice;
}

function extractAudioUrl(entries) {
  const urls = (Array.isArray(entries) ? entries : [])
    .flatMap(entry => entry.phonetics || [])
    .map(phonetic => phonetic.audio)
    .filter(Boolean);
  return urls.find(url => /-us\./i.test(url)) || urls.find(url => /-uk\./i.test(url)) || urls[0] || "";
}

async function getPronunciationAudio(word) {
  const key = word.toLowerCase();
  if (audioCache.has(key)) return audioCache.get(key);
  if (audioPromises.has(key)) return audioPromises.get(key);

  const promise = fetchWithTimeout(`${DICTIONARY_AUDIO_API}${encodeURIComponent(key)}`, 5000)
    .then(response => (response.ok ? response.json() : []))
    .then(data => {
      const audioUrl = extractAudioUrl(data);
      audioCache.set(key, audioUrl);
      saveAudioCache();
      return audioUrl;
    })
    .catch(() => {
      audioCache.set(key, "");
      saveAudioCache();
      return "";
    })
    .finally(() => audioPromises.delete(key));

  audioPromises.set(key, promise);
  return promise;
}

function prefetchPronunciation(word) {
  getPronunciationAudio(word);
}

function pickBestImage(item, results) {
  const usable = results.filter(result => {
    const hasImage = result.thumbnail || result.url;
    const safe = !result.mature && !(result.unstable__sensitivity || []).length;
    return hasImage && safe;
  });
  if (!usable.length) return null;

  const genericTerms = new Set(["animal", "bird", "building", "classroom", "clothing", "dish", "exterior", "field", "food", "fruit", "furniture", "human", "insect", "instrument", "interior", "kitchen", "landscape", "medical", "nature", "object", "person", "photo", "plant", "sky", "stationery", "tool", "toy", "utensil", "vehicle", "weather"]);
  const coreTerms = cleanText(`${item.word} ${item.query}`)
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(term => term.length > 2 && !genericTerms.has(term));

  const scored = usable.map(result => {
    const title = cleanText(result.title).toLowerCase();
    const tags = (result.tags || []).map(tag => cleanText(tag.name).toLowerCase());
    const text = `${title} ${tags.join(" ")}`;
    const score = coreTerms.reduce((total, term) => {
      if (title === term || title === `${term}s`) return total + 5;
      if (tags.includes(term) || tags.includes(`${term}s`)) return total + 4;
      if (title.includes(term)) return total + 3;
      if (text.includes(term)) return total + 2;
      return total;
    }, 0);
    return { result, score };
  }).sort((a, b) => b.score - a.score);

  if (!scored[0] || scored[0].score < 2) return null;

  const image = scored[0].result;
  return {
    url: image.thumbnail || image.url,
    fullUrl: image.url,
    title: cleanText(image.title, item.word),
    creator: cleanText(image.creator, "Openverse contributor"),
    provider: cleanText(image.provider, "openverse"),
    license: cleanText(image.license).toUpperCase(),
    licenseUrl: image.license_url || "",
    landingUrl: image.foreign_landing_url || image.url || "",
    attribution: cleanText(image.attribution)
  };
}

async function getImageForWord(item) {
  const key = item.word.toLowerCase();
  if (item.emoji) {
    return {
      kind: "emoji",
      emoji: item.emoji,
      title: `${item.word} 精确图标`,
      creator: "Word Garden",
      provider: "built-in",
      license: "",
      licenseUrl: "",
      landingUrl: "",
      attribution: "精确图标"
    };
  }
  if (imageCache.has(key)) return imageCache.get(key);
  if (imageMisses.has(key)) {
    const error = new Error(`no image found for ${item.word}`);
    error.code = "NO_IMAGE";
    throw error;
  }

  const params = new URLSearchParams({
    q: item.query,
    page_size: "12",
    mature: "false"
  });
  const response = await fetchWithTimeout(`${OPENVERSE_IMAGE_API}?${params.toString()}`);
  if (!response.ok) throw new Error(`image request failed: ${response.status}`);

  const data = await response.json();
  const image = pickBestImage(item, data.results || []);
  if (!image) {
    imageMisses.add(key);
    const error = new Error(`no image found for ${item.word}`);
    error.code = "NO_IMAGE";
    throw error;
  }

  imageCache.set(key, image);
  saveImageCache();
  return image;
}

async function attachImage(item) {
  try {
    return { ...item, image: await getImageForWord(item) };
  } catch (error) {
    if (error.code === "NO_IMAGE") return null;
    throw error;
  }
}

async function buildQuestion(target) {
  const correct = await attachImage(target);
  if (!correct) {
    const error = new Error(`no image found for ${target.word}`);
    error.code = "NO_IMAGE";
    throw error;
  }

  const distractors = [];
  const unlearnedCandidates = wordBank.filter(entry => entry.word !== target.word && !masteredWords.has(entry.word));
  const learnedCandidates = wordBank.filter(entry => entry.word !== target.word && masteredWords.has(entry.word));
  const candidates = shuffle(unlearnedCandidates).concat(shuffle(learnedCandidates));

  for (let offset = 0; offset < candidates.length; offset += IMAGE_BATCH_SIZE) {
    const batch = candidates.slice(offset, offset + IMAGE_BATCH_SIZE);
    const prepared = await Promise.all(batch.map(item => attachImage(item)));
    distractors.push(...prepared.filter(Boolean));
    if (distractors.length === CHOICE_COUNT - 1) break;
  }

  if (distractors.length < CHOICE_COUNT - 1) {
    throw new Error("not enough image choices");
  }

  return {
    correct,
    choices: shuffle([correct, ...distractors.slice(0, CHOICE_COUNT - 1)])
  };
}

async function findNextQuestion() {
  for (let attempts = 0; attempts < 80 && wordCursor < round.length; attempts += 1) {
    const target = round[wordCursor];
    wordCursor += 1;

    try {
      return await buildQuestion(target);
    } catch (error) {
      if (error.code === "NO_IMAGE") continue;
      throw error;
    }
  }

  const error = new Error("not enough visual questions");
  error.code = "NO_IMAGE";
  throw error;
}

function preloadChoiceImages(question) {
  question.choices.forEach(choice => {
    if (!choice.image.url) return;
    const image = new Image();
    image.referrerPolicy = "no-referrer";
    image.src = choice.image.url;
  });
}

function warmNextQuestion() {
  if (nextQuestion || nextQuestionPromise || currentIndex >= getRoundSize() - 1) return;

  nextQuestionPromise = findNextQuestion()
    .then(question => {
      nextQuestion = question;
      preloadChoiceImages(question);
      prefetchPronunciation(question.correct.word);
      return question;
    })
    .catch(error => {
      if (error.code !== "NO_IMAGE") console.warn("Next question preload failed.", error);
      return null;
    })
    .finally(() => {
      nextQuestionPromise = null;
    });
}

async function startRound() {
  if (!wordBank.length) return;
  const remainingWords = getRemainingWords();
  if (!remainingWords.length) {
    updateLearningDashboard();
    return;
  }
  clearAutoAdvance();
  round = shuffle(remainingWords);
  currentIndex = 0;
  wordCursor = 0;
  nextQuestion = null;
  nextQuestionPromise = null;
  score = 0;
  answered = false;
  mistakes = [];
  roundRewardGranted = false;
  els.total.textContent = String(getRoundSize());
  els.score.textContent = "0";
  els.homeScreen.hidden = true;
  els.resultScreen.hidden = true;
  els.quizScreen.hidden = false;
  hideFeedback(true);
  await renderQuestion();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function renderQuestion() {
  const token = ++renderToken;

  currentQuestion = null;
  answered = true;
  els.current.textContent = String(currentIndex + 1);
  els.progress.style.width = `${((currentIndex + 1) / getRoundSize()) * 100}%`;
  setQuizLoading(`正在从 ${wordBank.length} 个看图词中匹配图片`);

  try {
    let question = nextQuestion;
    nextQuestion = null;
    if (!question && nextQuestionPromise) {
      question = await nextQuestionPromise;
      nextQuestion = null;
    }
    if (!question) question = await findNextQuestion();
    if (token !== renderToken) return;

    currentQuestion = question;
    answered = false;
    els.wordTitle.textContent = question.correct.word;
    els.phonetic.textContent = "听一听，再选图片";
    els.part.textContent = question.correct.level;
    document.title = `${question.correct.word} · 单词花园`;
    els.choiceGrid.replaceChildren();

    question.choices.forEach((choice, index) => renderChoice(choice, index));
    prefetchPronunciation(question.correct.word);
    speakWord({ automatic: true });
    warmNextQuestion();
  } catch (error) {
    if (token !== renderToken) return;
    if (error.code === "NO_IMAGE") {
      showLoadError("可用图片不足", "这批单词暂时没有匹配到足够图片");
      return;
    }
    console.error(error);
    showLoadError("图片加载失败", "免费图库暂时没有响应");
  }
}

function renderChoice(choice, index) {
  const button = document.createElement("button");
  button.className = "choice-card";
  button.type = "button";
  button.dataset.word = choice.word;
  button.setAttribute("aria-label", `选项 ${index + 1}`);

  const visual = choice.image.kind === "emoji" ? document.createElement("span") : document.createElement("img");
  if (choice.image.kind === "emoji") {
    visual.className = "emoji-visual";
    visual.setAttribute("aria-hidden", "true");
    visual.textContent = choice.image.emoji;
  } else {
    visual.src = choice.image.url;
    visual.alt = "";
    visual.width = 720;
    visual.height = 720;
    visual.decoding = "async";
    visual.referrerPolicy = "no-referrer";
    if (index === 0) visual.fetchPriority = "high";
  }

  const number = document.createElement("span");
  number.className = "choice-number";
  number.setAttribute("aria-hidden", "true");
  number.textContent = String(index + 1);

  const state = document.createElement("span");
  state.className = "choice-state";
  state.setAttribute("aria-hidden", "true");

  const credit = document.createElement("span");
  credit.className = "choice-credit";
  credit.textContent = choice.image.kind === "emoji" ? "MATCH" : "Openverse";

  button.append(visual, number, state, credit);
  button.addEventListener("click", () => chooseAnswer(button, choice));
  els.choiceGrid.append(button);
}

function chooseAnswer(button, choice) {
  if (answered || !currentQuestion) return;
  answered = true;

  const correct = currentQuestion.correct;
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
    markWordMastered(correct.word);
    showFeedback("correct", "答对了，已学会！", correct);
    playTone(520, 0.09, "sine");
    window.setTimeout(() => playTone(690, 0.11, "sine"), 90);
  } else {
    mistakes.push(correct);
    showFeedback("wrong", `差一点，${correct.word} 是这个`, correct);
    playTone(190, 0.13, "triangle");
  }

  scheduleAutoAdvance(isCorrect ? 1000 : 2000);
}

function imageCredit(image) {
  if (image.kind === "emoji") return "精确图标 · 即时加载";
  const license = image.license ? ` · ${image.license}` : "";
  return `${image.title} / ${image.creator}${license}`;
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
  els.feedbackExample.textContent = imageCredit(item.image);
  els.continueButton.textContent = currentIndex === getRoundSize() - 1 ? "查看结果 →" : "继续 →";
  els.feedback.hidden = false;
  requestAnimationFrame(() => els.feedback.classList.add("show"));
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

function clearAutoAdvance() {
  if (autoAdvanceTimer) {
    window.clearTimeout(autoAdvanceTimer);
    autoAdvanceTimer = null;
  }
}

function scheduleAutoAdvance(delay) {
  clearAutoAdvance();
  autoAdvanceTimer = window.setTimeout(() => {
    autoAdvanceTimer = null;
    continueRound();
  }, delay);
}

async function continueRound() {
  if (!answered) return;
  clearAutoAdvance();
  if (currentIndex >= getRoundSize() - 1) {
    finishRound();
    return;
  }
  hideFeedback();
  currentIndex += 1;
  await renderQuestion();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function finishRound() {
  clearAutoAdvance();
  hideFeedback(true);
  els.quizScreen.hidden = true;
  els.resultScreen.hidden = false;
  document.title = "练习完成 · 单词花园";

  const totalQuestions = getRoundSize();
  const accuracy = Math.round((score / totalQuestions) * 100);
  rewardGardenForCompletedRound();
  const previousBest = Number(safeGet("word-garden-best", "0"));
  const best = Math.max(previousBest, score);
  safeSet("word-garden-best", String(best));

  els.finalCorrect.textContent = String(score);
  els.finalAccuracy.textContent = `${accuracy}%`;
  els.bestScore.textContent = String(best);
  els.resultTitle.textContent = accuracy === 100 ? "满分完成，花园收到新生机！" : "一组完成，花园收到新生机！";
  const learningNote = accuracy === 100
    ? "图片和单词已经牢牢连在一起了。"
    : accuracy >= 75
      ? "再看一眼易错词，会记得更牢。"
      : "每次辨认都在加深记忆，再来一轮吧。";
  els.resultLead.textContent = `你完成了整组 ${totalQuestions} 题，花园获得 1 点生机。${learningNote}`;

  const uniqueMistakes = [...new Map(mistakes.map(item => [item.word, item])).values()];
  els.reviewWords.replaceChildren();
  if (uniqueMistakes.length) {
    uniqueMistakes.forEach(item => {
      const chip = document.createElement("span");
      const strong = document.createElement("strong");
      chip.className = "review-chip";
      strong.textContent = item.word;
      chip.append(strong, document.createTextNode(item.meaning));
      els.reviewWords.append(chip);
    });
    els.reviewList.hidden = false;
  } else {
    els.reviewList.hidden = true;
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
  window.setTimeout(() => els.homeButton.focus(), 250);
}

function showHome() {
  clearAutoAdvance();
  hideFeedback(true);
  els.quizScreen.hidden = true;
  els.resultScreen.hidden = true;
  els.homeScreen.hidden = false;
  document.title = "单词花园 · Lynncat";
  renderGarden({ animateLatest: pendingGardenReveal });
  updateLearningDashboard();
  pendingGardenReveal = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
  window.setTimeout(() => els.startButton.focus(), 250);
}

function speakWithBrowserVoice(word) {
  if (!("speechSynthesis" in window) || !currentQuestion) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = "en-US";
  utterance.voice = preferredVoice || selectPreferredVoice();
  utterance.rate = 0.78;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

async function speakWord(options = {}) {
  if (!currentQuestion) return;
  const automatic = Boolean(options.automatic);
  const word = currentQuestion.correct.word;
  const audioUrl = await getPronunciationAudio(word);

  if (audioUrl) {
    try {
      const audio = new Audio(audioUrl);
      audio.preload = "auto";
      await audio.play();
      return;
    } catch (_) {
      /* Fall back to browser speech when recorded audio cannot play. */
    }
  }

  if (automatic) return;
  speakWithBrowserVoice(word);
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

async function init() {
  renderToken += 1;
  clearAutoAdvance();
  hideFeedback(true);
  els.homeScreen.hidden = false;
  els.quizScreen.hidden = true;
  els.resultScreen.hidden = true;
  renderGarden();
  try {
    wordBank = await loadWordBank();
    const availableWords = new Set(wordBank.map(item => item.word));
    masteredWords = new Set([...loadMasteredWords()].filter(word => availableWords.has(word)));
    saveMasteredWords();
    updateLearningDashboard();
    renderGarden();
  } catch (error) {
    console.error(error);
    els.startButton.disabled = true;
    setStartButtonText("词库读取失败");
    els.homeStatus.textContent = "没有成功读取 words/总单词.txt，请刷新后重试";
  }
}

els.continueButton.addEventListener("click", () => { continueRound(); });
els.startButton.addEventListener("click", () => { startRound(); });
els.homeButton.addEventListener("click", showHome);
els.restartButton.addEventListener("click", () => { startRound(); });
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
  if (event.key === "Enter" && answered && !els.feedback.hidden && !autoAdvanceTimer) {
    event.preventDefault();
    continueRound();
  }
});

soundEnabled = safeGet("word-garden-sound", "on") !== "off";
els.soundToggle.setAttribute("aria-pressed", String(soundEnabled));
els.soundToggle.setAttribute("aria-label", soundEnabled ? "关闭音效" : "打开音效");
if ("speechSynthesis" in window) {
  selectPreferredVoice();
  window.speechSynthesis.addEventListener("voiceschanged", selectPreferredVoice);
}
updateStreak();
init();
