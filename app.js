// ── CONFIG ──────────────────────────────────────────────────────
const APP_VERSION = '1.0.0';
const DB_NAME     = 'crewsurvey';
const DB_VERSION  = 1;

// ── STATE ────────────────────────────────────────────────────────
let selectedRank   = null;
let currentQuestion = null;
let db             = null;

// ── INDEXEDDB SETUP ──────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = e => {
      const db = e.target.result;

      // Store for config (questions + ranks + vessels)
      if (!db.objectStoreNames.contains('config')) {
        db.createObjectStore('config', { keyPath: 'key' });
      }

      // Store for queued responses waiting to sync
      if (!db.objectStoreNames.contains('queue')) {
        db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
      }
    };

    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function saveToDB(storeName, key, value) {
  const tx    = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  store.put({ key, value });
  return new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror    = rej;
  });
}

async function getFromDB(storeName, key) {
  return new Promise((resolve, reject) => {
    const tx     = db.transaction(storeName, 'readonly');
    const store  = tx.objectStore(storeName);
    const req    = store.get(key);
    req.onsuccess = e => resolve(e.target.result ? e.target.result.value : null);
    req.onerror   = e => reject(e.target.error);
  });
}

async function addToQueue(response) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('queue', 'readwrite');
    const store = tx.objectStore('queue');
    const req   = store.add(response);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function getAllQueued() {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('queue', 'readonly');
    const store = tx.objectStore('queue');
    const req   = store.getAll();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function removeFromQueue(id) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('queue', 'readwrite');
    const store = tx.objectStore('queue');
    const req   = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

// ── VESSEL NAME FROM URL ─────────────────────────────────────────
function getVesselName() {
  const params = new URLSearchParams(window.location.search);
  const vessel = params.get('vessel');
  if (vessel) {
    // Save to DB for offline use
    saveToDB('config', 'vessel_name', vessel);
    return vessel;
  }
  return null;
}

async function getStoredVesselName() {
  const fromURL = getVesselName();
  if (fromURL) return fromURL;
  return await getFromDB('config', 'vessel_name');
}

// ── RENDER QUESTION ──────────────────────────────────────────────
function renderQuestion(question) {
  currentQuestion = question;

  document.getElementById('question-category').textContent = question.category || '';
  document.getElementById('question-text').textContent     = question.text || '';

  // Build answer buttons dynamically
  const container = document.getElementById('answer-buttons');
  container.innerHTML = '';

  const options = [
    question.option_1,
    question.option_2,
    question.option_3,
    question.option_4,
    question.option_5
  ].filter(Boolean); // remove empty options

  const isPositive = (question.positive_option || '').toLowerCase() === 'first';
  const colours    = getAnswerColours(options.length, isPositive);

  options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className   = 'btn-answer';
    btn.textContent = opt;
    btn.disabled    = true;
    btn.style.background = colours[i].bg;
    btn.style.color      = colours[i].text;
    btn.addEventListener('click', () => selectAnswer(opt));
    container.appendChild(btn);
  });
}

// ── COLOUR SCALE FOR ANSWERS ─────────────────────────────────────
function getAnswerColours(count, isPositive) {
  // Green → Blue scale (positive = green at top, negative = blue at top)
  const scale = [
    { bg: '#2aaa88', text: 'white' },
    { bg: '#00b4a0', text: 'white' },
    { bg: '#009ee3', text: 'white' },
    { bg: '#5572c4', text: 'white' },
    { bg: '#283287', text: 'white' }
  ];

  // Take evenly spaced colours based on count
  let colours = [];
  if (count === 5) {
    colours = scale;
  } else {
    // Pick evenly spaced from scale
    const step = (scale.length - 1) / (count - 1);
    for (let i = 0; i < count; i++) {
      colours.push(scale[Math.round(i * step)]);
    }
  }

  return isPositive ? colours : [...colours].reverse();
}

// ── RENDER RANKS ─────────────────────────────────────────────────
function renderRanks(config) {
  const ranks     = config.filter(c => c.item_type === 'rank').map(c => c.value);
  const container = document.getElementById('rank-pills');
  container.innerHTML = '';

  ranks.forEach(rank => {
    const btn = document.createElement('button');
    btn.className   = 'btn-rank';
    btn.textContent = rank;
    btn.addEventListener('click', () => selectRank(btn, rank));
    container.appendChild(btn);
  });
}

