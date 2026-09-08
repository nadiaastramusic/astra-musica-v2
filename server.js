// ===================== IMPORTS & SETUP =====================
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
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Performance: cache static assets and API responses
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    res.header('Cache-Control', 'no-cache');
  }
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===================== CONFIG =====================
const FB_PAGE_ID = process.env.FB_PAGE_ID || '';
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN || '';
const MONGODB_URI = process.env.MONGODB_URI || '';
const BASE_URL = process.env.BASE_URL || 'https://astra-musica-v2.onrender.com';
const POLL_INTERVAL_MS = 10 * 60 * 1000;

// Email config (Brevo REST API — uses HTTPS, bypasses Render SMTP blocks)
const SMTP_FROM = process.env.SMTP_FROM || 'astra-musica@notifications.com';
const BREVO_API_KEY = process.env.SMTP_PASS || '';

let emailEnabled = false;

async function setupEmail() {
  if (!BREVO_API_KEY) {
    console.log('[EMAIL] No Brevo API key — email notifications disabled. Set SMTP_PASS to your Brevo API key.');
    return;
  }
  console.log('[EMAIL] Testing Brevo API connection...');
  try {
    const testRes = await axios.get('https://api.brevo.com/v3/account', {
      headers: { 'api-key': BREVO_API_KEY },
      timeout: 10000
    });
    console.log('[EMAIL] Brevo API connected ✓ Account:', testRes.data.email);
    emailEnabled = true;
  } catch (err) {
    console.error('[EMAIL] Brevo API connection FAILED:', err.response?.data?.message || err.message);
    if (err.response?.status === 401) {
      console.error('[EMAIL] → Invalid API key. Copy the exact key from Brevo → SMTP & API → SMTP key.');
    }
    emailEnabled = false;
  }
}

async function sendBrevoEmail({ to, subject, html }) {
  if (!emailEnabled || !BREVO_API_KEY) throw new Error('Brevo not configured');
  const res = await axios.post('https://api.brevo.com/v3/smtp/email', {
    sender: { email: SMTP_FROM, name: 'Astra Musica' },
    to: [{ email: to }],
    subject,
    htmlContent: html
  }, {
    headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
    timeout: 15000
  });
  return res.data;
}

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
let appLogo = '';
let divisionLogos = {};
let judges = {};
let submissions = [];
let scores = {};
let resultsRevealed = false;
let revealTime = new Date('2026-08-14T20:00:00').getTime();
let divisionRevealStatus = { english: false, afrikaans: false, gospel: false, praiseandworship: false, liveartists: false };
let divisionRevealTimes = { english: revealTime, afrikaans: revealTime, gospel: revealTime, praiseandworship: revealTime, liveartists: revealTime };
let currentWeekId = '2026-W33';
let challengeImages = {};
let teamMembers = [];
let nextId = 1;
let submissionLikes = {};
let news = [];
let themes = [];
let themeScores = {};
let themeImages = {};
let themeRevealStatus = false;
let themeRevealTime = new Date().getTime() + 30 * 24 * 60 * 60 * 1000;
let nextThemeId = 1;
let lastWeeklyReset = 0;

// ===================== MONGODB =====================
let db = null;
let client = null;

