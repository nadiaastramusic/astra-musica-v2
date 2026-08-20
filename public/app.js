// ===================== CONFIG =====================
const API = '';
const divisions = {
  english: { name: 'English', color: '#C41E3A' },
  afrikaans: { name: 'Afrikaans', color: '#228B22' },
  gospelpraise: { name: 'Gospel & Praise & Worship', color: '#7B4FA0' },
  liveartists: { name: 'Live Artists', color: '#008080' }
};

// Sub-division colours for merged tabs (not full divisions)
const subDivisionColors = {
  gospel: '#7B4FA0',
  praiseandworship: '#7B4FA0'
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
let publicGospelSubTab = 'all';
let adminDivFilter = 'all';
let judgeTab = 'top20';
let currentGospelSubTab = 'gospel';
let challengeImages = {};
let divisionLogos = {};
let teamMembers = [];
let emailEnabled = false;
let editingScores = {};
let mainLogoUrl = '';

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

// PUBLIC / ADMIN — shows everything inside the merged division
function getSubsForDivision(div, weekId = currentWeekId) {
  let subs = submissions.filter(s => s.weekId === weekId);
  if (div === 'gospelpraise') {
    return subs.filter(s => s.tags && (s.tags.includes('gospel') || s.tags.includes('praiseandworship')));
  }
  return subs.filter(s => s.tags && s.tags.includes(div));
}

// JUDGE ONLY — respects the active Gospel / P&W sub-tab
function getJudgeQueue(div, weekId = currentWeekId) {
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

// ===================== BACKDROP HELPERS =====================
function setBackdrop(elementId, imageUrl) {
  const el = $(elementId);
  if (!el) return;
  if (imageUrl) {
    el.style.backgroundImage = 'url(' + imageUrl + ')';
    el.classList.add('active');
  } else {
    el.style.backgroundImage = '';
    el.classList.remove('active');
  }
}

function clearBackdrop(elementId) {
  setBackdrop(elementId, '');
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
    mainLogoUrl = allData.mainLogo;
  }
  renderMainLogo();
  renderTeamMembers();
}

// ===================== LOGO RENDERING =====================
function renderMainLogo() {
  const logoBox = $('logoBox');
  const backdrop = $('mainLogoBackdrop');
  if (logoBox) {
    if (mainLogoUrl) {
      logoBox.innerHTML = '<img src="' + mainLogoUrl + '" alt="Astra Musica" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">';
    } else {
      logoBox.textContent = 'AM';
    }
  }
  // Set the persistent backdrop on the role screen
  if (backdrop) {
    if (mainLogoUrl) {
      backdrop.style.backgroundImage = 'url(' + mainLogoUrl + ')';
      backdrop.classList.add('active');
    } else {
      backdrop.style.backgroundImage = '';
      backdrop.classList.remove('active');
    }
  }
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
  // Clear division backdrops when returning home
  clearBackdrop('judgeBackdrop');
  clearBackdrop('publicBackdrop');
  renderMainLogo();
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
  toast('Added ' + name + ' to team!');
  $('tmName').value = ''; $('tmRole').value = ''; $('tmBio').value = '';
  if (photoInput) photoInput.value = '';
  if ($('tmPhotoPreview')) $('tmPhotoPreview').style.display = 'none';
  renderTeamMembers();
}

async function deleteTeamMember(index) {
  if (!confirm('Remove this team member?')) return;
  const res = await apiDelete('/api/admin/team/' + index);
  teamMembers = res.teamMembers || [];
  toast('Team member removed');
  renderTeamMembers();
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
    $('headerBadge').innerHTML = '<span class="badge" style="border-color:' + divColor + ';color:' + divColor + ';">Judge · ' + (divisions[currentJudge.division]?.name || 'Judge') + '</span>';
    $('judgeDivisionName').textContent = divisions[currentJudge.division]?.name || currentJudge.division;
    $('judgeDivisionName').style.color = divColor;
    setBodyClass('div-' + currentJudge.division);
    showScreen('screenJudge');
    // Set division logo as backdrop
    const divLogo = divisionLogos[currentJudge.division];
    setBackdrop('judgeBackdrop', divLogo || mainLogoUrl);
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

function renderJudgeGospelPraiseTabs() {
  const container = $('judgeGospelPraiseTabs');
  if (!container) return;
  if (currentJudge?.division === 'gospelpraise') {
    container.style.display = 'flex';
    const purple = subDivisionColors.gospel;
    container.innerHTML = '<button onclick="switchJudgeSubTab('gospel')" style="flex:1; padding:10px 16px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:' + (currentGospelSubTab === 'gospel' ? purple : 'rgba(0,0,0,0.3)') + '; color:' + (currentGospelSubTab === 'gospel' ? '#fff' : 'rgba(255,255,255,0.6)') + '; font-weight:700; cursor:pointer; font-size:13px;">Gospel</button>' +
      '<button onclick="switchJudgeSubTab('praiseandworship')" style="flex:1; padding:10px 16px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:' + (currentGospelSubTab === 'praiseandworship' ? purple : 'rgba(0,0,0,0.3)') + '; color:' + (currentGospelSubTab === 'praiseandworship' ? '#fff' : 'rgba(255,255,255,0.6)') + '; font-weight:700; cursor:pointer; font-size:13px;">Praise & Worship</button>';
  } else {
    container.style.display = 'none';
    container.innerHTML = '';
  }
}

function switchJudgeSubTab(tab) {
  currentGospelSubTab = tab;
  renderJudgePanel();
}

function renderJudgePanel() {
  renderJudgeGospelPraiseTabs();

  const container = $('judgeSubmissions');
  let divSubs = getJudgeQueue(currentJudge.division);

  if (judgeTab === 'challenge') {
    divSubs = divSubs.filter(s => s.entryType === 'challenge');
  } else {
    divSubs = divSubs.filter(s => s.entryType !== 'challenge');
  }

  if (divSubs.length === 0) {
    container.innerHTML = '<p class="text-center text-tertiary" style="padding:40px;font-size:16px;">No ' + (judgeTab === 'challenge' ? 'challenge' : 'Top 20') + ' submissions available for your division right now.</p>';
    return;
  }

  container.innerHTML = divSubs.map(sub => {
    const myScore = scores[sub.id]?.[currentJudge.name];
    const isScored = !!myScore;
    const c = myScore ? myScore.criteria : (editingScores[sub.id] || [0, 0, 0, 0]);

    const activeDivKey = currentJudge.division === 'gospelpraise' ? currentGospelSubTab : currentJudge.division;
    const divColor = divisions[activeDivKey]?.color || subDivisionColors[activeDivKey] || '#d4af37';
    const total = isScored ? myScore.total : Math.round(((c[0] + c[1] + c[2] + c[3]) / 40) * 100);

    return '<div class="card" style="border-left: 4px solid ' + divColor + ';" id="song-card-' + sub.id + '">' +
      '<div class="card-header"><div><div class="card-title" style="font-size:18px;">' + sub.title + '</div><div class="card-meta" style="font-size:14px;">by ' + sub.author + ' · ' + formatDate(sub.timestamp) + '</div></div>' +
      (isScored ? '<span style="font-size:13px;color:#6bff6b;font-weight:700;background:rgba(107,255,107,0.1);padding:4px 12px;border-radius:20px;">✓ Scored ' + myScore.total + '%</span>' : '<span style="font-size:13px;color:var(--brand-gold);font-weight:700;background:rgba(212,175,55,0.1);padding:4px 12px;border-radius:20px;">Not Scored</span>') +
      '</div>' +
      '<div class="tags">' + (sub.tags || []).map(t => '<span class="tag ' + t + '">#' + t + '</span>').join('') + (sub.entryType === 'challenge' ? '<span class="challenge-badge">Challenge</span>' : '') + '</div>' +
      (sub.image ? '<img src="' + sub.image + '" class="submission-img" style="margin-top:10px;max-width:200px;border-radius:8px;">' : '') +
      '<a href="' + sub.link + '" target="_blank" class="link-btn" style="font-size:14px;padding:10px 18px;margin-top:12px;display:inline-block;background:var(--brand-gold);color:#1a1a2e;font-weight:700;border-radius:6px;text-decoration:none;">▶️ Play Song</a>' +
      '<div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.1);">' +
      '<p style="font-size:14px;font-weight:700;color:rgba(255,255,255,0.8);margin-bottom:14px;">Score this song (0-10 each):</p>' +
      '<div class="criteria-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:12px;">' +
      '<div class="criterion"><label style="font-size:13px;display:block;margin-bottom:4px;">Vocals</label><div class="score-control" style="display:flex;align-items:center;gap:8px;"><button class="score-btn" onclick="adjustScore('' + sub.id + '', 'vocals', -1)">−</button><span class="score-value" id="val-vocals-' + sub.id + '">' + c[0] + '</span><button class="score-btn" onclick="adjustScore('' + sub.id + '', 'vocals', 1)">+</button></div></div>' +
      '<div class="criterion"><label style="font-size:13px;display:block;margin-bottom:4px;">Production</label><div class="score-control" style="display:flex;align-items:center;gap:8px;"><button class="score-btn" onclick="adjustScore('' + sub.id + '', 'production', -1)">−</button><span class="score-value" id="val-production-' + sub.id + '">' + c[1] + '</span><button class="score-btn" onclick="adjustScore('' + sub.id + '', 'production', 1)">+</button></div></div>' +
      '<div class="criterion"><label style="font-size:13px;display:block;margin-bottom:4px;">Originality</label><div class="score-control" style="display:flex;align-items:center;gap:8px;"><button class="score-btn" onclick="adjustScore('' + sub.id + '', 'originality', -1)">−</button><span class="score-value" id="val-originality-' + sub.id + '">' + c[2] + '</span><button class="score-btn" onclick="adjustScore('' + sub.id + '', 'originality', 1)">+</button></div></div>' +
      '<div class="criterion"><label style="font-size:13px;display:block;margin-bottom:4px;">Impact</label><div class="score-control" style="display:flex;align-items:center;gap:8px;"><button class="score-btn" onclick="adjustScore('' + sub.id + '', 'impact', -1)">−</button><span class="score-value" id="val-impact-' + sub.id + '">' + c[3] + '</span><button class="score-btn" onclick="adjustScore('' + sub.id + '', 'impact', 1)">+</button></div></div>' +
      '</div>' +
      '<div class="score-display" style="margin-top:16px;display:flex;justify-content:space-between;align-items:center;"><span class="label" style="font-size:15px;">Current Total</span><span class="value" id="display-total-' + sub.id + '" style="font-size:32px;font-weight:800;color:var(--brand-gold);">' + total + '%</span></div>' +
      '<div id="btn-container-' + sub.id + '" style="margin-top:12px;">' + (isScored ? '<button class="btn btn-secondary score-edit-btn" onclick="enableEdit('' + sub.id + '')">✏️ Edit My Score</button>' : '<button class="btn btn-gold save-score-btn" id="save-btn-' + sub.id + '" onclick="saveScore('' + sub.id + '')">💾 Save My Score</button>') + '</div>' +
      '<p style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:10px;">' + (isScored ? '✓ Your score is saved. Other judges cannot see it.' : 'Adjust all 4 criteria, then click Save.') + '</p>' +
      '</div></div>';
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

  const valEl = $('val-' + criterion + '-' + subId);
  if (valEl) valEl.textContent = editingScores[subId][idx];

  const sum = editingScores[subId].reduce((a, b) => a + b, 0);
  const pct = Math.round((sum / 40) * 100);
  const totalEl = $('display-total-' + subId);
  if (totalEl) totalEl.textContent = pct + '%';
}

function enableEdit(subId) {
  const myScore = scores[subId]?.[currentJudge.name];
  if (!myScore) return;
  editingScores[subId] = [...myScore.criteria];

  const container = $('btn-container-' + subId);
  if (container) {
    container.innerHTML = '<button class="btn btn-gold save-score-btn" id="save-btn-' + subId + '" onclick="saveScore('' + subId + '')">💾 Update My Score</button>';
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
  publicGospelSubTab = 'all';
  document.querySelectorAll('#publicDivTabs .div-tab').forEach(b => b.classList.remove('active'));
  if (window.event && window.event.target) window.event.target.classList.add('active');

  if (div === 'all') {
    setBodyClass('main-page');
    clearBackdrop('publicBackdrop');
  } else {
    setBodyClass('div-' + div);
    // Set division logo as backdrop
    const divLogo = divisionLogos[div];
    setBackdrop('publicBackdrop', divLogo || mainLogoUrl);
  }

  if (publicTab === 'top20') renderTop20();
}

function setPublicGospelSubTab(tab) {
  publicGospelSubTab = tab;
  renderTop20();
}

function renderTop20() {
  const list = $('top20List');
  if (!list) return;
  const divs = Object.keys(divisions);

  let html = '';
  divs.forEach(div => {
    if (publicDivFilter !== 'all' && publicDivFilter !== div) return;

    let allDivSubs = getSubsForDivision(div)
      .filter(s => s.entryType !== 'challenge')
      .map(s => ({ ...s, avg: getAverageScore(s.id) }))
      .sort((a, b) => (b.avg || 0) - (a.avg || 0));

    let divSubs = allDivSubs;
    if (div === 'gospelpraise' && publicGospelSubTab !== 'all') {
      divSubs = allDivSubs.filter(s => s.tags && s.tags.includes(publicGospelSubTab));
    }
    divSubs = divSubs.slice(0, 20);

    if (allDivSubs.length === 0) return;

    const divColor = divisions[div].color;
    const divLogo = divisionLogos[div];
    const divJudges = Object.values(judges).filter(j => j.division === div);

    html += '<div class="div-header" style="border-left: 4px solid ' + divColor + '; padding:12px; background:rgba(255,255,255,0.03); border-radius:8px; margin-top:16px; display:flex; align-items:center;">';
    if (divLogo) {
      html += '<img src="' + divLogo + '" alt="' + divisions[div].name + '" style="width:40px;height:40px;object-fit:contain;border-radius:6px;margin-right:12px;">';
    }
    html += '<div style="flex:1;"><h2 style="color:' + divColor + ';margin:0;font-size:18px;">' + divisions[div].name + '</h2></div>';

    if (divJudges.length > 0) {
      html += '<div style="display:flex;gap:6px;align-items:center;">';
      divJudges.forEach(j => {
        if (j.photo) {
          html += '<img src="' + j.photo + '" title="Judge: ' + j.name + '" style="width:32px;height:32px;object-fit:cover;border-radius:50%;border:2px solid ' + divColor + ';">';
        } else {
          html += '<div title="Judge: ' + j.name + '" style="width:32px;height:32px;border-radius:50%;background:' + divColor + ';display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:white;">' + j.name.split(' ').map(n=>n[0]).join('').slice(0,2) + '</div>';
        }
      });
      html += '</div>';
    }
    html += '</div>';

    // Sub-tabs for Gospel & Praise & Worship on public view
    if (div === 'gospelpraise') {
      const purple = divisions.gospelpraise.color;
      html += '<div style="display:flex; gap:8px; margin: 12px 0;">' +
        '<button onclick="setPublicGospelSubTab('all')" style="flex:1; padding:8px 12px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:' + (publicGospelSubTab === 'all' ? purple : 'rgba(0,0,0,0.3)') + '; color:' + (publicGospelSubTab === 'all' ? '#fff' : 'rgba(255,255,255,0.6)') + '; font-weight:700; cursor:pointer; font-size:13px;">All</button>' +
        '<button onclick="setPublicGospelSubTab('gospel')" style="flex:1; padding:8px 12px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:' + (publicGospelSubTab === 'gospel' ? purple : 'rgba(0,0,0,0.3)') + '; color:' + (publicGospelSubTab === 'gospel' ? '#fff' : 'rgba(255,255,255,0.6)') + '; font-weight:700; cursor:pointer; font-size:13px;">Gospel</button>' +
        '<button onclick="setPublicGospelSubTab('praiseandworship')" style="flex:1; padding:8px 12px; border-radius:6px; border:1px solid rgba(255,255,255,0.1); background:' + (publicGospelSubTab === 'praiseandworship' ? purple : 'rgba(0,0,0,0.3)') + '; color:' + (publicGospelSubTab === 'praiseandworship' ? '#fff' : 'rgba(255,255,255,0.6)') + '; font-weight:700; cursor:pointer; font-size:13px;">Praise & Worship</button>' +
        '</div>';
    }

    if (divSubs.length === 0) {
      html += '<p style="padding:20px; color:rgba(255,255,255,0.4); font-size:13px;">No submissions in this category.</p>';
    } else {
      html += divSubs.map((sub, idx) => '<div class="card" style="margin-top:10px; display:flex; align-items:center; justify-content:space-between; gap:12px;">' +
        '<div style="display:flex; align-items:center; gap:12px;">' +
        '<div style="font-size:20px; font-weight:800; color:' + (idx < 3 ? 'var(--brand-gold)' : 'rgba(255,255,255,0.4)') + '; width:28px;">#' + (idx + 1) + '</div>' +
        (sub.image ? '<img src="' + sub.image + '" style="width:48px;height:48px;object-fit:cover;border-radius:6px;">' : '') +
        '<div><a href="' + sub.link + '" target="_blank" style="font-weight:700;font-size:15px;color:white;text-decoration:none;">' + sub.title + '</a><div style="font-size:13px;color:rgba(255,255,255,0.6);">by ' + sub.author + '</div></div>' +
        '</div>' +
        '<div style="text-align:right;"><div style="font-weight:800;font-size:18px;color:var(--brand-gold);">' + (sub.avg !== null ? sub.avg + '%' : 'Pending') + '</div></div>' +
        '</div>').join('');
    }
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

    html += '<div style="margin-top:20px;"><h2 style="color:' + divisions[div].color + '; font-size:18px; margin-bottom:10px;">' + divisions[div].name + ' Challenge</h2>';
    if (img) html += '<img src="' + img + '" style="width:100%; max-height:200px; object-fit:cover; border-radius:10px; margin-bottom:14px;">';

    if (divChals.length === 0) {
      html += '<p style="font-size:13px; color:rgba(255,255,255,0.4);">No challenge entries for this division yet.</p></div>';
      return;
    }

    html += divChals.map(sub => '<div class="card" style="border-left:4px solid ' + divisions[div].color + '; margin-bottom:10px;">' +
      '<div style="display:flex; justify-content:space-between; align-items:center;">' +
      '<div><div style="font-weight:700; font-size:16px;">' + sub.title + '</div><div style="font-size:13px; color:rgba(255,255,255,0.6);">by ' + sub.author + '</div></div>' +
      '<a href="' + sub.link + '" target="_blank" style="padding:6px 12px; background:var(--brand-gold); color:#1a1a2e; text-decoration:none; font-weight:700; border-radius:6px; font-size:12px;">Play</a>' +
      '</div></div>').join('') + '</div>';
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

    $('resultsList').innerHTML = rankings.slice(3).map((sub, idx) => '<div class="card" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">' +
      '<div style="display:flex; align-items:center; gap:12px;"><div style="font-weight:700; color:rgba(255,255,255,0.5);">#' + (idx + 4) + '</div><div><div style="font-weight:700;">' + sub.title + '</div><div style="font-size:12px; color:rgba(255,255,255,0.5);">by ' + sub.author + '</div></div></div>' +
      '<div style="font-weight:800; color:var(--brand-gold);">' + sub.avg + '%</div></div>').join('');
  }
}

function updateCountdown() {
  if (resultsRevealed) return;
  const diff = revealTime - Date.now();
  if (diff <= 0) {
    ['Days', 'Hours', 'Mins', 'Secs'].forEach(u => { if ($('cd' + u)) $('cd' + u).textContent = '00'; });
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