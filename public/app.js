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
function show(id) { if ($(id)) $(id).classList.remove('hidden'); }
function hide(id) { if ($(id)) $(id).classList.add('hidden'); }
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
  show(id);
}
function toast(msg, type = 'success') {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show ' + type;
  setTimeout(() => t.classList.remove('show'), 3000);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
    reader.readAsDataURL(file);
  });
}

function getAverageScore(subId) {
  const subScores = scores[subId];
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

function getChallengeSubs(weekId = currentWeekId) {
  const seen = new Set();
  return submissions.filter(s => {
    if (s.weekId !== weekId || s.entryType !== 'challenge') return false;
    const key = s.author + '-' + (s.challengeDivision || s.tags?.[0]);
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
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

function setBodyClass(cls) {
  document.body.className = cls;
}

// ===================== API =====================
async function apiGet(path) {
  try {
    const r = await fetch(API + path);
    return await r.json();
  } catch (e) {
    console.error('API Get Error:', e);
    return {};
  }
}

async function apiPost(path, body) {
  try {
    const r = await fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await r.json();
  } catch (e) {
    console.error('API Post Error:', e);
    return { error: 'Network or server error' };
  }
}

async function apiDelete(path) {
  try {
    const r = await fetch(API + path, { method: 'DELETE' });
    return await r.json();
  } catch (e) {
    console.error('API Delete Error:', e);
    return { error: 'Delete failed' };
  }
}

async function loadData() {
  const allData = await apiGet('/api/all-data');
  submissions = allData.submissions || [];
  scores = allData.scores || {};
  resultsRevealed = !!allData.resultsRevealed;
  if (allData.revealTime) revealTime = allData.revealTime;
  currentWeekId = allData.weekId || currentWeekId;
  challengeImages = allData.challengeImages || {};
  divisionLogos = allData.divisionLogos || {};
  teamMembers = allData.teamMembers || [];
  emailEnabled = !!allData.emailEnabled;
  judges = await apiGet('/api/judges');

  if (allData.mainLogo) {
    const logoBox = $('logoBox');
    if (logoBox) logoBox.innerHTML = `<img src="${allData.mainLogo}" alt="Logo" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`;
  }

  renderTeamMembers();
}

// ===================== NAVIGATION & TEAM =====================
function selectRole(role) {
  currentRole = role;
  if (role === 'admin') {
    setBodyClass('main-page');
    if (adminLoggedIn) {
      if ($('headerBadge')) $('headerBadge').innerHTML = '<span class="badge">Admin</span>';
      showScreen('screenAdmin');
      setAdminTab('submissions');
    } else {
      showScreen('screenAdminLogin');
      if ($('adminPassword')) $('adminPassword').value = '';
      setTimeout(() => { if ($('adminPassword')) $('adminPassword').focus(); }, 100);
    }
  } else if (role === 'judge') {
    setBodyClass('main-page');
    if ($('headerBadge')) $('headerBadge').innerHTML = '';
    showScreen('screenJudgeLogin');
    if ($('judgeEmail')) $('judgeEmail').value = '';
    if ($('judgePassword')) $('judgePassword').value = '';
    setTimeout(() => { if ($('judgeEmail')) $('judgeEmail').focus(); }, 100);
  } else {
    setBodyClass('main-page');
    if ($('headerBadge')) $('headerBadge').innerHTML = '<span class="badge">Public</span>';
    showScreen('screenPublic');
    setPublicTab('top20');
  }
}

function goBack() {
  currentRole = null;
  currentJudge = null;
  adminLoggedIn = false;
  if ($('headerBadge')) $('headerBadge').innerHTML = '';
  setBodyClass('main-page');
  showScreen('screenRole');
  renderTeamMembers();
}

function renderTeamMembers() {
  const section = $('teamSection');
  const grid = $('teamGrid');
  const list = $('teamMembersList');

  if (teamMembers.length > 0) {
    if (section) section.style.display = 'block';

    const cardHtml = teamMembers.map(m => `
      <div class="role-card" style="padding:16px; text-align:center;">
        <img src="${m.photo || 'https://via.placeholder.com/80'}" alt="${m.name}" style="width:70px; height:70px; object-fit:cover; border-radius:50%; margin:0 auto 12px auto; border:2px solid var(--brand-gold);">
        <h4 style="font-size:16px; font-weight:700; color:white; margin:0 0 4px 0;">${m.name}</h4>
        <p style="font-size:13px; color:var(--brand-gold); margin:0 0 8px 0; font-weight:600;">${m.role}</p>
        ${m.bio ? `<p style="font-size:12px; color:rgba(255,255,255,0.6); margin:0; line-height:1.4;">${m.bio}</p>` : ''}
      </div>
    `).join('');

    if (grid) grid.innerHTML = cardHtml;
  } else if (section) {
    section.style.display = 'none';
  }

  if (list) {
    list.innerHTML = teamMembers.map((m, idx) => `
      <div class="team-card" style="display:flex; align-items:center; justify-content:space-between; gap:14px; padding:12px; background:rgba(255,255,255,0.05); border-radius:10px; margin-bottom:10px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <img src="${m.photo || 'https://via.placeholder.com/50'}" alt="${m.name}" style="width:48px; height:48px; object-fit:cover; border-radius:50%; flex-shrink:0;">
          <div>
            <div style="font-size:15px; font-weight:700; color:white;">${m.name} <span style="font-size:12px; font-weight:400; color:var(--brand-gold);">· ${m.role}</span></div>
            ${m.bio ? `<div style="font-size:12px; color:rgba(255,255,255,0.7); margin-top:2px;">${m.bio}</div>` : ''}
          </div>
        </div>
        <button onclick="deleteTeamMember(${idx})" style="background:none; border:none; color:#ff6b6b; cursor:pointer; font-size:16px;">🗑️</button>
      </div>
    `).join('') || '<p style="font-size:13px; color:rgba(255,255,255,0.4);">No team members added yet.</p>';
  }
}

async function addTeamMember() {
  const name = $('tmName').value.trim();
  const role = $('tmRole').value.trim();
  const bio = $('tmBio').value.trim();
  const photoInput = $('tmPhoto');

  if (!name || !role) { toast('Please provide both name and role', 'error'); return; }

  let photo = '';
  if (photoInput && photoInput.files && photoInput.files[0]) {
    photo = await fileToBase64(photoInput.files[0]);
  }

  const res = await apiPost('/api/admin/team', { name, role, bio, photo });
  if (res.error) { toast(res.error, 'error'); return; }

  teamMembers = res.teamMembers || teamMembers;
  toast(`Added ${name} to team!`);
  $('tmName').value = ''; $('tmRole').value = ''; $('tmBio').value = '';
  if (photoInput) photoInput.value = '';
  if ($('tmPhotoPreview')) $('tmPhotoPreview').style.display = 'none';
  renderTeamMembers();
}

async function deleteTeamMember(index) {
  if (!confirm('Remove this team member?')) return;
  const res = await apiDelete(`/api/admin/team/${index}`);
  teamMembers = res.teamMembers || [];
  toast('Team member removed');
  renderTeamMembers();
}

// ===================== INITIAL APP LOAD =====================
async function initApp() {
  try {
    const data = await apiGet('/api/all-data');
    if (data && Array.isArray(data.teamMembers)) {
      teamMembers = data.teamMembers;
    }
    renderTeamMembers();
  } catch (err) {
    console.error('Failed to load initial app data:', err);
  }
}

window.addEventListener('DOMContentLoaded', initApp);

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

function setJudgeTab(tab) {
  judgeTab = tab;
  $('tabJudgeTop20').classList.toggle('active', tab === 'top20');
  $('tabJudgeChallenge').classList.toggle('active', tab === 'challenge');
  renderJudgePanel();
}

function renderJudgePanel() {
  const container = $('judgeSubmissions');
  let divSubs = getSubsForDivision(currentJudge.division);

  if (judgeTab === 'challenge') {
    divSubs = divSubs.filter(s => s.entryType === 'challenge');
  } else {
    divSubs = divSubs.filter(s => s.entryType !== 'challenge');
  }

  if (divSubs.length === 0) {
    container.innerHTML = `<p class="text-center text-tertiary" style="padding:40px;font-size:16px;">No ${judgeTab === 'challenge' ? 'challenge' : 'Top 20'} submissions available for your division right now.</p>`;
    return;
  }

  container.innerHTML = divSubs.map(sub => {
    const myScore = scores[sub.id]?.[currentJudge.name];
    const isScored = !!myScore;
    const c = myScore ? myScore.criteria : (editingScores[sub.id] || [0, 0, 0, 0]);

    const activeDivKey = currentJudge.division === 'gospelpraise' ? currentGospelSubTab : currentJudge.division;
    const divColor = divisions[activeDivKey]?.color || '#d4af37';
    const total = isScored ? myScore.total : Math.round(((c[0] + c[1] + c[2] + c[3]) / 40) * 100);

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
          ${(sub.tags || []).map(t => `<span class="tag ${t}">#${t}</span>`).join('')}
          ${sub.entryType === 'challenge' ? '<span class="challenge-badge">Challenge</span>' : ''}
        </div>
        ${sub.image ? `<img src="${sub.image}" class="submission-img" style="margin-top:10px;max-width:200px;border-radius:8px;">` : ''}
        <a href="${sub.link}" target="_blank" class="link-btn" style="font-size:14px;padding:10px 18px;margin-top:12px;display:inline-block;background:var(--brand-gold);color:#1a1a2e;font-weight:700;border-radius:6px;text-decoration:none;">▶️ Play Song</a>

        <div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.1);">
          <p style="font-size:14px;font-weight:700;color:rgba(255,255,255,0.8);margin-bottom:14px;">Score this song (0-10 each):</p>
          <div class="criteria-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:12px;">
            <div class="criterion">
              <label style="font-size:13px;display:block;margin-bottom:4px;">Vocals</label>
              <div class="score-control" style="display:flex;align-items:center;gap:8px;">
                <button class="score-btn" onclick="adjustScore('${sub.id}', 'vocals', -1)">−</button>
                <span class="score-value" id="val-vocals-${sub.id}">${c[0]}</span>
                <button class="score-btn" onclick="adjustScore('${sub.id}', 'vocals', 1)">+</button>
              </div>
            </div>
            <div class="criterion">
              <label style="font-size:13px;display:block;margin-bottom:4px;">Production</label>
              <div class="score-control" style="display:flex;align-items:center;gap:8px;">
                <button class="score-btn" onclick="adjustScore('${sub.id}', 'production', -1)">−</button>
                <span class="score-value" id="val-production-${sub.id}">${c[1]}</span>
                <button class="score-btn" onclick="adjustScore('${sub.id}', 'production', 1)">+</button>
              </div>
            </div>
            <div class="criterion">
              <label style="font-size:13px;display:block;margin-bottom:4px;">Originality</label>
              <div class="score-control" style="display:flex;align-items:center;gap:8px;">
                <button class="score-btn" onclick="adjustScore('${sub.id}', 'originality', -1)">−</button>
                <span class="score-value" id="val-originality-${sub.id}">${c[2]}</span>
                <button class="score-btn" onclick="adjustScore('${sub.id}', 'originality', 1)">+</button>
              </div>
            </div>
            <div class="criterion">
              <label style="font-size:13px;display:block;margin-bottom:4px;">Impact</label>
              <div class="score-control" style="display:flex;align-items:center;gap:8px;">
                <button class="score-btn" onclick="adjustScore('${sub.id}', 'impact', -1)">−</button>
                <span class="score-value" id="val-impact-${sub.id}">${c[3]}</span>
                <button class="score-btn" onclick="adjustScore('${sub.id}', 'impact', 1)">+</button>
              </div>
            </div>
          </div>

          <div class="score-display" style="margin-top:16px;display:flex;justify-content:space-between;align-items:center;">
            <span class="label" style="font-size:15px;">Current Total</span>
            <span class="value" id="display-total-${sub.id}" style="font-size:32px;font-weight:800;color:var(--brand-gold);">${total}%</span>
          </div>

          <div id="btn-container-${sub.id}" style="margin-top:12px;">
            ${isScored
              ? `<button class="btn btn-secondary score-edit-btn" onclick="enableEdit('${sub.id}')">✏️ Edit My Score</button>`
              : `<button class="btn btn-gold save-score-btn" id="save-btn-${sub.id}" onclick="saveScore('${sub.id}')">💾 Save My Score</button>`
            }
          </div>

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

  const valEl = $(`val-${criterion}-${subId}`);
  if (valEl) valEl.textContent = editingScores[subId][idx];

  const sum = editingScores[subId].reduce((a, b) => a + b, 0);
  const pct = Math.round((sum / 40) * 100);
  const totalEl = $(`display-total-${subId}`);
  if (totalEl) totalEl.textContent = pct + '%';
}

function enableEdit(subId) {
  const myScore = scores[subId]?.[currentJudge.name];
  if (!myScore) return;
  editingScores[subId] = [...myScore.criteria];

  const container = $(`btn-container-${subId}`);
  if (container) {
    container.innerHTML = `<button class="btn btn-gold save-score-btn" id="save-btn-${subId}" onclick="saveScore('${subId}')">💾 Update My Score</button>`;
  }
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

// ===================== PUBLIC VIEW =====================
function setPublicTab(tab) {
  publicTab = tab;
  document.querySelectorAll('#screenPublic .tab').forEach(t => t.classList.remove('active'));
  const activeTabBtn = $('tab' + tab.charAt(0).toUpperCase() + tab.slice(1));
  if (activeTabBtn) activeTabBtn.classList.add('active');

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
  if (window.event && window.event.target) window.event.target.classList.add('active');

  if (div === 'all') {
    setBodyClass('main-page');
  } else {
    setBodyClass('div-' + div);
  }

  if (publicTab === 'top20') renderTop20();
}

function renderTop20() {
  const list = $('top20List');
  if (!list) return;
  const divs = Object.keys(divisions);

  let html = '';
  divs.forEach(div => {
    if (publicDivFilter !== 'all' && publicDivFilter !== div) return;
    const divSubs = getSubsForDivision(div)
      .filter(s => s.entryType !== 'challenge')
      .map(s => ({ ...s, avg: getAverageScore(s.id) }))
      .sort((a, b) => (b.avg || 0) - (a.avg || 0))
      .slice(0, 20);

    if (divSubs.length === 0) return;

    const divColor = divisions[div].color;
    const divLogo = divisionLogos[div];
    const divJudges = Object.values(judges).filter(j => j.division === div);

    html += `<div class="div-header" style="border-left: 4px solid ${divColor}; padding:12px; background:rgba(255,255,255,0.03); border-radius:8px; margin-top:16px; display:flex; align-items:center;">`;
    if (divLogo) {
      html += `<img src="${divLogo}" alt="${divisions[div].name}" style="width:40px;height:40px;object-fit:contain;border-radius:6px;margin-right:12px;">`;
    }
    html += `<div style="flex:1;"><h2 style="color:${divColor};margin:0;font-size:18px;">${divisions[div].name}</h2></div>`;

    if (divJudges.length > 0) {
      html += `<div style="display:flex;gap:6px;align-items:center;">`;
      divJudges.forEach(j => {
        if (j.photo) {
          html += `<img src="${j.photo}" title="Judge: ${j.name}" style="width:32px;height:32px;object-fit:cover;border-radius:50%;border:2px solid ${divColor};">`;
        } else {
          html += `<div title="Judge: ${j.name}" style="width:32px;height:32px;border-radius:50%;background:${divColor};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:white;">${j.name.split(' ').map(n=>n[0]).join('').slice(0,2)}</div>`;
        }
      });
      html += `</div>`;
    }
    html += `</div>`;

    html += divSubs.map((sub, idx) => `
      <div class="card" style="margin-top:10px; display:flex; align-items:center; justify-content:space-between; gap:12px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="font-size:20px; font-weight:800; color:${idx < 3 ? 'var(--brand-gold)' : 'rgba(255,255,255,0.4)'}; width:28px;">#${idx + 1}</div>
          ${sub.image ? `<img src="${sub.image}" style="width:48px;height:48px;object-fit:cover;border-radius:6px;">` : ''}
          <div>
            <a href="${sub.link}" target="_blank" style="font-weight:700;font-size:15px;color:white;text-decoration:none;">${sub.title}</a>
            <div style="font-size:13px;color:rgba(255,255,255,0.6);">by ${sub.author}</div>
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-weight:800;font-size:18px;color:var(--brand-gold);">${sub.avg !== null ? sub.avg + '%' : 'Pending'}</div>
        </div>
      </div>
    `).join('');
  });

  list.innerHTML = html || '<p class="text-center text-tertiary" style="padding:40px;">No submissions found.</p>';
}

function renderChallenges() {
  const list = $('challengesList');
  if (!list) return;
  const chals = getChallengeSubs();
  const divs = ['english', 'afrikaans'];

  let html = '';
  divs.forEach(div => {
    const divChals = chals.filter(c => c.challengeDivision === div || c.tags?.includes(div));
    const img = challengeImages[currentWeekId]?.[div];

    html += `<div style="margin-top:20px;"><h2 style="color:${divisions[div].color}; font-size:18px; margin-bottom:10px;">${divisions[div].name} Challenge</h2>`;
    if (img) html += `<img src="${img}" style="width:100%; max-height:200px; object-fit:cover; border-radius:10px; margin-bottom:14px;">`;

    if (divChals.length === 0) {
      html += '<p style="font-size:13px; color:rgba(255,255,255,0.4);">No challenge entries for this division yet.</p></div>';
      return;
    }

    html += divChals.map(sub => `
      <div class="card" style="border-left:4px solid ${divisions[div].color}; margin-bottom:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-weight:700; font-size:16px;">${sub.title}</div>
            <div style="font-size:13px; color:rgba(255,255,255,0.6);">by ${sub.author}</div>
          </div>
          <a href="${sub.link}" target="_blank" style="padding:6px 12px; background:var(--brand-gold); color:#1a1a2e; text-decoration:none; font-weight:700; border-radius:6px; font-size:12px;">Play</a>
        </div>
      </div>
    `).join('') + '</div>';
  });

  list.innerHTML = html;
}

function renderResults() {
  if (!resultsRevealed) {
    show('resultsCountdownWrap'); hide('resultsContent');
    updateCountdown();
  } else {
    hide('resultsCountdownWrap'); show('resultsContent');
    const rankings = getRankings();
    if (rankings.length === 0) {
      $('resultsList').innerHTML = '<p class="text-center text-tertiary" style="padding:40px;">No final scores available.</p>';
      return;
    }
    if ($('podium1Name')) $('podium1Name').textContent = rankings[0]?.title || '—';
    if ($('podium1Score')) $('podium1Score').textContent = rankings[0]?.avg !== undefined ? rankings[0].avg + '%' : '—';
    if ($('podium2Name')) $('podium2Name').textContent = rankings[1]?.title || '—';
    if ($('podium2Score')) $('podium2Score').textContent = rankings[1]?.avg !== undefined ? rankings[1].avg + '%' : '—';
    if ($('podium3Name')) $('podium3Name').textContent = rankings[2]?.title || '—';
    if ($('podium3Score')) $('podium3Score').textContent = rankings[2]?.avg !== undefined ? rankings[2].avg + '%' : '—';

    $('resultsList').innerHTML = rankings.slice(3).map((sub, idx) => `
      <div class="card" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="font-weight:700; color:rgba(255,255,255,0.5);">#${idx + 4}</div>
          <div>
            <div style="font-weight:700;">${sub.title}</div>
            <div style="font-size:12px; color:rgba(255,255,255,0.5);">by ${sub.author}</div>
          </div>
        </div>
        <div style="font-weight:800; color:var(--brand-gold);">${sub.avg}%</div>
      </div>
    `).join('');
  }
}

function updateCountdown() {
  if (resultsRevealed) return;
  const diff = revealTime - Date.now();
  if (diff <= 0) {
    ['Days', 'Hours', 'Mins', 'Secs'].forEach(u => { if ($(`cd${u}`)) $(`cd${u}`).textContent = '00'; });
    return;
  }
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if ($('cdDays')) $('cdDays').textContent = String(d).padStart(2, '0');
  if ($('cdHours')) $('cdHours').textContent = String(h).padStart(2, '0');
  if ($('cdMins')) $('cdMins').textContent = String(m).padStart(2, '0');
  if ($('cdSecs')) $('cdSecs').textContent = String(s).padStart(2, '0');
}
setInterval(updateCountdown, 1000);

// ===================== ADMIN PANEL =====================
async function loginAdmin() {
  const pw = $('adminPassword').value;
  try {
    const res = await apiPost('/api/admin/login', { password: pw });
    if (res.error) throw new Error(res.error);
    adminLoggedIn = true;
    if ($('headerBadge')) $('headerBadge').innerHTML = '<span class="badge">Admin</span>';
    showScreen('screenAdmin');
    setAdminTab('submissions');
  } catch (e) {
    if ($('adminLoginError')) $('adminLoginError').style.display = 'block';
  }
}

function setAdminTab(tab) {
  document.querySelectorAll('#screenAdmin .tab').forEach(t => t.classList.remove('active'));
  const tabBtn = $('tabAdmin' + tab.charAt(0).toUpperCase() + tab.slice(1));
  if (tabBtn) tabBtn.classList.add('active');

  hide('adminSubmissions'); hide('adminJudges'); hide('adminResults'); hide('adminSettings');
  show('admin' + tab.charAt(0).toUpperCase() + tab.slice(1));

  if (tab === 'submissions') renderAdminSubmissions();
  if (tab === 'judges') renderAdminJudges();
  if (tab === 'results') renderAdminResults();
  if (tab === 'settings') renderAdminSettings();
}

function updateDivisionOptions() {
  const type = $('mType').value;
  const divSelect = $('mChallengeDiv');
  if (!divSelect) return;

  if (type === 'challenge') {
    divSelect.innerHTML = `
      <option value="english">English</option>
      <option value="afrikaans">Afrikaans</option>
    `;
  } else {
    divSelect.innerHTML = `
      <option value="english">English</option>
      <option value="afrikaans">Afrikaans</option>
      <option value="gospel">Gospel</option>
      <option value="praiseandworship">Praise & Worship</option>
      <option value="liveartists">Live Artists</option>
    `;
  }
}

async function addManualSubmission() {
  const author = $('mAuthor').value.trim();
  const title = $('mTitle').value.trim();
  const link = $('mLink').value.trim();
  const tagsRaw = $('mTags').value.trim();
  const entryType = $('mType').value;
  const div = $('mChallengeDiv').value;
  const imageInput = $('mImage');

  if (!author || !title || !link) {
    toast('Please fill in Artist Name, Title, and Link', 'error');
    return;
  }

  let tags = tagsRaw.split(' ').map(t => t.replace('#', '')).filter(Boolean);
  if (!tags.includes(div)) tags.push(div);

  let image = '';
  if (imageInput && imageInput.files && imageInput.files[0]) {
    image = await fileToBase64(imageInput.files[0]);
  }

  const res = await apiPost('/api/submissions', {
    author, title, link, tags, entryType,
    challengeDivision: div, image, weekId: currentWeekId
  });

  if (res.error) { toast(res.error, 'error'); return; }

  toast('Submission added successfully!');
  $('mAuthor').value = ''; $('mTitle').value = ''; $('mLink').value = ''; $('mTags').value = '';
  if (imageInput) imageInput.value = '';
  if ($('mImagePreview')) $('mImagePreview').style.display = 'none';

  await loadData();
  renderAdminSubmissions();
}

async function uploadChallengeImage() {
  const div = $('challengeImgDiv').value;
  const fileInput = $('challengeImg');
  if (!fileInput || !fileInput.files || !fileInput.files[0]) {
    toast('Please select an image file', 'error');
    return;
  }

  const base64 = await fileToBase64(fileInput.files[0]);
  const res = await apiPost('/api/admin/challenge-image', { division: div, image: base64, weekId: currentWeekId });
  if (res.error) { toast(res.error, 'error'); return; }

  toast(`Challenge banner uploaded for ${divisions[div]?.name || div}!`);
  fileInput.value = '';
  if ($('challengeImgPreview')) $('challengeImgPreview').style.display = 'none';
  await loadData();
}

function filterAdmin(tag) {
  adminDivFilter = tag;
  document.querySelectorAll('#adminFilters .filter-btn').forEach(b => b.classList.remove('active'));
  if (window.event && window.event.target) window.event.target.classList.add('active');
  renderAdminSubmissions();
}

function renderAdminSubmissions() {
  const container = $('adminSubmissionList');
  if (!container) return;
  let subs = submissions;
  if (adminDivFilter !== 'all') subs = subs.filter(s => s.tags && s.tags.includes(adminDivFilter));

  container.innerHTML = subs.map(sub => {
    const subScores = scores[sub.id] || {};
    const judgeCount = Object.keys(subScores).length;
    const avg = getAverageScore(sub.id);
    return `
      <div class="card" style="margin-top:12px;">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div>
            <div class="card-title" style="font-weight:700; font-size:16px;">${sub.title}</div>
            <div class="card-meta" style="font-size:13px; color:rgba(255,255,255,0.6);">by ${sub.author} · ${(sub.tags || []).map(t => '#' + t).join(' ')}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:12px;color:rgba(255,255,255,0.5);">${judgeCount} judge(s) scored</div>
            <div style="font-size:20px;font-weight:800;color:var(--brand-gold);">${avg !== null ? avg + '%' : '—'}</div>
          </div>
        </div>
        ${sub.entryType === 'challenge' ? '<span class="challenge-badge">Challenge</span>' : ''}
        ${sub.image ? `<img src="${sub.image}" style="margin-top:10px; max-width:120px; border-radius:6px;">` : ''}
        <div style="margin-top:12px; display:flex; justify-content:space-between; align-items:center;">
          <a href="${sub.link}" target="_blank" style="font-size:12px; color:var(--brand-gold);">Open Link 🔗</a>
          <button class="btn btn-danger" style="width:auto;padding:4px 12px;font-size:12px;" onclick="deleteSubmission('${sub.id}')">🗑️ Delete</button>
        </div>
      </div>
    `;
  }).join('') || '<p class="text-center text-tertiary" style="padding:40px;">No submissions found.</p>';
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
        <td style="font-weight:600; padding:10px;">${j.name}</td>
        <td style="padding:10px;">${j.email}</td>
        <td style="padding:10px;"><span class="tag ${j.division}" style="font-size:11px; padding:2px 8px;">${divisions[j.division]?.name || j.division}</span></td>
        <td style="padding:10px; color:#6bff6b;">● Active</td>
        <td style="padding:10px;">${j.hasSetPassword ? '✓ Changed' : 'Admin Set'}</td>
        <td style="padding:10px;">${scoreCount} / ${totalSubs}</td>
        <td style="padding:10px;"><button onclick="deleteJudge('${id}')" style="background:none;border:none;color:#ff6b6b;cursor:pointer;font-size:16px;">🗑️</button></td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="7" style="text-align:center; padding:20px;">No judges configured.</td></tr>';
}

async function addJudge() {
  const name = $('newJudgeName').value.trim();
  const email = $('newJudgeEmail').value.trim();
  const division = $('newJudgeDiv').value;
  const password = $('newJudgePassword').value;
  const photoInput = $('newJudgePhoto');

  if (!name || !email || !division || !password) {
    toast('Fill all fields including password', 'error');
    return;
  }

  let photo = '';
  if (photoInput && photoInput.files && photoInput.files[0]) {
    photo = await fileToBase64(photoInput.files[0]);
  }

  const res = await apiPost('/api/judges', { name, email, division, password, photo });
  if (res.error) { toast(res.error, 'error'); return; }
  toast(`Judge ${name} added successfully!`);
  $('newJudgeName').value = ''; $('newJudgeEmail').value = ''; $('newJudgePassword').value = '';
  if (photoInput) photoInput.value = '';
  if ($('newJudgePhotoPreview')) $('newJudgePhotoPreview').style.display = 'none';
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
  const summary = $('adminScoreSummary');
  if (summary) {
    summary.innerHTML = `
      <div style="font-size:14px;margin-bottom:8px;"><span style="color:rgba(255,255,255,0.6);">Week ID:</span> <b>${currentWeekId}</b></div>
      <div style="font-size:14px;margin-bottom:8px;"><span style="color:rgba(255,255,255,0.6);">Total Scored:</span> <b>${rankings.length} / ${submissions.length}</b></div>
      <div style="font-size:14px;margin-bottom:8px;"><span style="color:rgba(255,255,255,0.6);">Current Leader:</span> <b>${rankings[0]?.title || 'None'}</b> ${rankings[0]?.avg !== undefined ? '(' + rankings[0].avg + '%)' : ''}</div>
      <div style="font-size:14px;"><span style="color:rgba(255,255,255,0.6);">Status:</span> <b style="color:${resultsRevealed ? '#6bff6b' : 'var(--brand-gold)'}">${resultsRevealed ? 'REVEALED' : 'HIDDEN'}</b></div>
    `;
  }
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
  toast('Results hidden from public.');
  renderAdminResults();
}

function exportExcel() {
  if (typeof XLSX === 'undefined') {
    toast('Excel library loading error. Try refreshing.', 'error');
    return;
  }

  const exportData = submissions.map(sub => {
    const subScores = scores[sub.id] || {};
    const row = {
      'Submission ID': sub.id,
      'Title': sub.title,
      'Artist': sub.author,
      'Entry Type': sub.entryType || 'top20',
      'Tags': (sub.tags || []).join(', '),
      'Link': sub.link,
      'Average Score': getAverageScore(sub.id) || 'N/A'
    };

    Object.entries(subScores).forEach(([jName, scoreObj]) => {
      row[`Judge (${jName}) Total`] = scoreObj.total + '%';
      row[`Judge (${jName}) Breakdown`] = scoreObj.criteria.join('/');
    });

    return row;
  });

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Submissions & Scores');
  XLSX.writeFile(workbook, `Astra_Musica_${currentWeekId}_Results.xlsx`);
  toast('Excel export downloaded!');
}

async function changeAdminPassword() {
  const oldPw = $('adminOldPassword').value;
  const newPw = $('adminNewPassword').value;
  const confirmPw = $('adminConfirmPassword').value;

  if (!oldPw || !newPw) { toast('Fill all password fields', 'error'); return; }
  if (newPw !== confirmPw) { toast('New passwords do not match', 'error'); return; }
  if (newPw.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }

  const res = await apiPost('/api/admin/change-password', { oldPassword: oldPw, newPassword: newPw });
  if (res.error) { toast(res.error, 'error'); return; }

  toast('Admin password updated successfully!');
  $('adminOldPassword').value = '';
  $('adminNewPassword').value = '';
  $('adminConfirmPassword').value = '';
}

async function resetWeek() {
  if (!confirm('WARNING: This will clear all submissions and scores for the current week. Continue?')) return;
  const res = await apiPost('/api/admin/reset-week', {});
  await loadData();
  toast('New week started!');
  renderAdminSubmissions();
  renderAdminResults();
}

function renderAdminSettings() {
  renderDivisionLogoSettings();
  renderNotificationSettings();
}

function renderNotificationSettings() {
  const status = $('emailStatus');
  if (status) {
    status.textContent = emailEnabled ? 'Active (Configured)' : 'Disabled / Not Configured';
    status.style.color = emailEnabled ? '#6bff6b' : '#ff6b6b';
  }
  if ($('testEmailWrap')) $('testEmailWrap').style.display = emailEnabled ? 'block' : 'none';

  const list = $('whatsappNotifyList');
  if (list) {
    list.innerHTML = Object.values(judges).map(j => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
        <div>
          <div style="font-size:13px; font-weight:600;">${j.name}</div>
          <div style="font-size:11px; color:rgba(255,255,255,0.5);">${divisions[j.division]?.name || j.division}</div>
        </div>
        <a href="https://wa.me/?text=${encodeURIComponent(`Hi ${j.name}, new submissions are ready for judging in ${divisions[j.division]?.name || j.division} on Astra Musica!`)}" target="_blank" class="btn btn-secondary" style="font-size:11px; padding:4px 10px; text-decoration:none;">📲 Send WhatsApp</a>
      </div>
    `).join('') || '<p style="font-size:12px; color:rgba(255,255,255,0.4);">No judges available.</p>';
  }
}

async function sendTestEmail() {
  const email = $('testEmailInput').value.trim();
  if (!email) { toast('Enter email address', 'error'); return; }
  const res = await apiPost('/api/admin/test-email', { email });
  if (res.error) { toast(res.error, 'error'); return; }
  toast('Test email sent successfully!');
}

async function updateLogo() {
  const url = $('logoUrl').value.trim();
  if (!url) { toast('Please enter a valid logo URL', 'error'); return; }
  await apiPost('/api/admin/logo', { logoUrl: url });
  if ($('logoBox')) $('logoBox').innerHTML = `<img src="${url}" alt="Logo" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`;
  toast('Main logo updated!');
}

async function uploadLogoFile() {
  const input = $('logoFileInput');
  if (!input || !input.files || !input.files[0]) {
    toast('Select a logo image file', 'error');
    return;
  }
  const base64 = await fileToBase64(input.files[0]);
  await apiPost('/api/admin/logo', { logoUrl: base64 });
  if ($('logoBox')) $('logoBox').innerHTML = `<img src="${base64}" alt="Logo" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`;
  toast('Main logo uploaded!');
}

function renderDivisionLogoSettings() {
  const container = $('divisionLogosList');
  if (!container) return;

  container.innerHTML = Object.keys(divisions).map(div => {
    const divColor = divisions[div].color;
    const currentLogo = divisionLogos[div] || '';
    return `
      <div class="card" style="border-left: 4px solid ${divColor}; margin-bottom: 10px; padding:12px;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
          <b style="color:${divColor}; font-size:14px;">${divisions[div].name}</b>
          ${currentLogo ? `<img src="${currentLogo}" style="max-width:36px; max-height:36px; object-fit:contain; border-radius:4px;">` : ''}
        </div>
        <div style="display: flex; gap: 8px; margin-top: 8px;">
          <input type="text" id="logo-input-${div}" value="${currentLogo}" placeholder="Logo URL..." style="flex: 1; padding:6px; font-size:12px;">
          <button class="btn btn-primary" style="width:auto; padding:6px 12px; font-size:12px;" onclick="saveDivisionLogo('${div}')">Save</button>
        </div>
      </div>
    `;
  }).join('');
}

async function saveDivisionLogo(div) {
  const url = $(`logo-input-${div}`).value.trim();
  divisionLogos[div] = url;
  await apiPost('/api/admin/division-logos', { division: div, logoUrl: url });
  toast(`Logo updated for ${divisions[div].name}!`);
  renderDivisionLogoSettings();
}

// ===================== FILE PREVIEWS & BINDINGS =====================
function setupImagePreviews() {
  const bindPreview = (inputId, previewId) => {
    const input = $(inputId);
    const preview = $(previewId);
    if (input && preview) {
      input.addEventListener('change', async () => {
        if (input.files && input.files[0]) {
          preview.src = await fileToBase64(input.files[0]);
          preview.style.display = 'block';
        }
      });
    }
  };

  bindPreview('mImage', 'mImagePreview');
  bindPreview('challengeImg', 'challengeImgPreview');
  bindPreview('newJudgePhoto', 'newJudgePhotoPreview');
  bindPreview('tmPhoto', 'tmPhotoPreview');
}

// ===================== INITIALIZATION =====================
window.addEventListener('DOMContentLoaded', async () => {
  setupImagePreviews();

  // Attach dynamic save button to manual submission form if missing
  const parentForm = document.querySelector('#adminSubmissions .manual-form');
  if (parentForm && !parentForm.querySelector('button.btn-gold')) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-gold full';
    btn.style.marginTop = '12px';
    btn.textContent = '➕ Save Submission';
    btn.onclick = addManualSubmission;
    parentForm.appendChild(btn);
  }

  // Load backend data and display role screen
  await loadData();
  showScreen('screenRole');
});