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
let divisionLogos = {};
let emailEnabled = false;

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
  const allData = await apiGet('/api/all-data');
  submissions = allData.submissions || [];
  scores = allData.scores || {};
  resultsRevealed = allData.resultsRevealed;
  revealTime = allData.revealTime;
  currentWeekId = allData.weekId || currentWeekId;
  challengeImages = allData.challengeImages || {};
  divisionLogos = allData.divisionLogos || {};
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
    container.innerHTML = '<p class="text-center text-tertiary" style="padding:40px;font-size:16px;">No submissions yet for this division.</p>';
    return;
  }

  container.innerHTML = divSubs.map(sub => {
    const myScore = scores[sub.id]?.[currentJudge.name];
    const isScored = !!myScore;
    const c = myScore ? myScore.criteria : [0,0,0,0];
    const divColor = divisions[currentJudge.division].color;
    const total = isScored ? myScore.total : Math.round(((c[0]+c[1]+c[2]+c[3])/40)*100);

    return `
      <div class="card" style="border-left: 4px solid ${divColor};" id="song-card-${sub.id}">
        <div class="card-header">
          <div>
            <div class="card-title" style="font-size:18px;">${sub.title}</div>
            <div class="card-meta" style="font-size:14px;">by ${sub.author} · ${formatDate(sub.timestamp)}</div>
          </div>
          ${isScored ? `<span style="font-size:13px;color:#6bff6b;font-weight:700;background:rgba(107,255,107,0.1);padding:4px 12px;border-radius:20px;">✓ Scored ${myScore.total}%</span>` : '<span style="font-size:13px;color:var(--brand-gold);font-weight:700;background:rgba(212,175,55,0.1);padding:4px 12px;border-radius:20px;">Not Scored</span>'}
        </div>
        <div class="tags">
          ${sub.tags.map(t => `<span class="tag ${t}">#${t}</span>`).join('')}
          ${sub.entryType === 'challenge' ? '<span class="challenge-badge">Challenge</span>' : ''}
        </div>
        ${sub.image ? `<img src="${sub.image}" class="submission-img" style="margin-top:10px;max-width:200px;">` : ''}
        <a href="${sub.link}" target="_blank" class="link-btn" style="font-size:14px;padding:10px 18px;margin-top:12px;">▶️ Play Song</a>

        <div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.1);">
          <p style="font-size:14px;font-weight:700;color:rgba(255,255,255,0.8);margin-bottom:14px;">Score this song (0-10 each):</p>
          <div class="criteria-grid">
            <div class="criterion">
              <label style="font-size:13px;">Vocals</label>
              <div class="score-control">
                <button class="score-btn" onclick="adjustScore(${sub.id}, 'vocals', -1)">−</button>
                <span class="score-value" id="val-vocals-${sub.id}">${c[0]}</span>
                <button class="score-btn" onclick="adjustScore(${sub.id}, 'vocals', 1)">+</button>
              </div>
            </div>
            <div class="criterion">
              <label style="font-size:13px;">Production</label>
              <div class="score-control">
                <button class="score-btn" onclick="adjustScore(${sub.id}, 'production', -1)">−</button>
                <span class="score-value" id="val-production-${sub.id}">${c[1]}</span>
                <button class="score-btn" onclick="adjustScore(${sub.id}, 'production', 1)">+</button>
              </div>
            </div>
            <div class="criterion">
              <label style="font-size:13px;">Originality</label>
              <div class="score-control">
                <button class="score-btn" onclick="adjustScore(${sub.id}, 'originality', -1)">−</button>
                <span class="score-value" id="val-originality-${sub.id}">${c[2]}</span>
                <button class="score-btn" onclick="adjustScore(${sub.id}, 'originality', 1)">+</button>
              </div>
            </div>
            <div class="criterion">
              <label style="font-size:13px;">Impact</label>
              <div class="score-control">
                <button class="score-btn" onclick="adjustScore(${sub.id}, 'impact', -1)">−</button>
                <span class="score-value" id="val-impact-${sub.id}">${c[3]}</span>
                <button class="score-btn" onclick="adjustScore(${sub.id}, 'impact', 1)">+</button>
              </div>
            </div>
          </div>

          <div class="score-display" style="margin-top:16px;">
            <span class="label" style="font-size:15px;">Current Total</span>
            <span class="value" id="display-total-${sub.id}" style="font-size:36px;">${total}%</span>
          </div>

          ${isScored 
            ? `<button class="score-edit-btn" onclick="enableEdit(${sub.id})">✏️ Edit My Score</button>`
            : `<button class="save-score-btn" id="save-btn-${sub.id}" onclick="saveScore(${sub.id})">💾 Save My Score</button>`
          }

          <p style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:10px;">
            ${isScored ? '✓ Your score is saved. Other judges cannot see it.' : 'Adjust all 4 criteria, then click Save.'}
          </p>
        </div>
      </div>
    `;
  }).join('');
}

let editingScores = {};

function adjustScore(subId, criterion, delta) {
  const criteriaMap = { 'vocals': 0, 'production': 1, 'originality': 2, 'impact': 3 };
  const idx = criteriaMap[criterion];

  if (!editingScores[subId]) {
    const myScore = scores[subId]?.[currentJudge.name];
    editingScores[subId] = myScore ? [...myScore.criteria] : [0, 0, 0, 0];
  }

  editingScores[subId][idx] = Math.max(0, Math.min(10, editingScores[subId][idx] + delta));

  $(`val-${criterion}-${subId}`).textContent = editingScores[subId][idx];

  const sum = editingScores[subId].reduce((a, b) => a + b, 0);
  const pct = Math.round((sum / 40) * 100);
  $(`display-total-${subId}`).textContent = pct + '%';
}

function enableEdit(subId) {
  const myScore = scores[subId]?.[currentJudge.name];
  if (!myScore) return;
  editingScores[subId] = [...myScore.criteria];

  const card = $(`song-card-${subId}`);
  const btnArea = card.querySelector('.score-edit-btn').parentNode;
  card.querySelector('.score-edit-btn').remove();

  const saveBtn = document.createElement('button');
  saveBtn.className = 'save-score-btn';
  saveBtn.id = `save-btn-${subId}`;
  saveBtn.textContent = '💾 Update My Score';
  saveBtn.onclick = () => saveScore(subId);
  btnArea.appendChild(saveBtn);

  toast('You can now edit your score. Click Update when done.');
}

async function saveScore(subId) {
  const c = editingScores[subId] || [0, 0, 0, 0];
  const sum = c.reduce((a, b) => a + b, 0);

  if (sum === 0) {
    toast('Please score at least one criterion before saving.', 'error');
    return;
  }

  await apiPost('/api/scores', {
    submissionId: subId,
    judgeName: currentJudge.name,
    criteria: c
  });

  scores = await apiGet('/api/scores');
  delete editingScores[subId];
  renderJudgePanel();
  toast('Score saved! Other judges cannot see it.');
}

// ===================== PUBLIC =====================
function setPublicTab(tab) {
  publicTab = tab;
  document.querySelectorAll('#screenPublic .tab').forEach(t => t.classList.remove('active'));
  $('tab' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');

  hide('publicTop20'); hide('publicChallenges'); hide('publicResults');
  show('public' + (tab === 'top20' ? 'Top20' : tab === 'challenges' ? 'Challenges' : 'Results'));

  if (publicDivFilter === 'all') {
    setBodyClass('main-page');
  } else {
    setBodyClass('div-' + publicDivFilter);
  }

  if (tab === 'top20') renderTop20();
  if (tab === 'challenges') renderChallenges();
  if (tab === 'results') renderResults();
}

function setPublicDiv(div) {
  publicDivFilter = div;
  document.querySelectorAll('#publicDivTabs .div-tab').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');

  if (div === 'all') {
    setBodyClass('main-page');
  } else {
    setBodyClass('div-' + div);
  }

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
    const divLogo = divisionLogos[div];

    html += `<div class="div-header" style="border-color:${divColor}40;">`;
    if (divLogo) {
      html += `<img src="${divLogo}" alt="${divisions[div].name}" style="width:48px;height:48px;object-fit:contain;border-radius:8px;margin-right:12px;background:rgba(255,255,255,0.05);padding:4px;">`;
    }
    html += `<div><h2 style="color:${divColor};margin:0;">${divisions[div].name}</h2><p style="margin:4px 0 0 0;color:rgba(255,255,255,0.5);font-size:13px;">Top 20 Submissions</p></div></div>`;

    html += divSubs.map((sub, idx) => `
      <div class="submission-row">
        <div class="submission-info">
          <div class="rank-num ${idx < 3 ? 'top3' : ''}">${idx + 1}</div>
          ${sub.image ? `<img src="${sub.image}" class="submission-img">` : ''}
          <div>
            <a href="${sub.link}" target="_blank" style="font-weight:700;font-size:16px;color:white;text-decoration:none;display:block;margin-bottom:4px;">${sub.title}</a>
            <div style="font-size:14px;color:rgba(255,255,255,0.7);">by ${sub.author}</div>
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-weight:800;font-size:20px;color:var(--brand-gold);">${sub.avg !== null ? sub.avg + '%' : '<span style="font-size:14px;color:rgba(255,255,255,0.5);">Pending</span>'}</div>
          <div class="tags" style="justify-content:flex-end;margin-top:6px;">
            ${sub.tags.map(t => `<span class="tag ${t}" style="font-size:12px;padding:3px 10px;">#${t}</span>`).join('')}
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
    const divLogo = divisionLogos[div];

    html += `<div class="div-header" style="border-color:${divisions[div].color}40;">`;
    if (divLogo) {
      html += `<img src="${divLogo}" alt="${divisions[div].name}" style="width:48px;height:48px;object-fit:contain;border-radius:8px;margin-right:12px;background:rgba(255,255,255,0.05);padding:4px;">`;
    }
    html += `<div><h2 style="color:${divisions[div].color};margin:0;">${divisions[div].name} Challenge</h2><p style="margin:4px 0 0 0;color:rgba(255,255,255,0.5);font-size:13px;">Weekly Challenge Entries</p></div></div>`;

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
            <div class="card-title" style="font-size:18px;">${sub.title}</div>
            <div class="card-meta" style="font-size:14px;">by ${sub.author} · ${formatDate(sub.timestamp)}</div>
          </div>
          <span class="challenge-badge">Challenge</span>
        </div>
        <div class="tags">${sub.tags.map(t => `<span class="tag ${t}">#${t}</span>`).join('')}</div>
        ${sub.image ? `<img src="${sub.image}" class="submission-img" style="margin-top:10px;">` : ''}
        <a href="${sub.link}" target="_blank" class="link-btn" style="font-size:14px;padding:10px 18px;margin-top:12px;">▶️ Play Song</a>
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
  renderDivisionLogoSettings();
  renderNotificationSettings();
}

