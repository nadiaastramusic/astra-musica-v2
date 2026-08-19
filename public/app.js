// ===================== CONFIG =====================
const API = '';
const divisions = {
  english: { name: 'English', color: '#C41E3A' },
  afrikaans: { name: 'Afrikaans', color: '#228B22' },
  gospel: { name: 'Gospel', color: '#8B4513' },
  praiseandworship: { name: 'Praise & Worship', color: '#800080' },
  gospelpraise: { name: 'Gospel & Praise', color: '#8B4513' },
  liveartists: { name: 'Live Artists', color: '#008080' }
};

// ===================== STATE =====================
let currentRole = null;
let currentJudge = null;
let adminLoggedIn = false;
let submissions = [];
let scores = {};
let judges = {};
let resultsRevealed = false;
let revealTime = new Date('2026-08-14T20:00:00').getTime();
let currentWeekId = '2026-W33';
let publicDivFilter = 'all';
let publicTab = 'top20';
let adminDivFilter = 'all';
let judgeTab = 'top20';
let currentGospelSubTab = 'gospel';
let challengeImages = {};
let divisionLogos = {};
let teamMembers = [];
let emailEnabled = false;
let editingScores = {};

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
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show ' + type;
  setTimeout(() => t.classList.remove('show'), 3000);
}

function getAverageScore(subId) {
  const subScores = scores[subId];
  if (!subScores) return null;
  const all = Object.values(subScores).map(s => s.total);
  if (all.length === 0) return null;
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
  let subs = submissions.filter(s => s.weekId === weekId);
  if (div === 'gospelpraise') {
    return subs.filter(s => s.tags && s.tags.includes(currentGospelSubTab));
  }
  return subs.filter(s => s.tags && s.tags.includes(div));
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
  teamMembers = allData.teamMembers || [];
  judges = await apiGet('/api/judges');
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
  renderTeamMembers();
}

function renderTeamMembers() {
  const el = $('teamMembersList');
  if (!el) return;
  el.innerHTML = teamMembers.map(m => `
    <div class="team-card">
      <img src="${m.photo || ''}" alt="${m.name}">
      <div><b>${m.name}</b> - ${m.role}</div>
    </div>
  `).join('');
}