async function connectDB() {
  if (!MONGODB_URI) {
    console.log('[DB] No MONGODB_URI set — running in memory-only mode (data will reset on sleep)');
    return false;
  }
  try {
    client = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000
    });
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
      lastWeeklyReset = settings.lastWeeklyReset || 0;
      if (settings.divisionRevealStatus) divisionRevealStatus = { ...divisionRevealStatus, ...settings.divisionRevealStatus };
      if (settings.divisionRevealTimes) divisionRevealTimes = { ...divisionRevealTimes, ...settings.divisionRevealTimes };
    }
    const logoDoc = await db.collection('settings').findOne({ _id: 'logo' });
    if (logoDoc) appLogo = logoDoc.url || '';

    const divLogoDoc = await db.collection('settings').findOne({ _id: 'divisionLogos' });
    if (divLogoDoc) divisionLogos = divLogoDoc.data || {};

    const judgesDoc = await db.collection('judges').findOne({ _id: 'all' });
    if (judgesDoc) judges = judgesDoc.data || {};

    const subsDoc = await db.collection('submissions').findOne({ _id: 'all' });
    if (subsDoc) submissions = subsDoc.data || [];

    const scoresDoc = await db.collection('scores').findOne({ _id: 'all' });
    if (scoresDoc) scores = scoresDoc.data || {};

    const imagesDoc = await db.collection('challengeImages').findOne({ _id: 'all' });
    if (imagesDoc) challengeImages = imagesDoc.data || {};

    const teamDoc = await db.collection('teamMembers').findOne({ _id: 'all' });
    if (teamDoc) teamMembers = teamDoc.data || [];

    const likesDoc = await db.collection('submissionLikes').findOne({ _id: 'all' });
    if (likesDoc) submissionLikes = likesDoc.data || {};

    const newsDoc = await db.collection('news').findOne({ _id: 'all' });
    if (newsDoc) news = newsDoc.data || [];

    const themesDoc = await db.collection('themes').findOne({ _id: 'all' });
    if (themesDoc) themes = themesDoc.data || [];

    const themeScoresDoc = await db.collection('themeScores').findOne({ _id: 'all' });
    if (themeScoresDoc) themeScores = themeScoresDoc.data || {};

    const themeImagesDoc = await db.collection('themeImages').findOne({ _id: 'all' });
    if (themeImagesDoc) themeImages = themeImagesDoc.data || {};

    const themeSettingsDoc = await db.collection('settings').findOne({ _id: 'theme' });
    if (themeSettingsDoc) {
      themeRevealStatus = themeSettingsDoc.revealed || false;
      themeRevealTime = themeSettingsDoc.revealTime || themeRevealTime;
      nextThemeId = themeSettingsDoc.nextId || 1;
    }

    console.log('[DB] Loaded from MongoDB:', {
      judges: Object.keys(judges).length,
      submissions: submissions.length,
      scores: Object.keys(scores).length,
      week: currentWeekId,
      divisionLogos: Object.keys(divisionLogos).length
    });
  } catch (err) {
    console.error('[DB] Load error:', err.message);
  }
}

async function saveSettings() {
  if (!db) return;
  await db.collection('settings').updateOne(
    { _id: 'main' },
    { $set: { adminPassword, resultsRevealed, revealTime, currentWeekId, nextId, divisionRevealStatus, divisionRevealTimes, lastWeeklyReset } },
    { upsert: true }
  );
}

async function saveThemeSettings() {
  if (!db) return;
  await db.collection('settings').updateOne(
    { _id: 'theme' },
    { $set: { revealed: themeRevealStatus, revealTime: themeRevealTime, nextId: nextThemeId } },
    { upsert: true }
  );
}

