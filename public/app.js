// ===================== CONFIG =====================
const API = '';
const divisions = {
  english: { name: 'English', color: '#C41E3A' },
  afrikaans: { name: 'Afrikaans', color: '#228B22' },
  gospel: { name: 'Gospel', color: '#8B4513' },
  praiseandworship: { name: 'Praise & Worship', color: '#800080' },
  liveartists: { name: 'Live Artists', color: '#008080' }
};

// ===================== STATE =====================
let currentRole = null;
let currentJudge = null;
let adminLoggedIn = false;
let submissions = [];
let scores = {};
let resultsRevealed = false;
let revealTime = new Date('2026-08-14T20:00:00').getTime();
let currentWeekId = '2026-W33';
let publicDivFilter = 'all';
let publicTab = 'top20';
let adminDivFilter = 'all';
let challengeImages = {};

// ===================== UTILS =====================
function $(id) { return document.getElementById(id); }
function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
  show(id);
}
function toast(msg, type='success') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  setTimeout(() => t.classList.remove('show'), 3000);
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

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

function setBodyClass(cls) {
  document.body.className = cls;
}

function detectLinkType(url) {
  if (url.includes('suno')) return 'suno';
  if (url.includes('youtube') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('facebook') || url.includes('fb.')) return 'facebook';
  return 'other';
}

