const express = require('express');
const path = require('path');
const axios = require('axios');
const XLSX = require('xlsx');
const { MongoClient } = require('mongodb');
const nodemailer = require('nodemailer');

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

// SMTP Config for judge notifications
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = process.env.SMTP_PORT || 587;
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || 'astra-musica@notifications.com';

let transporter = null;
let emailEnabled = false;

if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT == 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  // Verify credentials immediately
  transporter.verify((err, success) => {
    if (err) {
      console.error('[EMAIL] SMTP verification FAILED:', err.message);
      console.error('[EMAIL] Check your SMTP_USER and SMTP_PASS. If using Gmail, you need an App Password, not your regular password.');
      emailEnabled = false;
    } else {
      console.log('[EMAIL] SMTP transporter configured and verified ✓');
      emailEnabled = true;
    }
  });
} else {
  console.log('[EMAIL] No SMTP config — email notifications disabled. Set SMTP_HOST, SMTP_USER, SMTP_PASS env vars.');
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
  if (!transporter) {
    console.log('[EMAIL] No SMTP config — skipping judge notification');
    return;
  }
  if (!emailEnabled) {
    console.log('[EMAIL] SMTP not verified — skipping judge notification. Check server logs for verification error.');
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
      const mailOptions = {
        from: `"Astra Musica" <${SMTP_FROM}>`,
        to: judge.email,
        subject: `New Submission in ${divisions[judge.division]?.name || judge.division}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;color:#333;">
            <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:24px;border-radius:12px 12px 0 0;text-align:center;">
              <h2 style="color:#d4af37;margin:0;">Astra Musica</h2>
              <p style="color:rgba(255,255,255,0.7);margin:8px 0 0 0;font-size:14px;">New Submission Alert</p>
            </div>
            <div style="background:#fff;padding:24px;border-radius:0 0 12px 12px;border:1px solid #e0e0e0;border-top:none;">
              <p style="font-size:15px;margin-bottom:16px;">Hi <b>${judge.name}</b>,</p>
              <p style="font-size:14px;line-height:1.6;">A new song has been submitted to your division and is ready for scoring.</p>
              <div style="background:#f8f9fa;padding:16px;border-radius:8px;margin:16px 0;">
                <p style="margin:0 0 8px 0;font-size:14px;"><b>Artist:</b> ${submission.author}</p>
                <p style="margin:0 0 8px 0;font-size:14px;"><b>Title:</b> ${submission.title}</p>
                <p style="margin:0 0 8px 0;font-size:14px;"><b>Division:</b> ${divNames}</p>
                <p style="margin:0;font-size:14px;"><b>Week:</b> ${submission.weekId}</p>
              </div>
              <div style="text-align:center;margin:24px 0;">
                <a href="https://astra-musica.onrender.com" style="background:#d4af37;color:#1a1a2e;padding:12px 28px;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;display:inline-block;">Open Judge Panel</a>
              </div>
              <p style="font-size:12px;color:#888;margin-top:20px;border-top:1px solid #eee;padding-top:12px;">
                You received this because you are a judge for the ${divisions[judge.division]?.name || judge.division} division on Astra Musica.
              </p>
            </div>
          </div>
        `
      };

      await transporter.sendMail(mailOptions);
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
    challengeImages,
    divisionLogos
  });
});

// Email status
app.get('/api/email-status', (req, res) => {
  res.json({
    enabled: emailEnabled,
    host: SMTP_HOST || null,
    from: SMTP_FROM,
    message: emailEnabled
      ? 'SMTP is configured and verified. Judges will receive emails on new submissions.'
      : 'SMTP not configured or verification failed. Add SMTP_HOST, SMTP_USER, SMTP_PASS env vars on Render.'
  });
});

// Test email endpoint
app.post('/api/email-test', async (req, res) => {
  if (!transporter) {
    return res.status(400).json({ success: false, error: 'SMTP not configured' });
  }
  const { to } = req.body;
  if (!to) return res.status(400).json({ success: false, error: 'Email address required' });
  try {
    await transporter.sendMail({
      from: `"Astra Musica" <${SMTP_FROM}>`,
      to,
      subject: 'Astra Musica — SMTP Test',
      html: `<p>Hi! This is a test email from Astra Musica. If you received this, your SMTP configuration is working correctly.</p>`
    });
    console.log(`[EMAIL] Test email sent to ${to}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[EMAIL] Test email failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
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
    console.log(`Email notifications: ${transporter ? 'ON ✓' : 'OFF (set SMTP_HOST, SMTP_USER, SMTP_PASS)'}`);
  });
}

start();
