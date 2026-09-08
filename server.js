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
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// No-cache for API responses
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) res.header('Cache-Control', 'no-cache');
  next();
});

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===================== CONFIG =====================
const FB_PAGE_ID = process.env.FB_PAGE_ID || '';
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN || '';
const MONGODB_URI = process.env.MONGODB_URI || '';
const BASE_URL = process.env.BASE_URL || 'https://astra-musica-v2.onrender.com';
const POLL_INTERVAL_MS = 10 * 60 * 1000;

const SMTP_FROM = process.env.SMTP_FROM || 'astra-musica@notifications.com';
const BREVO_API_KEY = process.env.SMTP_PASS || '';

let emailEnabled = false;

async function setupEmail() {
  if (!BREVO_API_KEY) {
    console.log('[EMAIL] No Brevo API key — email notifications disabled.');
    return;
  }
  try {
    const testRes = await axios.get('https://api.brevo.com/v3/account', {
      headers: { 'api-key': BREVO_API_KEY },
      timeout: 10000
    });
    console.log('[EMAIL] Brevo API connected ✓ Account:', testRes.data.email);
    emailEnabled = true;
  } catch (err) {
    console.error('[EMAIL] Brevo API connection FAILED:', err.response?.data?.message || err.message);
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
// Gospel & Praise & Worship are merged into a single 'gospelpraise' division.
// Individual entries are still tagged 'gospel' or 'praiseandworship'.
const divisions = {
  english: { name: 'English', color: '#C41E3A' },
  afrikaans: { name: 'Afrikaans', color: '#228B22' },
  gospelpraise: { name: 'Gospel & Praise & Worship', color: '#7B4FA0' },
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
let divisionRevealStatus = { english: false, afrikaans: false, gospelpraise: false, liveartists: false };
let divisionRevealTimes = { english: revealTime, afrikaans: revealTime, gospelpraise: revealTime, liveartists: revealTime };
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
    console.log('[DB] No MONGODB_URI set — running in memory-only mode.');
    return false;
  }
  try {
    client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 });
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
      themes: themes.length,
      news: news.length
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

async function saveCollection(name, data) {
  if (!db) return;
  await db.collection(name).updateOne({ _id: 'all' }, { $set: { data } }, { upsert: true });
}
async function saveDivisionLogos() { await saveCollection('settings', { divisionLogos }); }
async function saveJudges() { await saveCollection('judges', judges); }
async function saveSubmissions() { await saveCollection('submissions', submissions); }
async function saveScores() { await saveCollection('scores', scores); }
async function saveTeamMembers() { await saveCollection('teamMembers', teamMembers); }
async function saveSubmissionLikes() { await saveCollection('submissionLikes', submissionLikes); }
async function saveNews() { await saveCollection('news', news); }
async function saveThemes() { await saveCollection('themes', themes); }
async function saveThemeScores() { await saveCollection('themeScores', themeScores); }
async function saveThemeImages() { await saveCollection('themeImages', themeImages); }
async function saveChallengeImages() { await saveCollection('challengeImages', challengeImages); }

// ===================== HELPERS =====================
function calculatePercentage(criteria) {
  const sum = criteria.reduce((a, b) => a + (parseFloat(b) || 0), 0);
  return Math.round((sum / 40) * 100);
}

function getAverageScore(subId) {
  const subScores = scores[subId];
  if (!subScores) return null;
  const all = Object.values(subScores).map(s => s.total);
  if (all.length === 0) return null;
  return Math.round(all.reduce((a, b) => a + b, 0) / all.length);
}

function getThemeAverageScore(subId) {
  const subScores = themeScores[subId];
  if (!subScores) return null;
  const all = Object.values(subScores).map(s => s.total);
  if (all.length === 0) return null;
  return Math.round(all.reduce((a, b) => a + b, 0) / all.length);
}

function getRankings(weekId = currentWeekId) {
  return submissions
    .filter(s => s.weekId === weekId)
    .map(s => ({ ...s, avg: getAverageScore(s.id) }))
    .filter(s => s.avg !== null)
    .sort((a, b) => b.avg - a.avg);
}

function getThemeRankings() {
  return themes
    .map(s => ({ ...s, avg: getThemeAverageScore(s.id) }))
    .filter(s => s.avg !== null)
    .sort((a, b) => b.avg - a.avg);
}

function getSubsForDivision(div, weekId = currentWeekId) {
  const subs = submissions.filter(s => s.weekId === weekId && s.entryType !== 'challenge');
  if (div === 'gospelpraise') {
    return subs.filter(s => s.tags && (s.tags.includes('gospel') || s.tags.includes('praiseandworship')));
  }
  return subs.filter(s => s.tags && s.tags.includes(div));
}

function getChallengeSubsForDivision(div, weekId = currentWeekId) {
  const subs = submissions.filter(s => s.weekId === weekId && s.entryType === 'challenge');
  return subs.filter(s => s.challengeDivision === div || (s.tags && s.tags.includes(div)));
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
      console.log('[TIMER] Weekly reset ✓ new week:', currentWeekId);
    }

    let changed = false;
    for (const d of Object.keys(divisionRevealStatus)) {
      if (!divisionRevealStatus[d] && now >= divisionRevealTimes[d]) {
        divisionRevealStatus[d] = true;
        changed = true;
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
              <p style="color:rgba(255,255,255,0.7);margin:8px 0 0 0;font-size:14px;">New Submission Alert</p>
            </div>
            <div style="background:#fff;padding:28px;border-radius:0 0 12px 12px;border:1px solid #e0e0e0;border-top:none;">
              <p style="font-size:15px;margin-bottom:16px;">Hi <b>${judge.name}</b>,</p>
              <p style="font-size:14px;line-height:1.6;">A new song has been submitted to your division and is ready for scoring.</p>
              <div style="background:#f8f9fa;padding:16px;border-radius:8px;margin:20px 0;border-left:4px solid #d4af37;">
                <p style="margin:0;font-size:14px;"><b>Artist:</b> ${submission.author}</p>
                <p style="margin:0;font-size:14px;"><b>Title:</b> ${submission.title}</p>
                <p style="margin:0;font-size:14px;"><b>Division:</b> ${divNames}</p>
                <p style="margin:0;font-size:14px;"><b>Week:</b> ${submission.weekId}</p>
              </div>
              <div style="text-align:center;margin:28px 0;">
                <a href="${BASE_URL}" style="background:#d4af37;color:#1a1a2e;padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:800;font-size:15px;display:inline-block;">Open Astra Musica</a>
              </div>
            </div>
          </div>
        `
      });
      console.log(`[EMAIL] Notification sent to ${judge.email} for submission #${submission.id}`);
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
  notifyJudgesOfSubmission(sub).catch(err => console.error('[EMAIL] Notification error:', err.message));
  res.json(sub);
});

app.post('/api/submissions/:id/like', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!submissionLikes[id]) submissionLikes[id] = 0;
  submissionLikes[id]++;
  await saveSubmissionLikes();
  res.json({ success: true, likes: submissionLikes[id] });
});

