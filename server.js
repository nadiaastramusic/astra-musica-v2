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
let currentWeekId = '2026-W33';
let challengeImages = {};
let teamMembers = [];
let news = [];
let newsNextId = 1;
let submissionLikes = {};
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

    const newsDoc = await db.collection('news').findOne({ _id: 'all' });
    if (newsDoc) { news = newsDoc.data || []; newsNextId = newsDoc.nextId || 1; }

    const likesDoc = await db.collection('submissionLikes').findOne({ _id: 'all' });
    if (likesDoc) submissionLikes = likesDoc.data || {};

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
    { $set: { adminPassword, resultsRevealed, revealTime, currentWeekId, nextId } },
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

async function saveNews() {
  if (!db) return;
  await db.collection('news').updateOne(
    { _id: 'all' },
    { $set: { data: news, nextId: newsNextId } },
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

async function saveTeamMembers() {
  if (!db) return;
  await db.collection('teamMembers').updateOne(
    { _id: 'all' },
    { $set: { data: teamMembers } },
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

// ===================== NOTIFICATIONS =====================
async function notifyJudgesOfSubmission(submission) {
  if (!emailEnabled) {
    console.log('[EMAIL] Email not enabled — skipping judge notification');
    return;
  }

  const relevantJudges = Object.values(judges).filter(j =>
    submission.tags.includes(j.division)
  );

  if (relevantJudges.length === 0) {
    console.log('[EMAIL] No judges found for divisions:', submission.tags);
    return;
  }

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
                <p style="font-size:13px;color:#666;margin:0 0 12px 0;font-weight:600;">👇 Click below to open Astra Musica and score this song</p>
                <a href="${BASE_URL}" style="background:#d4af37;color:#1a1a2e;padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:800;font-size:15px;display:inline-block;box-shadow:0 4px 12px rgba(212,175,55,0.3);">Open Astra Musica →</a>
                <p style="font-size:12px;color:#888;margin:12px 0 0 0;word-break:break-all;">
                  <a href="${BASE_URL}" style="color:#666;text-decoration:underline;">${BASE_URL}</a>
                </p>
              </div>

              <p style="font-size:12px;color:#888;margin-top:20px;border-top:1px solid #eee;padding-top:12px;">
                You received this because you are a judge for the <b>${divisions[judge.division]?.name || judge.division}</b> division on Astra Musica.
              </p>
            </div>
          </div>
        `
      });
      console.log(`[EMAIL] Notification sent to ${judge.email} for submission #${submission.id}`);
    } catch (err) {
      console.error(`[EMAIL] Failed to notify ${judge.email}:`, err.response?.data?.message || err.message);
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
  const existingNumbers = Object.keys(judges)
    .filter(k => k.startsWith('judge'))
    .map(k => parseInt(k.replace('judge', ''), 10) || 0);
  const maxNum = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0;
  const id = 'judge' + (maxNum + 1);
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
    challengeImages,
    divisionLogos,
    teamMembers,
    news,
    submissionLikes,
    emailEnabled: emailEnabled,
    mainLogo: appLogo
  });
});

// Email status
app.get('/api/email-status', (req, res) => {
  res.json({
    enabled: emailEnabled,
    provider: 'Brevo API',
    from: SMTP_FROM,
    message: emailEnabled
      ? 'Brevo API is connected. Judges will receive emails on new submissions.'
      : 'Brevo API key not set or invalid. Set SMTP_PASS to your Brevo API key on Render.'
  });
});

// Test email endpoint (frontend calls /api/admin/test-email)
app.post('/api/email-test', async (req, res) => {
  if (!emailEnabled) {
    return res.status(400).json({ success: false, error: 'Email not configured' });
  }
  const { to } = req.body;
  if (!to) return res.status(400).json({ success: false, error: 'Email address required' });
  try {
    await sendBrevoEmail({
      to,
      subject: 'Astra Musica — SMTP Test',
      html: '<p>Hi! This is a test email from Astra Musica. If you received this, your Brevo API configuration is working correctly.</p>'
    });
    console.log(`[EMAIL] Test email sent to ${to}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[EMAIL] Test email failed:', err.response?.data?.message || err.message);
    res.status(500).json({ success: false, error: err.response?.data?.message || err.message });
  }
});

// Alias for frontend compatibility
app.post('/api/admin/test-email', async (req, res) => {
  if (!emailEnabled) {
    return res.status(400).json({ success: false, error: 'Email not configured' });
  }
  const { to } = req.body;
  if (!to) return res.status(400).json({ success: false, error: 'Email address required' });
  try {
    await sendBrevoEmail({
      to,
      subject: 'Astra Musica — SMTP Test',
      html: '<p>Hi! This is a test email from Astra Musica. If you received this, your Brevo API configuration is working correctly.</p>'
    });
    console.log(`[EMAIL] Test email sent to ${to}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[EMAIL] Test email failed:', err.response?.data?.message || err.message);
    res.status(500).json({ success: false, error: err.response?.data?.message || err.message });
  }
});

// Team Members
app.get('/api/team-members', (req, res) => res.json(teamMembers));

app.post('/api/team-members', async (req, res) => {
  const { name, role, bio, photo } = req.body;
  if (!name || !role) return res.status(400).json({ error: 'Name and role required' });
  const member = { id: 'tm' + (teamMembers.length + 1), name, role, bio: bio || '', photo: photo || '' };
  teamMembers.push(member);
  await saveTeamMembers();
  res.json({ success: true, member });
});

// Alias for frontend compatibility
app.post('/api/admin/team', async (req, res) => {
  const { name, role, bio, photo } = req.body;
  if (!name || !role) return res.status(400).json({ error: 'Name and role required' });
  const member = { id: 'tm' + (teamMembers.length + 1), name, role, bio: bio || '', photo: photo || '' };
  teamMembers.push(member);
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

app.post('/api/team-members/replace', async (req, res) => {
  const { members } = req.body;
  if (!Array.isArray(members)) return res.status(400).json({ error: 'Members array required' });
  teamMembers = members;
  await saveTeamMembers();
  res.json({ success: true });
});

app.delete('/api/team-members/:id', async (req, res) => {
  teamMembers = teamMembers.filter(m => m.id !== req.params.id);
  await saveTeamMembers();
  res.json({ success: true });
});

// Division Logos
app.get('/api/division-logos', (req, res) => res.json(divisionLogos));

app.post('/api/division-logos', async (req, res) => {
  const { division, url } = req.body;
  if (!division || !url) return res.status(400).json({ error: 'Division and URL required' });
  divisionLogos[division] = url;
  await saveDivisionLogos();
  res.json({ success: true, divisionLogos });
});

// Alias for frontend compatibility
app.post('/api/admin/division-logos', async (req, res) => {
  const { division, logoUrl } = req.body;
  if (!division || !logoUrl) return res.status(400).json({ error: 'Division and URL required' });
  divisionLogos[division] = logoUrl;
  await saveDivisionLogos();
  res.json({ success: true, divisionLogos });
});

// WhatsApp notification links
app.get('/api/notify/whatsapp/:division', (req, res) => {
  const division = req.params.division;
  const divJudges = Object.values(judges).filter(j => j.division === division);
  const links = divJudges.map(j => {
    return { name: j.name, email: j.email };
  });
  res.json({ judges: links });
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

// Logo endpoints
app.get('/api/logo', (req, res) => res.json({ url: appLogo }));

app.post('/api/logo', async (req, res) => {
  const { url } = req.body;
  appLogo = url;
  if (db) {
    await db.collection('settings').updateOne(
      { _id: 'logo' },
      { $set: { url } },
      { upsert: true }
    );
  }
  res.json({ success: true, url });
});

// Alias for frontend compatibility
app.post('/api/admin/logo', async (req, res) => {
  const { logoUrl } = req.body;
  appLogo = logoUrl;
  if (db) {
    await db.collection('settings').updateOne(
      { _id: 'logo' },
      { $set: { url: logoUrl } },
      { upsert: true }
    );
  }
  res.json({ success: true, url: logoUrl });
});

// ===================== NEWS & LIKES =====================

app.get('/api/news', (req, res) => res.json(news));

app.post('/api/admin/news', async (req, res) => {
  const { title, image, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Title and content required' });
  const article = {
    id: newsNextId++,
    title,
    image: image || '',
    content,
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
  news = news.filter(n => n.id !== id);
  await saveNews();
  res.json({ success: true });
});

app.post('/api/news/:id/comment', async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, text } = req.body;
  if (!name || !text) return res.status(400).json({ error: 'Name and comment required' });
  const article = news.find(n => n.id === id);
  if (!article) return res.status(404).json({ error: 'Article not found' });
  article.comments.push({ name, text, timestamp: new Date().toISOString() });
  await saveNews();
  res.json({ success: true, comments: article.comments });
});

app.post('/api/news/:id/like', async (req, res) => {
  const id = parseInt(req.params.id);
  const article = news.find(n => n.id === id);
  if (!article) return res.status(404).json({ error: 'Article not found' });
  article.likes = (article.likes || 0) + 1;
  await saveNews();
  res.json({ success: true, likes: article.likes });
});

app.post('/api/submissions/:id/like', async (req, res) => {
  const id = parseInt(req.params.id);
  submissionLikes[id] = (submissionLikes[id] || 0) + 1;
  await saveSubmissionLikes();
  res.json({ success: true, likes: submissionLikes[id] });
});

app.get('/api/submission-likes', (req, res) => res.json(submissionLikes));

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

  await setupEmail();

  pollFacebook();
  setInterval(pollFacebook, POLL_INTERVAL_MS);

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Astra Musica v2 running on port ${PORT}`);
    console.log(`Database: ${dbConnected ? 'MongoDB Atlas ✓' : 'Memory-only (data resets on sleep)'}`);
    console.log(`Week: ${currentWeekId} | FB polling: ${FB_PAGE_ID && FB_ACCESS_TOKEN ? 'ON' : 'OFF'}`);
    console.log(`Email notifications: ${emailEnabled ? 'ON ✓ (Brevo API)' : 'OFF (set SMTP_PASS to Brevo API key)'}`);
  });
}

start();