function renderDivisionLogoSettings() {
  const container = $('divisionLogosList');
  if (!container) return;

  let html = '';
  Object.keys(divisions).forEach(div => {
    const divColor = divisions[div].color;
    const currentLogo = divisionLogos[div] || '';
    html += `
      <div style="margin-bottom:16px;padding:12px;border:1px solid rgba(255,255,255,0.1);border-radius:8px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <div style="width:12px;height:12px;border-radius:50%;background:${divColor};"></div>
          <span style="font-weight:600;font-size:14px;">${divisions[div].name}</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="url" id="divLogoUrl-${div}" placeholder="Logo URL" value="${currentLogo}" style="flex:1;padding:8px 12px;background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:13px;">
          <input type="file" id="divLogoFile-${div}" accept="image/*" style="display:none;" onchange="handleDivLogoUpload('${div}', this)">
          <button onclick="document.getElementById('divLogoFile-${div}').click()" style="padding:8px 12px;background:rgba(255,255,255,0.1);border:none;border-radius:6px;color:white;cursor:pointer;font-size:12px;">📁</button>
          <button onclick="updateDivisionLogo('${div}')" style="padding:8px 16px;background:var(--brand-gold);border:none;border-radius:6px;color:#1a1a2e;cursor:pointer;font-size:12px;font-weight:700;">Save</button>
        </div>
        ${currentLogo ? `<img src="${currentLogo}" style="width:60px;height:60px;object-fit:contain;margin-top:10px;border-radius:6px;background:rgba(255,255,255,0.05);padding:4px;">` : ''}
      </div>
    `;
  });
  container.innerHTML = html;
}

