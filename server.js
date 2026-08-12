const express = require('express');
const path = require('path');
const axios = require('axios');
const XLSX = require('xlsx');
const { MongoClient } = require('mongodb');

const app = express();

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===================== CONFIG =====================
const FB_PAGE_ID = process.env.FB_PAGE_ID || '';
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN || '';
const MONGODB_URI = process.env.MONGODB_URI || '';
const POLL_INTERVAL_MS = 10 * 60 * 1000;

// ===================== DIVISIONS =====================
const divisions = {
  english: { name: 'English', color: '#C41E3A' },
  afrikaans: { name: 'Afrikaans', color: '#228B22' },
  gospel: { name: 'Gospel', color: '#8B4513' },
  praiseandworship: { name: 'Praise & Worship', color: '#800080' },
  liveartists: { name: 'Live Artists', color: '#008080' }
};

// ===================== IN-MEMORY CACHE =====================
let adminPassword = 'astra2026';
let judges = {};
let submissions = [];
let scores = {};
let resultsRevealed = false;
let revealTime = new Date('2026-08-14T20:00:00').getTime();
let currentWeekId = '2026-W33';
let challengeImages = {};
let nextId = 1;

// ===================== MONGODB =====================
let db = null;
let client = null;

async function connectDB() {
  if (!MONGODB_URI) {
    console.log('[DB] No MONGODB_URI set — running in memory-only mode (data will reset on sleep)');
    return false;
  }
  try {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db('astra_musica');
    console.log('[DB] Connected to MongoDB Atlas');
    return true;
  } catch (err) {
    console.error('[DB] MongoDB connection failed:', err.message);
    console.log('[DB] Falling back to memory-only mode');
    return false;
  }
}

async function loadFromDB() {
  if (!db) return;
  try {
    const settings = await db.collection('settings').findOne({ _id: 'main' });
    if (settings) {
      adminPassword = settings.adminPassword || adminPassword;
      resultsRevealed = settings.resultsRevealed || false;
      revealTime = settings.revealTime || revealTime;
      currentWeekId = settings.currentWeekId || currentWeekId;
      nextId = settings.nextId || 1;
    }

    const judgesDoc = await db.collection('judges').findOne({ _id: 'all' });
    if (judgesDoc) judges = judgesDoc.data || {};

    const subsDoc = await db.collection('submissions').findOne({ _id: 'all' });
    if (subsDoc) submissions = subsDoc.data || [];

    const scoresDoc = await db.collection('scores').findOne({ _id: 'all' });
    if (scoresDoc) scores = scoresDoc.data || {};

    const imagesDoc = await db.collection('challengeImages').findOne({ _id: 'all' });
    if (imagesDoc) challengeImages = imagesDoc.data || {};

    console.log('[DB] Loaded from MongoDB:', {
      judges: Object.keys(judges).length,
      submissions: submissions.length,
      scores: Object.keys(scores).length,
      week: currentWeekId
    });
  } catch (err) {
    console.error('[DB] Load error:', err.message);
  }
}

async function saveSettings() {
  if (!db) return;
  await db.collection('settings').updateOne(
    { _id: 'main' },
    { $set: { adminPassword, resultsRevealed, revealTime, currentWeekId, nextId } },
    { upsert: true }
  );
}

async function saveJudges() {
  if (!db) return;
  await db.collection('judges').updateOne(
    { _id: 'all' },
    { $set: { data: judges } },
    { upsert: true }
  );
}

async function saveSubmissions() {
  if (!db) return;
  await db.collection('submissions').updateOne(
    { _id: 'all' },
    { $set: { data: submissions } },
    { upsert: true }
  );
}

async function saveScores() {
  if (!db) return;
  await db.collection('scores').updateOne(
    { _id: 'all' },
    { $set: { data: scores } },
    { upsert: true }
  );
}

async function saveChallengeImages() {
  if (!db) return;
  await db.collection('challengeImages').updateOne(
    { _id: 'all' },
    { $set: { data: challengeImages } },
    { upsert: true }
  );
}