// ===================== API =====================
async function apiGet(path) {
  const r = await fetch(API + path);
  return r.json();
}
async function apiPost(path, body) {
  const r = await fetch(API + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return r.json();
}
async function apiDelete(path) {
  const r = await fetch(API + path, { method: 'DELETE' });
  return r.json();
}

async function loadData() {
  submissions = await apiGet('/api/submissions');
  scores = await apiGet('/api/scores');
  const status = await apiGet('/api/status');
  resultsRevealed = status.resultsRevealed;
  revealTime = status.revealTime;
  currentWeekId = status.currentWeekId || currentWeekId;
}

// ===================== NAVIGATION =====================
function selectRole(role) {
  currentRole = role;
  if (role === 'admin') {
    setBodyClass('main-page');
    if (adminLoggedIn) {
      $('headerBadge').innerHTML = '<span class="badge">Admin</span>';
      showScreen('screenAdmin');
      setAdminTab('submissions');
    } else {
      showScreen('screenAdminLogin');
      $('adminPassword').value = '';
      setTimeout(() => $('adminPassword').focus(), 100);
    }
  } else if (role === 'judge') {
    setBodyClass('main-page');
    $('headerBadge').innerHTML = '';
    showScreen('screenJudgeLogin');
    $('judgeEmail').value = '';
    $('judgePassword').value = '';
    setTimeout(() => $('judgeEmail').focus(), 100);
  } else {
    setBodyClass('main-page');
    $('headerBadge').innerHTML = '<span class="badge">Public</span>';
    showScreen('screenPublic');
    setPublicTab('top20');
  }
}

function goBack() {
  currentRole = null; currentJudge = null; adminLoggedIn = false;
  $('headerBadge').innerHTML = '';
  setBodyClass('main-page');
  showScreen('screenRole');
}

// ===================== JUDGE =====================
async function loginJudge() {
  const email = $('judgeEmail').value.trim();
  const pw = $('judgePassword').value;
  try {
    const res = await apiPost('/api/judges/login', { email, password: pw });
    if (res.error) throw new Error(res.error);
    currentJudge = res;
    const divColor = divisions[currentJudge.division].color;
    $('headerBadge').innerHTML = `<span class="badge" style="border-color:${divColor};color:${divColor};">Judge · ${divisions[currentJudge.division].name}</span>`;
    $('judgeDivisionName').textContent = divisions[currentJudge.division].name;
    $('judgeDivisionName').style.color = divColor;
    setBodyClass('div-' + currentJudge.division);
    showScreen('screenJudge');
    renderJudgePanel();
  } catch (e) {
    $('loginError').style.display = 'block';
  }
}

async function loginAdmin() {
  const pw = $('adminPassword').value;
  try {
    const res = await apiPost('/api/admin/login', { password: pw });
    if (res.error) throw new Error(res.error);
    adminLoggedIn = true;
    $('headerBadge').innerHTML = '<span class="badge">Admin</span>';
    showScreen('screenAdmin');
    setAdminTab('submissions');
  } catch (e) {
    $('adminLoginError').style.display = 'block';
  }
}

async function changeAdminPassword() {
  const oldPw = $('adminOldPassword').value;
  const newPw = $('adminNewPassword').value;
  const confirmPw = $('adminConfirmPassword').value;

  if (!oldPw || !newPw) { toast('Fill all fields', 'error'); return; }
  if (newPw !== confirmPw) { toast('New passwords do not match', 'error'); return; }
  if (newPw.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }

  try {
    const res = await apiPost('/api/admin/change-password', { oldPassword: oldPw, newPassword: newPw });
    if (res.error) throw new Error(res.error);
    toast('Admin password changed!');
    $('adminOldPassword').value = '';
    $('adminNewPassword').value = '';
    $('adminConfirmPassword').value = '';
  } catch (e) {
    toast('Incorrect current password', 'error');
  }
}

function renderJudgePanel() {
  const container = $('judgeSubmissions');
  const divSubs = getSubsForDivision(currentJudge.division);

  if (divSubs.length === 0) {
    container.innerHTML = '<p class="text-center text-tertiary" style="padding:40px;">No submissions yet for this division.</p>';
    return;
  }

  container.innerHTML = divSubs.map(sub => {
    const myScore = scores[sub.id]?.[currentJudge.name];
    const isScored = !!myScore;
    const c = myScore ? myScore.criteria : [0,0,0,0];
    const divColor = divisions[currentJudge.division].color;
    return `
      <div class="card" style="border-left: 4px solid ${divColor};">
        <div class="card-header">
          <div>
            <div class="card-title">${sub.title}</div>
            <div class="card-meta">by ${sub.author} · ${formatDate(sub.timestamp)}</div>
          </div>
          ${isScored ? '<span style="font-size:12px;color:#6bff6b;font-weight:700;">✓ Scored</span>' : ''}
        </div>
        <div class="tags">
          ${sub.tags.map(t => `<span class="tag ${t}">#${t}</span>`).join('')}
          ${sub.entryType === 'challenge' ? '<span class="challenge-badge">Challenge</span>' : ''}
        </div>
        ${sub.image ? `<img src="${sub.image}" class="submission-img" style="margin-top:10px;max-width:200px;">` : ''}
        <a href="${sub.link}" target="_blank" class="link-btn" style="font-size:14px;padding:8px 16px;">▶️ Play Song — ${sub.linkType || 'link'}</a>
        <div class="criteria-grid">
          <div class="criterion"><label>Vocals</label><input type="number" min="0" max="10" value="${c[0]}" id="c1-${sub.id}" onchange="updateScore(${sub.id})"></div>
          <div class="criterion"><label>Production</label><input type="number" min="0" max="10" value="${c[1]}" id="c2-${sub.id}" onchange="updateScore(${sub.id})"></div>
          <div class="criterion"><label>Originality</label><input type="number" min="0" max="10" value="${c[2]}" id="c3-${sub.id}" onchange="updateScore(${sub.id})"></div>
          <div class="criterion"><label>Impact</label><input type="number" min="0" max="10" value="${c[3]}" id="c4-${sub.id}" onchange="updateScore(${sub.id})"></div>
        </div>
        <div class="score-display">
          <span class="label">Total Score</span>
          <span class="value" id="total-${sub.id}">${isScored ? myScore.total + '%' : '—'}</span>
        </div>
        ${isScored ? '<p style="font-size:12px;color:#6bff6b;margin-top:8px;">✓ Your score is saved and hidden from other judges.</p>' : ''}
      </div>
    `;
  }).join('');
}

async function updateScore(subId) {
  const c1 = parseFloat($(`c1-${subId}`).value) || 0;
  const c2 = parseFloat($(`c2-${subId}`).value) || 0;
  const c3 = parseFloat($(`c3-${subId}`).value) || 0;
  const c4 = parseFloat($(`c4-${subId}`).value) || 0;

  await apiPost('/api/scores', {
    submissionId: subId,
    judgeName: currentJudge.name,
    criteria: [c1,c2,c3,c4]
  });

  scores = await apiGet('/api/scores');
  renderJudgePanel();
  toast('Score saved!');
}

// ===================== PUBLIC =====================
function setPublicTab(tab) {
  publicTab = tab;
  document.querySelectorAll('#screenPublic .tab').forEach(t => t.classList.remove('active'));
  $('tab' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');

  hide('publicTop20'); hide('publicChallenges'); hide('publicResults');
  show('public' + (tab === 'top20' ? 'Top20' : tab === 'challenges' ? 'Challenges' : 'Results'));

  if (tab === 'top20') renderTop20();
  if (tab === 'challenges') renderChallenges();
  if (tab === 'results') renderResults();
}

function setPublicDiv(div) {
  publicDivFilter = div;
  document.querySelectorAll('#publicDivTabs .div-tab').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  if (publicTab === 'top20') renderTop20();
}

function renderTop20() {
  const list = $('top20List');
  const divs = Object.keys(divisions);

  let html = '';
  divs.forEach(div => {
    if (publicDivFilter !== 'all' && publicDivFilter !== div) return;
    const divSubs = getSubsForDivision(div).map(s => ({...s, avg: getAverageScore(s.id)}))
      .sort((a,b) => (b.avg||0) - (a.avg||0)).slice(0, 20);
    if (divSubs.length === 0) return;

    const divColor = divisions[div].color;
    html += `<div class="div-header" style="border-color:${divColor}40;">
      <h2 style="color:${divColor};">${divisions[div].name}</h2>
      <p>Top 20 Submissions</p>
    </div>`;
    html += divSubs.map((sub, idx) => `
      <div class="submission-row">
        <div class="submission-info">
          <div class="rank-num ${idx < 3 ? 'top3' : ''}">${idx + 1}</div>
          ${sub.image ? `<img src="${sub.image}" class="submission-img">` : ''}
          <div>
            <a href="${sub.link}" target="_blank" style="font-weight:600;font-size:15px;color:white;text-decoration:none;">${sub.title}</a>
            <div style="font-size:12px;color:rgba(255,255,255,0.4);">by ${sub.author}</div>
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-weight:700;font-size:16px;">${sub.avg ? sub.avg + '%' : 'Pending'}</div>
          <div class="tags" style="justify-content:flex-end;margin-top:4px;">
            ${sub.tags.map(t => `<span class="tag ${t}" style="font-size:11px;padding:2px 8px;">#${t}</span>`).join('')}
          </div>
        </div>
      </div>
    `).join('');
  });

  list.innerHTML = html || '<p class="text-center text-tertiary" style="padding:40px;">No submissions yet.</p>';
}

function renderChallenges() {
  const list = $('challengesList');
  const chals = getChallengeSubs();
  const divs = ['english','afrikaans'];

  let html = '';
  divs.forEach(div => {
    const divChals = chals.filter(c => c.challengeDivision === div);
    const img = challengeImages[currentWeekId]?.[div];

    html += `<div class="div-header" style="border-color:${divisions[div].color}40;">
      <h2 style="color:${divisions[div].color};">${divisions[div].name} Challenge</h2>
      <p>Weekly Challenge Entries</p>
    </div>`;

    if (img) {
      html += `<img src="${img}" class="challenge-img" alt="Challenge banner">`;
    }

    if (divChals.length === 0) {
      html += '<p class="text-center text-tertiary" style="padding:20px;">No challenge entries yet.</p>';
      return;
    }

    html += divChals.map(sub => `
      <div class="card" style="border-left:4px solid ${divisions[div].color};">
        <div class="card-header">
          <div>
            <div class="card-title">${sub.title}</div>
            <div class="card-meta">by ${sub.author} · ${formatDate(sub.timestamp)}</div>
          </div>
          <span class="challenge-badge">Challenge</span>
        </div>
        <div class="tags">${sub.tags.map(t => `<span class="tag ${t}">#${t}</span>`).join('')}</div>
        ${sub.image ? `<img src="${sub.image}" class="submission-img" style="margin-top:10px;">` : ''}
        <a href="${sub.link}" target="_blank" class="link-btn" style="font-size:14px;padding:8px 16px;">▶️ Play Song — ${sub.linkType || 'link'}</a>
      </div>
    `).join('');
  });

  list.innerHTML = html || '<p class="text-center text-tertiary" style="padding:40px;">No challenge entries yet.</p>';
}

function renderResults() {
  const countdownWrap = $('resultsCountdownWrap');
  const content = $('resultsContent');

  if (!resultsRevealed) {
    show('resultsCountdownWrap'); hide('resultsContent');
    updateCountdown();
  } else {
    hide('resultsCountdownWrap'); show('resultsContent');
    const rankings = getRankings();
    if (rankings.length === 0) {
      $('resultsList').innerHTML = '<p class="text-center text-tertiary" style="padding:40px;">No scores submitted yet.</p>';
      return;
    }
    $('podium1Name').textContent = rankings[0]?.title || '—';
    $('podium1Score').textContent = rankings[0]?.avg + '%' || '—';
    $('podium2Name').textContent = rankings[1]?.title || '—';
    $('podium2Score').textContent = rankings[1]?.avg + '%' || '—';
    $('podium3Name').textContent = rankings[2]?.title || '—';
    $('podium3Score').textContent = rankings[2]?.avg + '%' || '—';

    $('resultsList').innerHTML = rankings.slice(3).map((sub, idx) => `
      <div class="submission-row">
        <div class="submission-info">
          <div class="rank-num">${idx + 4}</div>
          ${sub.image ? `<img src="${sub.image}" class="submission-img">` : ''}
          <div>
            <a href="${sub.link}" target="_blank" style="font-weight:600;font-size:15px;color:white;text-decoration:none;">${sub.title}</a>
            <div style="font-size:12px;color:rgba(255,255,255,0.4);">by ${sub.author}</div>
          </div>
        </div>
        <div style="font-weight:700;font-size:16px;">${sub.avg}%</div>
      </div>
    `).join('');
  }
}

function updateCountdown() {
  if (resultsRevealed) return;
  const diff = revealTime - Date.now();
  if (diff <= 0) {
    ['Days','Hours','Mins','Secs'].forEach(u => $(`cd${u}`).textContent = '00');
    return;
  }
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  $('cdDays').textContent = String(d).padStart(2,'0');
  $('cdHours').textContent = String(h).padStart(2,'0');
  $('cdMins').textContent = String(m).padStart(2,'0');
  $('cdSecs').textContent = String(s).padStart(2,'0');
}
setInterval(updateCountdown, 1000);

// ===================== ADMIN =====================
function setAdminTab(tab) {
  document.querySelectorAll('#screenAdmin .tab').forEach(t => t.classList.remove('active'));
  $('tabAdmin' + (tab==='submissions'?'Submissions':tab==='judges'?'Judges':tab==='results'?'Results':'Settings')).classList.add('active');
  hide('adminSubmissions'); hide('adminJudges'); hide('adminResults'); hide('adminSettings');
  show('admin' + (tab==='submissions'?'Submissions':tab==='judges'?'Judges':tab==='results'?'Results':'Settings'));
  if (tab === 'submissions') renderAdminSubmissions();
  if (tab === 'judges') renderAdminJudges();
  if (tab === 'results') renderAdminResults();
  if (tab === 'settings') renderAdminSettings();
}

function filterAdmin(tag) {
  adminDivFilter = tag;
  document.querySelectorAll('#adminFilters .filter-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  renderAdminSubmissions();
}

function renderAdminSubmissions() {
  const container = $('adminSubmissionList');
  let subs = submissions;
  if (adminDivFilter !== 'all') subs = subs.filter(s => s.tags.includes(adminDivFilter));

  container.innerHTML = subs.map(sub => {
    const subScores = scores[sub.id] || {};
    const judgeCount = Object.keys(subScores).length;
    const avg = getAverageScore(sub.id);
    return `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">${sub.title}</div>
            <div class="card-meta">by ${sub.author} · ${sub.tags.map(t => '#' + t).join(' ')} · Week ${sub.weekId}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:13px;color:rgba(255,255,255,0.5);">${judgeCount} judge${judgeCount!==1?'s':''} scored</div>
            <div style="font-size:22px;font-weight:700;color:var(--brand-gold);">${avg ? avg + '%' : '—'}</div>
          </div>
        </div>
        ${sub.entryType === 'challenge' ? '<span class="challenge-badge">Challenge</span>' : ''}
        ${sub.image ? `<img src="${sub.image}" class="submission-img" style="margin-top:10px;">` : ''}
        <div style="margin-top:10px;font-size:12px;color:rgba(255,255,255,0.4);">
          ${Object.entries(subScores).map(([judge, data]) => `${judge}: ${data.total}%`).join(' · ') || 'No scores yet'}
        </div>
        <button class="btn btn-danger" style="width:auto;padding:6px 14px;font-size:12px;margin-top:10px;" onclick="deleteSubmission(${sub.id})">🗑️ Delete</button>
      </div>
    `;
  }).join('') || '<p class="text-center text-tertiary" style="padding:40px;">No submissions.</p>';
}

async function deleteSubmission(id) {
  if (!confirm('Delete this submission?')) return;
  await apiDelete('/api/submissions/' + id);
  await loadData();
  renderAdminSubmissions();
  toast('Submission deleted');
}

async function renderAdminJudges() {
  const judgesData = await apiGet('/api/judges');
  const tbody = $('judgesTable');

  tbody.innerHTML = Object.entries(judgesData).map(([id, j]) => {
    const scoreCount = Object.values(scores).filter(s => s[j.name]).length;
    const totalSubs = getSubsForDivision(j.division).length;
    return `
      <tr>
        <td style="font-weight:600;">${j.name}</td>
        <td>${j.email}</td>
        <td><span class="tag ${j.division}" style="font-size:11px;">${divisions[j.division].name}</span></td>
        <td><span class="status-dot active"></span>Active</td>
        <td>${j.hasSetPassword ? '✓ Changed' : 'Admin Set'}</td>
        <td>${scoreCount} / ${totalSubs}</td>
        <td><button onclick="deleteJudge('${id}')" style="background:none;border:none;color:#ff6b6b;cursor:pointer;font-size:16px;" title="Remove judge">🗑️</button></td>
      </tr>
    `;
  }).join('');
}

async function addJudge() {
  const name = $('newJudgeName').value.trim();
  const email = $('newJudgeEmail').value.trim();
  const division = $('newJudgeDivision').value;
  const password = $('newJudgePassword').value;
  if (!name || !email || !division || !password) { toast('Fill all fields including password', 'error'); return; }

  const res = await apiPost('/api/judges', { name, email, division, password });
  if (res.error) { toast(res.error, 'error'); return; }
  toast(`Judge ${name} added! They can log in with ${email} and the password you set.`);
  $('newJudgeName').value = ''; $('newJudgeEmail').value = ''; $('newJudgePassword').value = '';
  renderAdminJudges();
}

async function deleteJudge(id) {
  if (!confirm('Remove this judge? They will no longer be able to log in.')) return;
  await apiDelete('/api/judges/' + id);
  await loadData();
  renderAdminJudges();
  toast('Judge removed');
}

function renderAdminResults() {
  const rankings = getRankings();
  $('adminScoreSummary').innerHTML = `
    <div style="font-size:14px;margin-bottom:8px;"><span class="text-secondary">Week:</span> <b>${currentWeekId}</b></div>
    <div style="font-size:14px;margin-bottom:8px;"><span class="text-secondary">Total scored:</span> <b>${rankings.length} / ${submissions.length}</b></div>
    <div style="font-size:14px;margin-bottom:8px;"><span class="text-secondary">Current leader:</span> <b>${rankings[0]?.title || 'None'}</b> ${rankings[0]?.avg ? '(' + rankings[0].avg + '%)' : ''}</div>
    <div style="font-size:14px;"><span class="text-secondary">Results status:</span> <b style="color:${resultsRevealed ? '#6bff6b' : 'var(--brand-gold)'}">${resultsRevealed ? 'REVEALED' : 'HIDDEN'}</b></div>
  `;
}

async function revealResults() {
  await apiPost('/api/admin/reveal', { revealed: true });
  resultsRevealed = true;
  toast('Results revealed to public!');
  renderAdminResults();
}

async function hideResults() {
  await apiPost('/api/admin/reveal', { revealed: false });
  resultsRevealed = false;
  toast('Results hidden.');
  renderAdminResults();
}

async function exportExcel() {
  window.open(API + '/api/export/' + currentWeekId, '_blank');
}

async function resetWeek() {
  if (!confirm('WARNING: This will delete ALL submissions and scores for a fresh week. Are you sure?')) return;
  const res = await apiPost('/api/admin/reset-week', { newWeekId: '' });
  await loadData();
  toast('Week reset! New week: ' + res.weekId);
  renderAdminSubmissions();
  renderAdminResults();
}

function renderAdminSettings() {
  // Settings rendered inline
}

// ===================== MANUAL SUBMISSION =====================
function handleImageUpload(inputId, previewId) {
  const input = $(inputId);
  const preview = $(previewId);
  input.addEventListener('change', function() {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
      preview.src = e.target.result;
      preview.style.display = 'block';
      preview.dataset.base64 = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function addManualSubmission() {
  const author = $('mAuthor').value.trim();
  const title = $('mTitle').value.trim();
  const link = $('mLink').value.trim();
  const tagsRaw = $('mTags').value.trim();
  const entryType = $('mType').value;
  const challengeDivision = $('mChallengeDiv').value;
  const imagePreview = $('mImagePreview');

  if (!author || !title || !link || !tagsRaw) {
    toast('Please fill all required fields', 'error'); return;
  }

  const tags = tagsRaw.split(/[\s,]+/).map(t => t.replace('#','').toLowerCase()).filter(Boolean);
  const payload = { 
    author, title, link, tags, 
    linkType: detectLinkType(link),
    entryType, weekId: currentWeekId
  };
  if (entryType === 'challenge') payload.challengeDivision = challengeDivision;
  if (imagePreview.dataset.base64) payload.image = imagePreview.dataset.base64;

  await apiPost('/api/submissions', payload);
  await loadData();
  renderAdminSubmissions();
  toast('Submission added!');

  $('mAuthor').value = ''; $('mTitle').value = ''; $('mLink').value = '';
  $('mTags').value = ''; imagePreview.style.display = 'none'; imagePreview.dataset.base64 = '';
}

async function uploadChallengeImage() {
  const division = $('challengeImgDiv').value;
  const preview = $('challengeImgPreview');
  if (!preview.dataset.base64) { toast('Select an image first', 'error'); return; }

  await apiPost('/api/challenge-image', {
    weekId: currentWeekId,
    division,
    image: preview.dataset.base64
  });

  if (!challengeImages[currentWeekId]) challengeImages[currentWeekId] = {};
  challengeImages[currentWeekId][division] = preview.dataset.base64;
  toast('Challenge image uploaded!');
}

// ===================== INIT =====================
async function init() {
  await loadData();
  setBodyClass('main-page');
  showScreen('screenRole');
  updateCountdown();
  handleImageUpload('mImage', 'mImagePreview');
  handleImageUpload('challengeImg', 'challengeImgPreview');
}
init();

// ===== FIREBASE LOGO UPLOAD HELPER =====
// Paste your Firebase config here:
const FIREBASE_CONFIG = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT',
  storageBucket: 'YOUR_PROJECT.appspot.com'
};

async function uploadLogoToFirebase() {
  const fileInput = document.getElementById('logoFileInput');
  const file = fileInput.files[0];
  if (!file) { toast('Select a logo image first', 'error'); return; }

  // For now, use base64 preview. In production, upload to Firebase Storage.
  const reader = new FileReader();
  reader.onload = function(e) {
    const box = document.getElementById('logoBox');
    box.innerHTML = '<img src="' + e.target.result + '" alt="Astra Musica" style="width:44px;height:44px;object-fit:contain;">';
    box.style.background = 'transparent';
    box.style.border = 'none';
    box.style.boxShadow = 'none';
    toast('Logo updated! (For permanent storage, upload to Firebase Storage and paste the URL in Settings)');
  };
  reader.readAsDataURL(file);
}