async function saveDivisionLogos() {
  if (!db) return;
  await db.collection('settings').updateOne(
    { _id: 'divisionLogos' },
    { $set: { data: divisionLogos } },
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

async function saveTeamMembers() {
  if (!db) return;
  await db.collection('teamMembers').updateOne(
    { _id: 'all' },
    { $set: { data: teamMembers } },
    { upsert: true }
  );
}

async function saveSubmissionLikes() {
  if (!db) return;
  await db.collection('submissionLikes').updateOne(
    { _id: 'all' },
    { $set: { data: submissionLikes } },
    { upsert: true }
  );
}

async function saveNews() {
  if (!db) return;
  await db.collection('news').updateOne(
    { _id: 'all' },
    { $set: { data: news } },
    { upsert: true }
  );
}

async function saveThemes() {
  if (!db) return;
  await db.collection('themes').updateOne(
    { _id: 'all' },
    { $set: { data: themes } },
    { upsert: true }
  );
}

async function saveThemeScores() {
  if (!db) return;
  await db.collection('themeScores').updateOne(
    { _id: 'all' },
    { $set: { data: themeScores } },
    { upsert: true }
  );
}

async function saveThemeImages() {
  if (!db) return;
  await db.collection('themeImages').updateOne(
    { _id: 'all' },
    { $set: { data: themeImages } },
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

function getChallengeRankings(division, weekId = currentWeekId) {
  return submissions
    .filter(s => s.weekId === weekId && s.entryType === 'challenge' && (s.challengeDivision === division || (s.tags && s.tags.includes(division))))
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

function getNextRevealTime() {
  const now = new Date();
  const day = now.getDay();
  const daysUntilSat = (6 - day + 7) % 7;
  const nextSat = new Date(now);
  nextSat.setDate(now.getDate() + daysUntilSat);
  nextSat.setHours(16, 0, 0, 0);
  if (nextSat <= now) nextSat.setDate(nextSat.getDate() + 7);
  return nextSat.getTime();
}

function getNextClearTime() {
  const now = new Date();
  const day = now.getDay();
  const daysUntilSun = (0 - day + 7) % 7;
  const nextSun = new Date(now);
  nextSun.setDate(now.getDate() + daysUntilSun);
  nextSun.setHours(18, 0, 0, 0);
  if (nextSun <= now) nextSun.setDate(nextSun.getDate() + 7);
  return nextSun.getTime();
}

function getLastClearTime() {
  const now = new Date();
  const day = now.getDay();
  const daysSinceSun = (day + 7) % 7;
  const sun = new Date(now);
  sun.setDate(now.getDate() - daysSinceSun);
  sun.setHours(18, 0, 0, 0);
  if (sun.getTime() > now.getTime()) sun.setDate(sun.getDate() - 7);
  return sun.getTime();
}

function getThemeAverageScore(subId) {
  const subScores = themeScores[subId];
  if (!subScores) return null;
  const all = Object.values(subScores).map(s => s.total);
  if (all.length === 0) return null;
  return Math.round(all.reduce((a, b) => a + b, 0) / all.length);
}

function getThemeRankings() {
  return themes
    .map(s => ({ ...s, avg: getThemeAverageScore(s.id) }))
    .filter(s => s.avg !== null)
    .sort((a, b) => b.avg - a.avg);
}

function getWeekId() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now - start;
  const oneWeek = 604800000;
  const week = Math.ceil(diff / oneWeek);
  return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ===================== AUTOMATIC WEEKLY TIMER =====================
async function runWeeklyTimer() {
  try {
    const now = Date.now();
    const lastClear = getLastClearTime();
    if (lastWeeklyReset < lastClear) {
      currentWeekId = getWeekId();
      submissions = [];
      scores = {};
      nextId = 1;
      resultsRevealed = false;
      const nextReveal = getNextRevealTime();
      for (const d of Object.keys(divisionRevealStatus)) {
        divisionRevealStatus[d] = false;
        divisionRevealTimes[d] = nextReveal;
      }
      lastWeeklyReset = lastClear;
      await saveSettings();
      await saveSubmissions();
      await saveScores();
      console.log(`[TIMER] Weekly reset ✓ new week: ${currentWeekId}`);
    }

    let changed = false;
    for (const d of Object.keys(divisionRevealStatus)) {
      if (!divisionRevealStatus[d] && now >= divisionRevealTimes[d]) {
        divisionRevealStatus[d] = true;
        changed = true;
        console.log(`[TIMER] Auto-revealed division: ${d}`);
      }
    }
    if (changed) {
      resultsRevealed = Object.values(divisionRevealStatus).some(v => v);
      await saveSettings();
    }
  } catch (err) {
    console.error('[TIMER] Error:', err.message);
  }
}

// ===================== NOTIFICATIONS =====================
async function notifyJudgesOfSubmission(submission) {
  if (!emailEnabled) return;
  const relevantJudges = Object.values(judges).filter(j => {
    if (j.division === 'gospelpraise') {
      return submission.tags.includes('gospel') || submission.tags.includes('praiseandworship');
    }
    return submission.tags.includes(j.division);
  });

  if (relevantJudges.length === 0) return;
  const divNames = submission.tags.map(t => divisions[t]?.name || t).join(', ');

  for (const judge of relevantJudges) {
    try {
      await sendBrevoEmail({
        to: judge.email,
        subject: `New Submission in ${divisions[judge.division]?.name || judge.division}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#333;">
            <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:28px;border-radius:12px 12px 0 0;text-align:center;">
              <h2 style="color:#d4af37;margin:0;font-size:22px;">Astra Musica</h2>
              <p style="color:rgba(255,255,255,0.7);margin:8px 0 0 0;font-size:14px;">🎵 New Submission Alert</p>
            </div>
            <div style="background:#fff;padding:28px;border-radius:0 0 12px 12px;border:1px solid #e0e0e0;border-top:none;">
              <p style="font-size:15px;margin-bottom:16px;">Hi <b>${judge.name}</b>,</p>
              <p style="font-size:14px;line-height:1.6;">A new song has been submitted to your division and is ready for scoring.</p>
              <div style="background:#f8f9fa;padding:16px;border-radius:8px;margin:20px 0;border-left:4px solid #d4af37;">
                <p style="margin:0 0 8px 0;font-size:14px;"><b>Artist:</b> ${submission.author}</p>
                <p style="margin:0 0 8px 0;font-size:14px;"><b>Title:</b> ${submission.title}</p>
                <p style="margin:0 0 8px 0;font-size:14px;"><b>Division:</b> ${divNames}</p>
                <p style="margin:0;font-size:14px;"><b>Week:</b> ${submission.weekId}</p>
              </div>
              <div style="text-align:center;margin:28px 0;padding:20px;background:#faf8f0;border-radius:10px;border:1px solid #e8e0c8;">
                <a href="${BASE_URL}" style="background:#d4af37;color:#1a1a2e;padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:800;font-size:15px;display:inline-block;">Open Astra Musica →</a>
              </div>
            </div>
          </div>
        `
      });
    } catch (err) {
      console.error(`[EMAIL] Failed to notify ${judge.email}:`, err.message);
    }
  }
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
  notifyJudgesOfSubmission(sub).catch(err => console.error('[EMAIL] Notification error:', err));
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
    safe[k] = { name: v.name, email: v.email, division: v.division, photo: v.photo || '', hasSetPassword: v.hasSetPassword };
  }
  res.json(safe);
});

app.post('/api/judges', async (req, res) => {
  const { name, email, division, password, photo } = req.body;
  if (!name || !email || !division || !password) {
    return res.status(400).json({ error: 'Name, email, division, and password are required' });
  }
  const id = 'judge' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
  judges[id] = { name, email, division, password, photo: photo || '', hasSetPassword: false };
  await saveJudges();
  res.json({ id, name, email, division });
});

app.put('/api/judges/:id', async (req, res) => {
  const id = req.params.id;
  if (!judges[id]) return res.status(404).json({ error: 'Judge not found' });
  const { name, email, division, photo } = req.body;
  if (name) judges[id].name = name;
  if (email) judges[id].email = email;
  if (division) judges[id].division = division;
  if (photo !== undefined) judges[id].photo = photo;
  await saveJudges();
  res.json({ success: true, judge: judges[id] });
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
    challengeImages,
    divisionLogos,
    teamMembers,
    divisionRevealStatus,
    divisionRevealTimes,
    emailEnabled,
    mainLogo: appLogo,
    news,
    submissionLikes,
    themes,
    themeScores,
    themeImages,
    themeRevealStatus,
    themeRevealTime,
    nextRevealTime: getNextRevealTime(),
    nextClearTime: getNextClearTime()
  });
});

// Excel export endpoint
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

// ===================== STARTUP =====================
async function start() {
  const dbConnected = await connectDB();
  if (dbConnected) await loadFromDB();
  await setupEmail();
  await runWeeklyTimer();
  setInterval(runWeeklyTimer, 60 * 1000);

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

start();