async function handleDivLogoUpload(div, input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    $(`divLogoUrl-${div}`).value = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function updateDivisionLogo(div) {
  const url = $(`divLogoUrl-${div}`).value.trim();
  if (!url) { toast('Enter a logo URL or upload a file', 'error'); return; }
  await apiPost('/api/division-logos', { division: div, url });
  divisionLogos[div] = url;
  renderDivisionLogoSettings();
  toast(`${divisions[div].name} logo saved!`);
}

function renderNotificationSettings() {
  const emailStatus = $('emailStatus');
  if (emailStatus) {
    emailStatus.innerHTML = '<span style="color:var(--brand-gold);">⚠️ Disabled — add SMTP env vars on Render</span>';
  }

  const waContainer = $('whatsappNotifyList');
  if (!waContainer) return;

  let html = '<div style="display:flex;flex-direction:column;gap:8px;">';
  Object.keys(divisions).forEach(div => {
    const divJudges = Object.values(judges).filter(j => j.division === div);
    if (divJudges.length === 0) return;
    html += `<div style="margin-bottom:8px;"><p style="font-size:13px;font-weight:600;color:${divisions[div].color};margin-bottom:6px;">${divisions[div].name}</p>`;
    divJudges.forEach(j => {
      const msg = encodeURIComponent(`Hi ${j.name}, a new submission has been added to the ${divisions[div].name} division on Astra Musica. Please log in to score it.`);
      html += `<a href="https://wa.me/?text=${msg}" target="_blank" style="display:inline-block;padding:6px 12px;background:rgba(37,211,102,0.15);color:#25d366;border:1px solid rgba(37,211,102,0.3);border-radius:6px;text-decoration:none;font-size:12px;margin-right:6px;margin-bottom:6px;">📱 WhatsApp ${j.name}</a>`;
    });
    html += '</div>';
  });
  html += '</div>';
  waContainer.innerHTML = html || '<p style="font-size:13px;color:rgba(255,255,255,0.4);">No judges assigned yet.</p>';
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

// ===================== LOGO =====================
async function loadLogo() {
  try {
    const res = await apiGet('/api/logo');
    if (res.url) applyLogo(res.url);
  } catch (e) {}
}

function applyLogo(url) {
  const box = document.getElementById('logoBox');
  if (!box) return;
  if (url) {
    box.innerHTML = '<img src="' + url + '" alt="Astra Musica" style="width:44px;height:44px;object-fit:contain;border-radius:10px;">';
    box.style.background = 'transparent';
    box.style.border = 'none';
    box.style.boxShadow = 'none';
  } else {
    box.innerHTML = 'AM';
    box.style.background = 'linear-gradient(135deg, var(--brand-blue), #2a4fc7)';
    box.style.border = '2px solid rgba(212,175,55,0.3)';
    box.style.boxShadow = '0 0 20px rgba(65,105,225,0.3)';
  }
}

async function updateLogo() {
  const url = document.getElementById('logoUrl').value.trim();
  if (!url) return;
  await apiPost('/api/logo', { url });
  applyLogo(url);
  toast('Logo saved! It will appear for everyone.');
}

async function uploadLogoFile() {
  const fileInput = document.getElementById('logoFileInput');
  const file = fileInput.files[0];
  if (!file) { toast('Select a logo image first', 'error'); return; }

  const reader = new FileReader();
  reader.onload = async function(e) {
    const base64 = e.target.result;
    await apiPost('/api/logo', { url: base64 });
    applyLogo(base64);
    toast('Logo saved! (For smaller file size, use a URL instead of upload)');
  };
  reader.readAsDataURL(file);
}

// ===================== INIT =====================
async function init() {
  await loadData();
  await loadLogo();
  setBodyClass('main-page');
  showScreen('screenRole');
  updateCountdown();
  handleImageUpload('mImage', 'mImagePreview');
  handleImageUpload('challengeImg', 'challengeImgPreview');
}
init();