// ── RANK SELECTION ────────────────────────────────────────────────
function selectRank(btn, rank) {
  selectedRank = rank;
  document.querySelectorAll('.btn-rank').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  document.querySelectorAll('.btn-answer').forEach(b => b.disabled = false);
  document.getElementById('rank-hint').classList.add('hidden');
  document.getElementById('rank-section').classList.add('done');
  document.getElementById('answer-section').classList.add('active');
}

// ── ANSWER SELECTION ──────────────────────────────────────────────
async function selectAnswer(answer) {
  if (!selectedRank || !currentQuestion) return;

  const vesselName = await getStoredVesselName();
  const now        = new Date().toISOString();

  const response = {
    timestamp:     now,
    vessel_name:   vesselName || 'Unknown',
    rank:          selectedRank,
    question_text: currentQuestion.text,
    category:      currentQuestion.category,
    week_start_date: currentQuestion.week_start_date,
    answer:        answer,
    app_version:   APP_VERSION
  };

  // Save to queue immediately (offline safe)
  await addToQueue(response);

  // Try to sync straight away if online
  if (navigator.onLine) {
    syncQueue();
  }

  showThankyou();
}

// ── THANK YOU SCREEN ──────────────────────────────────────────────
function showThankyou() {
  const overlay = document.getElementById('thankyou');
  const bar     = document.getElementById('countdown-bar');

  overlay.classList.add('show');
  bar.style.display    = 'block';
  bar.style.transition = 'none';
  bar.style.width      = '100%';

  const duration = 5000;
  const start    = Date.now();

  setTimeout(() => {
    bar.style.transition = `width ${duration}ms linear`;
    bar.style.width      = '0%';
  }, 50);

  const num  = document.getElementById('countdown-num');
  const tick = setInterval(() => {
    const remaining = Math.ceil((duration - (Date.now() - start)) / 1000);
    num.textContent = Math.max(0, remaining);
    if (Date.now() - start >= duration) {
      clearInterval(tick);
      resetSurvey();
    }
  }, 200);
}

function resetSurvey() {
  selectedRank = null;
  document.getElementById('thankyou').classList.remove('show');
  document.getElementById('countdown-bar').style.display = 'none';
  document.querySelectorAll('.btn-rank').forEach(b => b.classList.remove('selected'));
  document.querySelectorAll('.btn-answer').forEach(b => b.disabled = true);
  document.getElementById('rank-hint').classList.remove('hidden');
  document.getElementById('rank-section').classList.remove('done');
  document.getElementById('answer-section').classList.remove('active');
}

// ── OFFLINE BADGE ─────────────────────────────────────────────────
function updateOfflineBadge() {
  const badge = document.getElementById('offline-badge');
  if (navigator.onLine) {
    badge.classList.remove('show');
  } else {
    badge.classList.add('show');
  }
}

// ── INIT ──────────────────────────────────────────────────────────
async function init() {
  db = await openDB();

  // Load cached question from DB first (works offline)
  const cachedQuestion = await getFromDB('config', 'question');
  const cachedConfig   = await getFromDB('config', 'config');

  if (cachedQuestion) renderQuestion(cachedQuestion);
  if (cachedConfig)   renderRanks(cachedConfig);

  // Fetch fresh data from Flow A if online
  if (navigator.onLine) {
    await fetchConfig();
  }

  // Set up daily refresh at midnight
  scheduleMidnightRefresh();

  // Sync any queued responses
  if (navigator.onLine) syncQueue();

  // Offline/online listeners
  window.addEventListener('online',  () => { updateOfflineBadge(); syncQueue(); });
  window.addEventListener('offline', () => updateOfflineBadge());
  updateOfflineBadge();
}

// ── MIDNIGHT REFRESH ──────────────────────────────────────────────
function scheduleMidnightRefresh() {
  const now       = new Date();
  const midnight  = new Date(now);
  midnight.setHours(24, 0, 0, 0); // next midnight
  const msUntil   = midnight - now;

  setTimeout(() => {
    if (navigator.onLine) fetchConfig();
    scheduleMidnightRefresh(); // reschedule for next night
  }, msUntil);
}

// Start the app
document.addEventListener('DOMContentLoaded', init);