// ===================== JUDGE =====================
async function loginJudge() {
  const email = $('judgeEmail').value.trim();
  const pw = $('judgePassword').value;
  try {
    const res = await apiPost('/api/judges/login', { email, password: pw });
    if (res.error) throw new Error(res.error);
    currentJudge = res;
    const divColor = divisions[currentJudge.division]?.color || '#d4af37';
    $('headerBadge').innerHTML = `<span class="badge" style="border-color:${divColor};color:${divColor};">Judge · ${divisions[currentJudge.division]?.name || 'Judge'}</span>`;
    $('judgeDivisionName').textContent = divisions[currentJudge.division]?.name || currentJudge.division;
    $('judgeDivisionName').style.color = divColor;
    setBodyClass('div-' + currentJudge.division);
    showScreen('screenJudge');
    renderJudgePanel();
  } catch (e) {
    if ($('loginError')) $('loginError').style.display = 'block';
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
    if ($('adminLoginError')) $('adminLoginError').style.display = 'block';
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

function renderGospelPraiseSubTabs() {
  const container = $('gospelPraiseTabs');
  if (!container || currentJudge?.division !== 'gospelpraise') return;
  container.innerHTML = `
    <button class="tab ${currentGospelSubTab === 'gospel' ? 'active' : ''}" onclick="switchGospelSubTab('gospel')">Gospel</button>
    <button class="tab ${currentGospelSubTab === 'praiseandworship' ? 'active' : ''}" onclick="switchGospelSubTab('praiseandworship')">Praise & Worship</button>
  `;
}

function switchGospelSubTab(subTab) {
  currentGospelSubTab = subTab;
  renderJudgePanel();
}

function renderJudgePanel() {
  renderGospelPraiseSubTabs();

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
    
    const activeDivKey = currentJudge.division === 'gospelpraise' ? currentGospelSubTab : currentJudge.division;
    const divColor = divisions[activeDivKey]?.color || '#d4af37';
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
  if (event && event.target) event.target.classList.add('active');

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

    const divJudges = Object.values(judges).filter(j => j.division === div);

    html += `<div class="div-header" style="border-color:${divColor}40;">`;
    if (divLogo) {
      html += `<img src="${divLogo}" alt="${divisions[div].name}" style="width:48px;height:48px;object-fit:contain;border-radius:8px;margin-right:12px;background:rgba(255,255,255,0.05);padding:4px;">`;
    }
    html += `<div style="flex:1;"><h2 style="color:${divColor};margin:0;">${divisions[div].name}</h2><p style="margin:4px 0 0 0;color:rgba(255,255,255,0.5);font-size:13px;">Top 20 Submissions</p></div>`;

    if (divJudges.length > 0) {
      html += `<div style="display:flex;gap:6px;align-items:center;margin-left:auto;">`;
      divJudges.forEach(j => {
        html += `<div style="text-align:center;">`;
        if (j.photo) {
          html += `<img src="${j.photo}" title="Judge: ${j.name}" style="width:36px;height:36px;object-fit:cover;border-radius:50%;border:2px solid ${divColor};cursor:pointer;">`;
        } else {
          html += `<div title="Judge: ${j.name}" style="width:36px;height:36px;border-radius:50%;background:${divColor};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:white;cursor:pointer;">${j.name.split(' ').map(n=>n[0]).join('').slice(0,2)}</div>`;
        }
        html += `<div style="font-size:10px;color:rgba(255,255,255,0.5);margin-top:2px;">${j.name.split(' ')[0]}</div></div>`;
      });
      html += `</div>`;
    }
    html += `</div>`;

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

    const divJudges = Object.values(judges).filter(j => j.division === div);

    html += `<div class="div-header" style="border-color:${divisions[div].color}40;">`;
    if (divLogo) {
      html += `<img src="${divLogo}" alt="${divisions[div].name}" style="width:48px;height:48px;object-fit:contain;border-radius:8px;margin-right:12px;background:rgba(255,255,255,0.05);padding:4px;">`;
    }
    html += `<div style="flex:1;"><h2 style="color:${divisions[div].color};margin:0;">${divisions[div].name} Challenge</h2><p style="margin:4px 0 0 0;color:rgba(255,255,255,0.5);font-size:13px;">Weekly Challenge Entries</p></div>`;

    if (divJudges.length > 0) {
      html += `<div style="display:flex;gap:6px;align-items:center;margin-left:auto;">`;
      divJudges.forEach(j => {
        html += `<div style="text-align:center;">`;
        if (j.photo) {
          html += `<img src="${j.photo}" title="Judge: ${j.name}" style="width:36px;height:36px;object-fit:cover;border-radius:50%;border:2px solid ${divisions[div].color};cursor:pointer;">`;
        } else {
          html += `<div title="Judge: ${j.name}" style="width:36px;height:36px;border-radius:50%;background:${divisions[div].color};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:white;cursor:pointer;">${j.name.split(' ').map(n=>n[0]).join('').slice(0,2)}</div>`;
        }
        html += `<div style="font-size:10px;color:rgba(255,255,255,0.5);margin-top:2px;">${j.name.split(' ')[0]}</div></div>`;
      });
      html += `</div>`;
    }
    html += `</div>`;

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
    $('podium1Score').textContent = rankings[0]?.avg !== undefined ? rankings[0].avg + '%' : '—';
    $('podium2Name').textContent = rankings[1]?.title || '—';
    $('podium2Score').textContent = rankings[1]?.avg !== undefined ? rankings[1].avg + '%' : '—';
    $('podium3Name').textContent = rankings[2]?.title || '—';
    $('podium3Score').textContent = rankings[2]?.avg !== undefined ? rankings[2].avg + '%' : '—';

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
    ['Days','Hours','Mins','Secs'].forEach(u => { if ($(`cd${u}`)) $(`cd${u}`).textContent = '00'; });
    return;
  }
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if ($('cdDays')) $('cdDays').textContent = String(d).padStart(2,'0');
  if ($('cdHours')) $('cdHours').textContent = String(h).padStart(2,'0');
  if ($('cdMins')) $('cdMins').textContent = String(m).padStart(2,'0');
  if ($('cdSecs')) $('cdSecs').textContent = String(s).padStart(2,'0');
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
  if (event && event.target) event.target.classList.add('active');
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
            <div style="font-size:22px;font-weight:700;color:var(--brand-gold);">${avg !== null ? avg + '%' : '—'}</div>
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
  if (!tbody) return;

  tbody.innerHTML = Object.entries(judgesData).map(([id, j]) => {
    const scoreCount = Object.values(scores).filter(s => s[j.name]).length;
    const totalSubs = getSubsForDivision(j.division).length;
    return `
      <tr>
        <td style="font-weight:600;">${j.name}</td>
        <td>${j.email}</td>
        <td><span class="tag ${j.division}" style="font-size:11px;">${divisions[j.division]?.name || j.division}</span></td>
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
    <div style="font-size:14px;margin-bottom:8px;"><span class="text-secondary">Current leader:</span> <b>${rankings[0]?.title || 'None'}</b> ${rankings[0]?.avg !== undefined ? '(' + rankings[0].avg + '%)' : ''}</div>
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

function renderNotificationSettings() {
  const container = $('notificationSettings');
  if (!container) return;
  container.innerHTML = `
    <label style="display:flex;align-items:center;gap:10px;font-size:14px;cursor:pointer;">
      <input type="checkbox" ${emailEnabled ? 'checked' : ''} onchange="toggleEmailNotifications(this.checked)">
      Enable Email Notifications
    </label>
  `;
}

async function toggleEmailNotifications(enabled) {
  emailEnabled = enabled;
  await apiPost('/api/admin/settings', { emailEnabled });
  toast('Email settings saved.');
}

function renderDivisionLogoSettings() {
  const container = $('divisionLogosList');
  if (!container) return;

  let html = '';
  Object.keys(divisions).forEach(div => {
    const divColor = divisions[div].color;
    const currentLogo = divisionLogos[div] || '';
    html += `
      <div class="card" style="border-left: 4px solid ${divColor}; margin-bottom: 12px;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
          <div>
            <b style="color:${divColor};">${divisions[div].name}</b>
            <div style="font-size: 12px; color: rgba(255,255,255,0.5);">Current logo URL or image link</div>
          </div>
          ${currentLogo ? `<img src="${currentLogo}" style="width:40px;height:40px;object-fit:contain;border-radius:4px;">` : ''}
        </div>
        <div style="display: flex; gap: 8px; margin-top: 10px;">
          <input type="text" id="logo-input-${div}" value="${currentLogo}" placeholder="Image URL..." style="flex: 1;">
          <button class="btn btn-primary" style="width:auto;padding:6px 14px;font-size:12px;" onclick="saveDivisionLogo('${div}')">Save</button>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
}

async function saveDivisionLogo(div) {
  const url = $(`logo-input-${div}`).value.trim();
  divisionLogos[div] = url;
  await apiPost('/api/admin/division-logos', { division: div, logoUrl: url });
  toast(`Logo updated for ${divisions[div].name}!`);
  renderDivisionLogoSettings();
}

// ===================== INITIALIZATION =====================
window.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  selectRole('public');
});