app.delete('/api/submissions/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  submissions = submissions.filter(s => s.id !== id);
  delete scores[id];
  delete submissionLikes[id];
  await saveSubmissions();
  await saveScores();
  await saveSubmissionLikes();
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

app.post('/api/judges/login', (req, res) => {
  const { email, password } = req.body;
  const judge = Object.values(judges).find(j => j.email === email && j.password === password);
  if (!judge) return res.status(401).json({ error: 'Invalid credentials' });
  res.json({ name: judge.name, division: judge.division, email: judge.email });
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
  res.json({ success: true, judge: { name: judges[id].name, email: judges[id].email, division: judges[id].division, photo: judges[id].photo } });
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

app.post('/api/admin/reset-judge-password', async (req, res) => {
  const { judgeId, newPassword } = req.body;
  if (!judges[judgeId]) return res.status(404).json({ error: 'Judge not found' });
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
  judges[judgeId].password = newPassword;
  judges[judgeId].hasSetPassword = true;
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

app.post('/api/theme-scores', async (req, res) => {
  const { submissionId, judgeName, criteria } = req.body;
  const total = calculatePercentage(criteria);
  if (!themeScores[submissionId]) themeScores[submissionId] = {};
  themeScores[submissionId][judgeName] = { criteria, total };
  await saveThemeScores();
  res.json({ success: true, total });
});

app.get('/api/theme-scores', (req, res) => res.json(themeScores));

app.get('/api/themes', (req, res) => res.json(themes));

app.post('/api/themes', async (req, res) => {
  const { author, title, tags, link, image } = req.body;
  if (!author || !title || !link) return res.status(400).json({ error: 'Missing fields' });
  const theme = {
    id: nextThemeId++,
    author, title, tags: tags || [], link,
    image: image || null,
    timestamp: new Date().toISOString()
  };
  themes.push(theme);
  await saveThemes();
  await saveThemeSettings();
  res.json(theme);
});

app.delete('/api/themes/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  themes = themes.filter(t => t.id !== id);
  delete themeScores[id];
  await saveThemes();
  await saveThemeScores();
  res.json({ success: true });
});

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === adminPassword) return res.json({ success: true });
  res.status(401).json({ error: 'Invalid admin password' });
});

app.post('/api/admin/change-password', async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (oldPassword !== adminPassword) return res.status(401).json({ error: 'Incorrect current password' });
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  adminPassword = newPassword;
  await saveSettings();
  res.json({ success: true });
});