// ===================== HELPERS =====================
function calculatePercentage(criteria) {
  const sum = criteria.reduce((a, b) => a + (parseFloat(b) || 0), 0);
  return Math.round((sum / 40) * 100);
}

function getAverageScore(subId) {
  const subScores = scores[subId];
  if (!subScores) return null;
  const all = Object.values(subScores).map(s => s.total);
  return Math.round(all.reduce((a,b) => a+b, 0) / all.length);
}

function getRankings(weekId = currentWeekId) {
  return submissions
    .filter(s => s.weekId === weekId)
    .map(s => ({ ...s, avg: getAverageScore(s.id) }))
    .filter(s => s.avg !== null)
    .sort((a, b) => b.avg - a.avg);
}

function getChallengeSubs(weekId = currentWeekId) {
  const seen = new Set();
  return submissions.filter(s => {
    if (s.weekId !== weekId || s.entryType !== 'challenge') return false;
    const key = s.author + '-' + s.challengeDivision;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getSubsForDivision(div, weekId = currentWeekId) {
  return submissions.filter(s => s.weekId === weekId && s.tags.includes(div) && s.entryType === 'top20');
}

function getWeekId() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now - start;
  const oneWeek = 604800000;
  const week = Math.ceil(diff / oneWeek);
  return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ===================== API ROUTES =====================

app.get('/api/divisions', (req, res) => res.json(divisions));

app.get('/api/submissions', (req, res) => res.json(submissions));

app.post('/api/submissions', async (req, res) => {
  const { author, title, tags, link, linkType, entryType, challengeDivision, image, weekId } = req.body;
  if (!author || !title || !tags || !link) return res.status(400).json({ error: 'Missing fields' });
  const sub = {
    id: nextId++, weekId: weekId || currentWeekId,
    author, title, tags, link, linkType: linkType || 'other',
    entryType: entryType || 'top20', challengeDivision: challengeDivision || null,
    image: image || null, timestamp: new Date().toISOString()
  };
  submissions.push(sub);
  await saveSubmissions();
  await saveSettings();
  res.json(sub);
});

app.delete('/api/submissions/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  submissions = submissions.filter(s => s.id !== id);
  delete scores[id];
  await saveSubmissions();
  await saveScores();
  res.json({ success: true });
});

app.get('/api/judges', (req, res) => {
  const safe = {};
  for (const [k, v] of Object.entries(judges)) {
    safe[k] = { name: v.name, email: v.email, division: v.division, hasSetPassword: v.hasSetPassword };
  }
  res.json(safe);
});

app.post('/api/judges', async (req, res) => {
  const { name, email, division, password } = req.body;
  if (!name || !email || !division || !password) {
    return res.status(400).json({ error: 'Name, email, division, and password are required' });
  }
  const id = 'judge' + (Object.keys(judges).length + 1);
  judges[id] = { name, email, division, password, hasSetPassword: false };
  await saveJudges();
  res.json({ id, name, email, division });
});

app.delete('/api/judges/:id', async (req, res) => {
  const id = req.params.id;
  if (judges[id]) {
    delete judges[id];
    await saveJudges();
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Judge not found' });
  }
});

app.post('/api/judges/login', (req, res) => {
  const { email, password } = req.body;
  const judge = Object.values(judges).find(j => j.email === email && j.password === password);
  if (!judge) return res.status(401).json({ error: 'Invalid credentials' });
  res.json({ name: judge.name, division: judge.division, email: judge.email });
});

app.post('/api/judges/set-password', async (req, res) => {
  const { email, oldPassword, newPassword } = req.body;
  const judge = Object.values(judges).find(j => j.email === email);
  if (!judge || judge.password !== oldPassword) return res.status(401).json({ error: 'Invalid' });
  judge.password = newPassword;
  judge.hasSetPassword = true;
  await saveJudges();
  res.json({ success: true });
});

app.post('/api/scores', async (req, res) => {
  const { submissionId, judgeName, criteria } = req.body;
  const total = calculatePercentage(criteria);
  if (!scores[submissionId]) scores[submissionId] = {};
  scores[submissionId][judgeName] = { criteria, total };
  await saveScores();
  res.json({ success: true, total });
});

app.get('/api/scores', (req, res) => res.json(scores));

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === adminPassword) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid admin password' });
  }
});

