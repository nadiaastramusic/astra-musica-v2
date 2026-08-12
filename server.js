const express = require('express');
const path = require('path');
const axios = require('axios');
const XLSX = require('xlsx');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===================== CONFIG =====================
const FB_PAGE_ID = process.env.FB_PAGE_ID || '';
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN || '';
const POLL_INTERVAL_MS = 10 * 60 * 1000;

// ===================== DIVISIONS =====================
const divisions = {
  english: { name: 'English', color: '#C41E3A', bg: 'linear-gradient(135deg, #1a0a0a 0%, #2d0a0a 50%, #1a0a0a 100%)', accent: '#C41E3A' },
  afrikaans: { name: 'Afrikaans', color: '#228B22', bg: 'linear-gradient(135deg, #0a1a0a 0%, #0a2d0a 50%, #0a1a0a 100%)', accent: '#228B22' },
  gospel: { name: 'Gospel', color: '#8B4513', bg: 'linear-gradient(135deg, #1a120a 0%, #2d1f0a 50%, #1a120a 100%)', accent: '#8B4513' },
  praiseandworship: { name: 'Praise & Worship', color: '#800080', bg: 'linear-gradient(135deg, #1a0a1a 0%, #2d0a2d 50%, #1a0a1a 100%)', accent: '#800080' },
  liveartists: { name: 'Live Artists', color: '#008080', bg: 'linear-gradient(135deg, #0a1a1a 0%, #0a2d2d 50%, #0a1a1a 100%)', accent: '#008080' }
};

// ===================== JUDGES (admin-managed) =====================
let judges = {
  judge1: { name: 'Sarah M.', email: 'sarah@example.com', division: 'english', password: 'judge1', hasSetPassword: false },
  judge2: { name: 'Pieter K.', email: 'pieter@example.com', division: 'afrikaans', password: 'judge2', hasSetPassword: false },
  judge3: { name: 'Rebecca L.', email: 'rebecca@example.com', division: 'gospel', password: 'judge3', hasSetPassword: false },
  judge4: { name: 'David N.', email: 'david@example.com', division: 'praiseandworship', password: 'judge4', hasSetPassword: false }
};

// ===================== DATA =====================
let submissions = [
  { id: 1, weekId: '2026-W33', author: 'John D.', title: 'Broken Chains', tags: ['english','gospel'], link: 'https://suno.ai/song/abc1', linkType: 'suno', entryType: 'top20', challengeDivision: null, image: null, timestamp: '2026-08-10T14:00' },
  { id: 2, weekId: '2026-W33', author: 'Maria S.', title: 'Grace Unfolding', tags: ['english','praiseandworship'], link: 'https://youtube.com/watch?v=abc2', linkType: 'youtube', entryType: 'top20', challengeDivision: null, image: null, timestamp: '2026-08-10T15:30' },
  { id: 3, weekId: '2026-W33', author: 'Andre V.', title: 'Boeretroos', tags: ['afrikaans'], link: 'https://facebook.com/groups/astra/abc3', linkType: 'facebook', entryType: 'challenge', challengeDivision: 'afrikaans', image: null, timestamp: '2026-08-11T09:00' },
  { id: 4, weekId: '2026-W33', author: 'Lindiwe N.', title: 'Siyabonga', tags: ['afrikaans','gospel'], link: 'https://suno.ai/song/abc4', linkType: 'suno', entryType: 'top20', challengeDivision: null, image: null, timestamp: '2026-08-11T10:15' },
  { id: 5, weekId: '2026-W33', author: 'Thabo M.', title: 'Amazing Grace Remix', tags: ['gospel','english'], link: 'https://youtube.com/watch?v=abc5', linkType: 'youtube', entryType: 'top20', challengeDivision: null, image: null, timestamp: '2026-08-11T11:00' },
  { id: 6, weekId: '2026-W33', author: 'Sarah J.', title: 'Morning Worship', tags: ['praiseandworship','english'], link: 'https://facebook.com/groups/astra/abc6', linkType: 'facebook', entryType: 'top20', challengeDivision: null, image: null, timestamp: '2026-08-11T12:30' },
  { id: 7, weekId: '2026-W33', author: 'John D.', title: 'Second Try', tags: ['english'], link: 'https://suno.ai/song/abc7', linkType: 'suno', entryType: 'challenge', challengeDivision: 'english', image: null, timestamp: '2026-08-11T13:00' },
  { id: 8, weekId: '2026-W33', author: 'Emma W.', title: "Heaven's Door", tags: ['gospel'], link: 'https://youtube.com/watch?v=abc8', linkType: 'youtube', entryType: 'top20', challengeDivision: null, image: null, timestamp: '2026-08-11T14:00' },
  { id: 9, weekId: '2026-W33', author: 'Pieter D.', title: 'Afrikaanse Lied', tags: ['afrikaans','praiseandworship'], link: 'https://facebook.com/groups/astra/abc9', linkType: 'facebook', entryType: 'challenge', challengeDivision: 'afrikaans', image: null, timestamp: '2026-08-11T15:00' },
  { id: 10, weekId: '2026-W33', author: 'Grace T.', title: 'Hallelujah Chorus', tags: ['praiseandworship','gospel'], link: 'https://suno.ai/song/abc10', linkType: 'suno', entryType: 'top20', challengeDivision: null, image: null, timestamp: '2026-08-11T16:00' },
  { id: 11, weekId: '2026-W33', author: 'Mike R.', title: 'Live at the Arena', tags: ['liveartists'], link: 'https://youtube.com/watch?v=live1', linkType: 'youtube', entryType: 'top20', challengeDivision: null, image: null, timestamp: '2026-08-11T17:00' }
];