app.post('/api/admin/reveal', async (req, res) => {
  const { division, revealed } = req.body;
  if (division && divisionRevealStatus.hasOwnProperty(division)) {
    divisionRevealStatus[division] = !!revealed;
    resultsRevealed = Object.values(divisionRevealStatus).some(v => v);
  } else {
    resultsRevealed = !!revealed;
    Object.keys(divisionRevealStatus).forEach(d => divisionRevealStatus[d] = resultsRevealed);
  }
  await saveSettings();
  res.json({ divisionRevealStatus, resultsRevealed });
});

app.post('/api/admin/set-reveal-time', async (req, res) => {
  const { division, timestamp } = req.body;
  if (!division || !divisionRevealTimes.hasOwnProperty(division)) return res.status(400).json({ error: 'Valid division required' });
  divisionRevealTimes[division] = parseInt(timestamp);
  await saveSettings();
  res.json({ success: true, divisionRevealTimes });
});

app.post('/api/admin/reset-week', async (req, res) => {
  const { newWeekId } = req.body;
  currentWeekId = newWeekId || getWeekId();
  submissions = [];
  scores = {};
  nextId = 1;
  resultsRevealed = false;
  submissionLikes = {};
  challengeImages = {};
  for (const d of Object.keys(divisionRevealStatus)) {
    divisionRevealStatus[d] = false;
    divisionRevealTimes[d] = getNextRevealTime();
  }
  lastWeeklyReset = getLastClearTime();
  await saveSettings();
  await saveSubmissions();
  await saveScores();
  await saveSubmissionLikes();
  await saveChallengeImages();
  res.json({ weekId: currentWeekId });
});

app.post('/api/admin/test-email', async (req, res) => {
  if (!emailEnabled) return res.status(400).json({ success: false, error: 'Email not configured' });
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, error: 'Email address required' });
  try {
    await sendBrevoEmail({
      to: email,
      subject: 'Astra Musica — SMTP Test',
      html: '<p>Hi! This is a test email from Astra Musica. Your Brevo API configuration is working correctly.</p>'
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.response?.data?.message || err.message });
  }
});

app.post('/api/admin/logo', async (req, res) => {
  const { logoUrl } = req.body;
  if (!logoUrl) return res.status(400).json({ error: 'Logo URL required' });
  appLogo = logoUrl;
  if (db) {
    await db.collection('settings').updateOne({ _id: 'logo' }, { $set: { url: logoUrl } }, { upsert: true });
  }
  res.json({ success: true, url: logoUrl });
});