app.post('/api/admin/change-password', async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (oldPassword !== adminPassword) {
    return res.status(401).json({ error: 'Incorrect current password' });
  }
  adminPassword = newPassword;
  await saveSettings();
  res.json({ success: true });
});

app.post('/api/admin/reveal', async (req, res) => {
  resultsRevealed = req.body.revealed;
  await saveSettings();
  res.json({ revealed: resultsRevealed });
});

app.get('/api/status', (req, res) => res.json({ resultsRevealed, revealTime, currentWeekId }));

app.get('/api/rankings', (req, res) => res.json(getRankings()));

app.get('/api/all-data', (req, res) => {
  const safeJudges = {};
  for (const [k, v] of Object.entries(judges)) {
    safeJudges[k] = { name: v.name, email: v.email, division: v.division, hasSetPassword: v.hasSetPassword };
  }
  res.json({
    weekId: currentWeekId,
    resultsRevealed,
    revealTime,
    divisions,
    judges: safeJudges,
    submissions,
    scores,
    rankings: getRankings(),
    challengeSubs: getChallengeSubs(),
    challengeImages
  });
});

// Challenge images
app.post('/api/challenge-image', async (req, res) => {
  const { weekId, division, image } = req.body;
  if (!challengeImages[weekId]) challengeImages[weekId] = {};
  challengeImages[weekId][division] = image;
  await saveChallengeImages();
  res.json({ success: true });
});

app.get('/api/challenge-image/:weekId/:division', (req, res) => {
  const img = challengeImages[req.params.weekId]?.[req.params.division];
  res.json({ image: img || null });
});

// Weekly reset
app.post('/api/admin/reset-week', async (req, res) => {
  const { newWeekId } = req.body;
  currentWeekId = newWeekId || getWeekId();
  submissions = [];
  scores = {};
  nextId = 1;
  resultsRevealed = false;
  await saveSettings();
  await saveSubmissions();
  await saveScores();
  res.json({ weekId: currentWeekId });
});

// Excel export
app.get('/api/export/:weekId', (req, res) => {
  const weekId = req.params.weekId;
  const weekSubs = submissions.filter(s => s.weekId === weekId);
  const data = weekSubs.map(s => ({
    'Week': s.weekId,
    'Artist': s.author,
    'Title': s.title,
    'Division': s.tags.join(', '),
    'Entry Type': s.entryType,
    'Challenge Division': s.challengeDivision || '',
    'Link': s.link,
    'Link Type': s.linkType,
    'Average Score': getAverageScore(s.id) || 'Not scored',
    'Date': new Date(s.timestamp).toLocaleDateString()
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, weekId);
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename="astra-musica-${weekId}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// Facebook polling
async function pollFacebook() {
  if (!FB_PAGE_ID || !FB_ACCESS_TOKEN) return;
  try {
    const url = `https://graph.facebook.com/v18.0/${FB_PAGE_ID}/posts?access_token=${FB_ACCESS_TOKEN}&fields=message,permalink_url,created_time`;
    const response = await axios.get(url);
    console.log(`[FB] Polled ${response.data.data?.length || 0} posts`);
  } catch (err) {
    console.error('[FB] Poll error:', err.response?.data?.error?.message || err.message);
  }
}

// ===================== STARTUP =====================
async function start() {
  const dbConnected = await connectDB();
  if (dbConnected) {
    await loadFromDB();
  }

  pollFacebook();
  setInterval(pollFacebook, POLL_INTERVAL_MS);

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Astra Musica v2 running on port ${PORT}`);
    console.log(`Database: ${dbConnected ? 'MongoDB Atlas ✓' : 'Memory-only (data resets on sleep)'}`);
    console.log(`Week: ${currentWeekId} | FB polling: ${FB_PAGE_ID && FB_ACCESS_TOKEN ? 'ON' : 'OFF'}`);
  });
}

start();