let scores = {};
let resultsRevealed = false;
let revealTime = new Date('2026-08-14T20:00:00').getTime();
let nextId = 12;
let currentWeekId = '2026-W33';
let challengeImages = {}; // { weekId: { english: base64, afrikaans: base64 } }

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

app.post('/api/submissions', (req, res) => {
  const { author, title, tags, link, linkType, entryType, challengeDivision, image, weekId } = req.body;
  if (!author || !title || !tags || !link) return res.status(400).json({ error: 'Missing fields' });
  const sub = {
    id: nextId++, weekId: weekId || currentWeekId,
    author, title, tags, link, linkType: linkType || 'other',
    entryType: entryType || 'top20', challengeDivision: challengeDivision || null,
    image: image || null, timestamp: new Date().toISOString()
  };
  submissions.push(sub);
  res.json(sub);
});

app.delete('/api/submissions/:id', (req, res) => {
  const id = parseInt(req.params.id);
  submissions = submissions.filter(s => s.id !== id);
  delete scores[id];
  res.json({ success: true });
});

app.get('/api/judges', (req, res) => {
  const safe = {};
  for (const [k, v] of Object.entries(judges)) {
    safe[k] = { name: v.name, email: v.email, division: v.division, hasSetPassword: v.hasSetPassword };
  }
  res.json(safe);
});

app.post('/api/judges', (req, res) => {
  const { name, email, division, password } = req.body;
  if (!name || !email || !division || !password) {
    return res.status(400).json({ error: 'Name, email, division, and password are required' });
  }
  const id = 'judge' + (Object.keys(judges).length + 1);
  judges[id] = { name, email, division, password, hasSetPassword: false };
  res.json({ id, name, email, division });
});

app.delete('/api/judges/:id', (req, res) => {
  const id = req.params.id;
  if (judges[id]) {
    delete judges[id];
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

app.post('/api/judges/set-password', (req, res) => {
  const { email, oldPassword, newPassword } = req.body;
  const judge = Object.values(judges).find(j => j.email === email);
  if (!judge || judge.password !== oldPassword) return res.status(401).json({ error: 'Invalid' });
  judge.password = newPassword;
  judge.hasSetPassword = true;
  res.json({ success: true });
});

app.post('/api/scores', (req, res) => {
  const { submissionId, judgeName, criteria } = req.body;
  const total = calculatePercentage(criteria);
  if (!scores[submissionId]) scores[submissionId] = {};
  scores[submissionId][judgeName] = { criteria, total };
  res.json({ success: true, total });
});

app.get('/api/scores', (req, res) => res.json(scores));

app.post('/api/admin/reveal', (req, res) => {
  resultsRevealed = req.body.revealed;
  res.json({ revealed: resultsRevealed });
});

app.get('/api/status', (req, res) => res.json({ resultsRevealed, revealTime, currentWeekId }));

app.get('/api/rankings', (req, res) => res.json(getRankings()));

// Challenge images
app.post('/api/challenge-image', (req, res) => {
  const { weekId, division, image } = req.body;
  if (!challengeImages[weekId]) challengeImages[weekId] = {};
  challengeImages[weekId][division] = image;
  res.json({ success: true });
});

app.get('/api/challenge-image/:weekId/:division', (req, res) => {
  const img = challengeImages[req.params.weekId]?.[req.params.division];
  res.json({ image: img || null });
});

// Weekly reset
app.post('/api/admin/reset-week', (req, res) => {
  const { newWeekId } = req.body;
  currentWeekId = newWeekId || getWeekId();
  submissions = [];
  scores = {};
  nextId = 1;
  resultsRevealed = false;
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
pollFacebook();
setInterval(pollFacebook, POLL_INTERVAL_MS);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Astra Musica v2 running on port ${PORT}`);
  console.log(`Week: ${currentWeekId} | FB polling: ${FB_PAGE_ID && FB_ACCESS_TOKEN ? 'ON' : 'OFF'}`);
});