app.post('/api/admin/division-logos', async (req, res) => {
  const { division, logoUrl } = req.body;
  if (!division || !logoUrl) return res.status(400).json({ error: 'Division and URL required' });
  divisionLogos[division] = logoUrl;
  if (db) {
    await db.collection('settings').updateOne({ _id: 'divisionLogos' }, { $set: { data: divisionLogos } }, { upsert: true });
  }
  res.json({ success: true, divisionLogos });
});

app.post('/api/admin/challenge-image', async (req, res) => {
  const { division, image, weekId } = req.body;
  if (!division || !image) return res.status(400).json({ error: 'Division and image required' });
  const wk = weekId || currentWeekId;
  if (!challengeImages[wk]) challengeImages[wk] = {};
  challengeImages[wk][division] = image;
  await saveChallengeImages();
  res.json({ success: true });
});

app.post('/api/admin/theme-image', async (req, res) => {
  const { image } = req.body;
  themeImages = { banner: image };
  await saveThemeImages();
  res.json({ success: true });
});

app.post('/api/admin/theme-reveal', async (req, res) => {
  const { revealed } = req.body;
  themeRevealStatus = !!revealed;
  await saveThemeSettings();
  res.json({ success: true, revealed: themeRevealStatus });
});

app.post('/api/admin/theme-reveal-time', async (req, res) => {
  const { timestamp } = req.body;
  themeRevealTime = parseInt(timestamp);
  await saveThemeSettings();
  res.json({ success: true });
});

app.post('/api/admin/delete-theme-only', async (req, res) => {
  themes = [];
  themeScores = {};
  themeImages = {};
  themeRevealStatus = false;
  themeRevealTime = new Date().getTime() + 30 * 24 * 60 * 60 * 1000;
  nextThemeId = 1;
  await saveThemes();
  await saveThemeScores();
  await saveThemeImages();
  await saveThemeSettings();
  res.json({ success: true, message: 'Theme data cleared. Top 20 and Challenge data preserved.' });
});

// ===================== NEWS =====================
app.get('/api/news', (req, res) => res.json(news));

app.post('/api/admin/news', async (req, res) => {
  const { title, content, image } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Title and content required' });
  const article = {
    id: Date.now(),
    title,
    content,
    image: image || '',
    timestamp: new Date().toISOString(),
    likes: 0,
    comments: []
  };
  news.unshift(article);
  await saveNews();
  res.json({ success: true, article });
});

app.delete('/api/admin/news/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  news = news.filter(a => a.id !== id);
  await saveNews();
  res.json({ success: true, news });
});

app.post('/api/news/:id/like', async (req, res) => {
  const id = parseInt(req.params.id);
  const article = news.find(a => a.id === id);
  if (!article) return res.status(404).json({ error: 'Article not found' });
  article.likes = (article.likes || 0) + 1;
  await saveNews();
  res.json({ success: true, likes: article.likes });
});

app.post('/api/news/:id/comment', async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, text } = req.body;
  if (!name || !text) return res.status(400).json({ error: 'Name and text required' });
  const article = news.find(a => a.id === id);
  if (!article) return res.status(404).json({ error: 'Article not found' });
  if (!article.comments) article.comments = [];
  article.comments.push({ name, text, timestamp: new Date().toISOString() });
  await saveNews();
  res.json({ success: true, comments: article.comments });
});

// ===================== TEAM =====================
app.post('/api/admin/team', async (req, res) => {
  const { name, role, bio, photo } = req.body;
  if (!name || !role) return res.status(400).json({ error: 'Name and role required' });
  const member = { id: 'tm' + (teamMembers.length + 1) + '_' + Date.now(), name, role, bio: bio || '', photo: photo || '' };
  teamMembers.push(member);
  await saveTeamMembers();
  res.json({ success: true, teamMembers });
});

app.post('/api/admin/team/reorder', async (req, res) => {
  const { teamMembers: newOrder } = req.body;
  if (!Array.isArray(newOrder)) return res.status(400).json({ error: 'Array required' });
  teamMembers = newOrder;
  await saveTeamMembers();
  res.json({ success: true, teamMembers });
});

app.post('/api/admin/team/:index', async (req, res) => {
  const index = parseInt(req.params.index);
  if (index < 0 || index >= teamMembers.length) return res.status(404).json({ error: 'Team member not found' });
  const { name, role, bio } = req.body;
  if (!name || !role) return res.status(400).json({ error: 'Name and role required' });
  teamMembers[index] = { ...teamMembers[index], name, role, bio: bio || '' };
  await saveTeamMembers();
  res.json({ success: true, teamMembers });
});

app.delete('/api/admin/team/:index', async (req, res) => {
  const index = parseInt(req.params.index);
  if (index >= 0 && index < teamMembers.length) {
    teamMembers.splice(index, 1);
    await saveTeamMembers();
  }
  res.json({ success: true, teamMembers });
});

// ===================== COPY TEXT (for AI image generation) =====================
function buildTop20Text(div) {
  const divName = divisions[div]?.name || div;
  const entries = getSubsForDivision(div)
    .map(s => ({ ...s, avg: getAverageScore(s.id) }))
    .filter(s => s.avg !== null)
    .sort((a, b) => b.avg - a.avg);
  const lines = ['ASTRA MUSICA — ' + divName.toUpperCase() + ' TOP 20 — Week ' + currentWeekId];
  if (entries.length === 0) {
    lines.push('No entries scored yet.');
  } else {
    entries.forEach((sub, idx) => {
      lines.push((idx + 1) + '. "' + sub.title + '" by ' + sub.author + ' — ' + sub.avg + '%');
    });
  }
  lines.push('Astra Musica — Where Stars Are Born');
  return lines.join('\n');
}

function buildChallengeText(div) {
  const divName = divisions[div]?.name || div;
  const entries = getChallengeSubsForDivision(div)
    .map(s => ({ ...s, avg: getAverageScore(s.id) }))
    .filter(s => s.avg !== null)
    .sort((a, b) => b.avg - a.avg);
  const lines = ['ASTRA MUSICA — ' + divName.toUpperCase() + ' WEEKLY CHALLENGE — Week ' + currentWeekId];
  if (entries.length === 0) {
    lines.push('No entries scored yet.');
  } else {
    entries.forEach((sub, idx) => {
      lines.push((idx + 1) + '. "' + sub.title + '" by ' + sub.author + ' — ' + sub.avg + '%');
    });
  }
  lines.push('Astra Musica — Where Stars Are Born');
  return lines.join('\n');
}

function buildThemeText() {
  const entries = getThemeRankings();
  const lines = ['ASTRA MUSICA — THEME OF THE MONTH — Results'];
  if (entries.length === 0) {
    lines.push('No entries scored yet.');
  } else {
    entries.forEach((sub, idx) => {
      lines.push((idx + 1) + '. "' + sub.title + '" by ' + sub.author + ' — ' + sub.avg + '%');
    });
  }
  lines.push('Astra Musica — Where Stars Are Born');
  return lines.join('\n');
}

app.get('/api/copy-text/top20/:division', (req, res) => res.json({ text: buildTop20Text(req.params.division) }));
app.get('/api/copy-text/challenge/:division', (req, res) => res.json({ text: buildChallengeText(req.params.division) }));
app.get('/api/copy-text/theme/all', (req, res) => res.json({ text: buildThemeText() }));

// ===================== ALL DATA =====================
app.get('/api/all-data', (req, res) => {
  const safeJudges = {};
  for (const [k, v] of Object.entries(judges)) {
    safeJudges[k] = { name: v.name, email: v.email, division: v.division, photo: v.photo || '', hasSetPassword: v.hasSetPassword };
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

// ===================== EXCEL EXPORT (server-side, kept for compatibility) =====================
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
  res.setHeader('Content-Disposition', 'attachment; filename="astra-musica-' + weekId + '.xlsx"');
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
    console.log('Astra Musica v2 running on port ' + PORT);
    console.log('Database: ' + (dbConnected ? 'MongoDB Atlas OK' : 'Memory-only'));
    console.log('Week: ' + currentWeekId + ' | Email: ' + (emailEnabled ? 'ON' : 'OFF'));
  });
}

start();
