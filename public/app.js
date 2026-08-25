// ===================== CONFIG =====================
const API = '';
const divisions = {
  english: { name: 'English', color: '#C41E3A' },
  afrikaans: { name: 'Afrikaans', color: '#228B22' },
  gospelpraise: { name: 'Gospel & Praise & Worship', color: '#7B4FA0' },
  liveartists: { name: 'Live Artists', color: '#008080' }
};

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
let divisionRevealStatus = {
  english: false, afrikaans: false, gospel: false,
  praiseandworship: false, liveartists: false
};
let divisionRevealTimes = {
  english: new Date('2026-08-14T20:00:00').getTime(),
  afrikaans: new Date('2026-08-14T20:00:00').getTime(),
  gospel: new Date('2026-08-14T20:00:00').getTime(),
  praiseandworship: new Date('2026-08-14T20:00:00').getTime(),
  liveartists: new Date('2026-08-14T20:00:00').getTime()
};
let adminChallengeDiv = 'english';
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
let news = [];
let submissionLikes = {};
let editingJudgeId = null;
let editingTeamMemberIndex = null;
let dragSrcIndex = null;

// ===================== UTILS =====================
function $(id) { return document.getElementById(id); }
function show(id) { const el = $(id); if (el) el.classList.remove('hidden'); }
function hide(id) { const el = $(id); if (el) el.classList.add('hidden'); }
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
  show(id);
}
function toast(msg, type) {
  type = type || 'success';
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show ' + type;
  setTimeout(function() { t.classList.remove('show'); }, 3000);
}

function fileToBase64(file) {
  return new Promise(function(resolve, reject) {
    const reader = new FileReader();
    reader.onload = function() { resolve(reader.result); };
    reader.onerror = function(error) { reject(error); };
    reader.readAsDataURL(file);
  });
}

function getAverageScore(subId) {
  const subScores = scores[subId];
  if (!subScores) return null;
  const all = Object.values(subScores).map(function(s) { return s.total; });
  if (all.length === 0) return null;
  return Math.round(all.reduce(function(a, b) { return a + b; }, 0) / all.length);
}

function getRankings(weekId) {
  weekId = weekId || currentWeekId;
  return submissions
    .filter(function(s) { return s.weekId === weekId; })
    .map(function(s) { return Object.assign({}, s, { avg: getAverageScore(s.id) }); })
    .filter(function(s) { return s.avg !== null; })
    .sort(function(a, b) { return b.avg - a.avg; });
}

function getChallengeSubs(weekId) {
  weekId = weekId || currentWeekId;
  const seen = new Set();
  return submissions.filter(function(s) {
    if (s.weekId !== weekId || s.entryType !== 'challenge') return false;
    const key = s.author + '-' + (s.challengeDivision || (s.tags ? s.tags[0] : ''));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getSubsForDivision(div, weekId) {
  weekId = weekId || currentWeekId;
  let subs = submissions.filter(function(s) { return s.weekId === weekId; });
  if (div === 'gospelpraise') {
    return subs.filter(function(s) { return s.tags && (s.tags.indexOf('gospel') !== -1 || s.tags.indexOf('praiseandworship') !== -1); });
  }
  return subs.filter(function(s) { return s.tags && s.tags.indexOf(div) !== -1; });
}

function getJudgeQueue(div, weekId) {
  weekId = weekId || currentWeekId;
  let subs = submissions.filter(function(s) { return s.weekId === weekId; });
  if (div === 'gospelpraise') {
    return subs.filter(function(s) { return s.tags && s.tags.indexOf(currentGospelSubTab) !== -1; });
  }
  return subs.filter(function(s) { return s.tags && s.tags.indexOf(div) !== -1; });
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
  if (allData.divisionRevealStatus) divisionRevealStatus = allData.divisionRevealStatus;
  if (allData.divisionRevealTimes) divisionRevealTimes = allData.divisionRevealTimes;
  currentWeekId = allData.weekId || currentWeekId;
  challengeImages = allData.challengeImages || {};
  divisionLogos = allData.divisionLogos || {};
  teamMembers = allData.teamMembers || [];
  emailEnabled = !!allData.emailEnabled;
  news = allData.news || [];
  submissionLikes = allData.submissionLikes || {};
  judges = await apiGet('/api/judges');
  if (allData.mainLogo) mainLogoUrl = allData.mainLogo;
  renderMainLogo();
  renderTeamMembers();
}

// ===================== BACKDROP =====================
function showBackdrop(url) {
  const activeScreen = document.querySelector('.screen:not(.hidden)');
  let bd = activeScreen ? activeScreen.querySelector('.screen-backdrop') : null;
  if (!bd) {
    bd = $('backdrop');
    if (!bd) {
      bd = document.createElement('div');
      bd.id = 'backdrop';
      bd.style.cssText = 'position:fixed;inset:0;z-index:0;pointer-events:none;opacity:0;transition:opacity 0.6s ease;background-size:contain;background-position:center;background-repeat:no-repeat;';
      document.body.insertBefore(bd, document.body.firstChild);
    }
  }
  if (url) {
    bd.style.backgroundImage = 'url(' + url + ')';
    bd.style.opacity = '0.12';
    bd.classList.add('active');
  } else {
    bd.style.opacity = '0';
    bd.classList.remove('active');
  }
}

function hideBackdrop() {
  const activeScreen = document.querySelector('.screen:not(.hidden)');
  let bd = activeScreen ? activeScreen.querySelector('.screen-backdrop') : $('backdrop');
  if (bd) {
    bd.style.opacity = '0';
    bd.classList.remove('active');
  }
}

// ===================== LOGO RENDERING =====================
function renderMainLogo() {
  const logoBox = $('logoBox');
  if (!logoBox) return;
  if (mainLogoUrl) {
    logoBox.innerHTML = '<img src="' + mainLogoUrl + '" alt="Astra Musica" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">';
  } else {
    logoBox.textContent = 'AM';
  }
}

// ===================== NAVIGATION & TEAM =====================
function selectRole(role) {
  currentRole = role;
  if (role === 'admin') {
    setBodyClass('main-page');
    hideBackdrop();
    if (adminLoggedIn) {
      if ($('headerBadge')) $('headerBadge').innerHTML = '<span class="badge">Admin</span>';
      showScreen('screenAdmin');
      setAdminTab('submissions');
    } else {
      showScreen('screenAdminLogin');
      if ($('adminPassword')) $('adminPassword').value = '';
      setTimeout(function() { if ($('adminPassword')) $('adminPassword').focus(); }, 100);
    }
  } else if (role === 'judge') {
    setBodyClass('main-page');
    hideBackdrop();
    if ($('headerBadge')) $('headerBadge').innerHTML = '';
    showScreen('screenJudgeLogin');
    if ($('judgeEmail')) $('judgeEmail').value = '';
    if ($('judgePassword')) $('judgePassword').value = '';
    setTimeout(function() { if ($('judgeEmail')) $('judgeEmail').focus(); }, 100);
  } else {
    setBodyClass('main-page');
    hideBackdrop();
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
  showBackdrop(mainLogoUrl);
  renderMainLogo();
  renderTeamMembers();
}

function renderTeamMembers() {
  const section = $('teamSection');
  const grid = $('teamGrid');
  const list = $('teamMembersList');

  if (teamMembers.length > 0) {
    if (section) section.style.display = 'block';
    const cardHtml = teamMembers.map(function(m, idx) {
      return '<div class="role-card team-member-card" onclick="toggleTeamBio(' + idx + ')" style="padding:16px;text-align:center;cursor:pointer;transition:all 0.3s ease;">' +
        '<img src="' + (m.photo || 'https://via.placeholder.com/80') + '" alt="' + m.name + '" style="width:70px;height:70px;object-fit:cover;border-radius:50%;margin:0 auto 12px auto;border:2px solid var(--brand-gold);">' +
        '<h4 style="font-size:16px;font-weight:700;color:white;margin:0 0 4px 0;">' + m.name + '</h4>' +
        '<p style="font-size:13px;color:var(--brand-gold);margin:0 0 8px 0;font-weight:600;">' + m.role + '</p>' +
        '<div id="team-bio-' + idx + '" style="max-height:0;overflow:hidden;transition:max-height 0.4s ease,opacity 0.3s ease, margin 0.3s ease;opacity:0;margin-top:0;">' +
        '<p style="font-size:12px;color:rgba(255,255,255,0.6);margin:0;line-height:1.4;">' + (m.bio || 'No bio available.') + '</p>' +
        '</div>' +
        '<div style="margin-top:8px;font-size:11px;color:var(--brand-gold);opacity:0.7;pointer-events:none;">👆 Click to read bio</div>' +
        '</div>';
    }).join('');
    if (grid) grid.innerHTML = cardHtml;
  } else if (section) {
    section.style.display = 'none';
  }

  if (list) {
    list.innerHTML = teamMembers.map(function(m, idx) {
      if (editingTeamMemberIndex === idx) {
        return '<div class="team-card" style="padding:12px;background:rgba(255,255,255,0.05);border-radius:10px;margin-bottom:10px;border:1px solid var(--brand-gold);">' +
          '<div style="flex:1;">' +
          '<div style="margin-bottom:8px;"><input type="text" id="edit-tm-name-' + idx + '" value="' + m.name + '" placeholder="Name" style="width:100%;padding:6px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.2);border-radius:4px;color:white;font-size:13px;"></div>' +
          '<div style="margin-bottom:8px;"><input type="text" id="edit-tm-role-' + idx + '" value="' + m.role + '" placeholder="Role" style="width:100%;padding:6px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.2);border-radius:4px;color:white;font-size:13px;"></div>' +
          '<div><input type="text" id="edit-tm-bio-' + idx + '" value="' + (m.bio || '') + '" placeholder="Bio" style="width:100%;padding:6px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.2);border-radius:4px;color:white;font-size:13px;"></div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;align-items:center;">' +
          '<button onclick="saveTeamMemberEdit(' + idx + ')" style="background:none;border:none;color:#6bff6b;cursor:pointer;font-size:16px;" title="Save">💾</button>' +
          '<button onclick="cancelTeamMemberEdit()" style="background:none;border:none;color:#ff6b6b;cursor:pointer;font-size:16px;" title="Cancel">✖</button>' +
          '</div></div>';
      }
      return '<div class="team-card" draggable="true" ondragstart="teamDragStart(event,' + idx + ')" ondragover="teamDragOver(event,' + idx + ')" ondrop="teamDrop(event,' + idx + ')" ondragend="teamDragEnd(event)" style="display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px;background:rgba(255,255,255,0.05);border-radius:10px;margin-bottom:10px;cursor:move;">' +
        '<div style="display:flex;align-items:center;gap:12px;flex:1;">' +
        '<span style="color:rgba(255,255,255,0.3);font-size:16px;user-select:none;">≡</span>' +
        '<img src="' + (m.photo || 'https://via.placeholder.com/50') + '" alt="' + m.name + '" style="width:48px;height:48px;object-fit:cover;border-radius:50%;flex-shrink:0;">' +
        '<div><div style="font-size:15px;font-weight:700;color:white;">' + m.name + ' <span style="font-size:12px;font-weight:400;color:var(--brand-gold);">· ' + m.role + '</span></div>' +
        (m.bio ? '<div style="font-size:12px;color:rgba(255,255,255,0.7);margin-top:2px;">' + m.bio + '</div>' : '') + '</div></div>' +
        '<div style="display:flex;gap:8px;align-items:center;">' +
        '<button onclick="startEditTeamMember(' + idx + ')" style="background:none;border:none;color:#d4af37;cursor:pointer;font-size:16px;" title="Edit">✏️</button>' +
        '<button onclick="deleteTeamMember(' + idx + ')" style="background:none;border:none;color:#ff6b6b;cursor:pointer;font-size:16px;" title="Delete">🗑️</button>' +
        '</div></div>';
    }).join('') || '<p style="font-size:13px;color:rgba(255,255,255,0.4);">No team members added yet.</p>';
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
  const res = await apiPost('/api/admin/team', { name: name, role: role, bio: bio, photo: photo });
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

function toggleTeamBio(idx) {
  const bioEl = $('team-bio-' + idx);
  if (!bioEl) return;
  const isOpen = bioEl.style.maxHeight !== '0px' && bioEl.style.maxHeight !== '';
  if (isOpen) {
    bioEl.style.maxHeight = '0px';
    bioEl.style.opacity = '0';
    bioEl.style.marginTop = '0';
    bioEl.style.overflow = 'hidden';
  } else {
    bioEl.style.maxHeight = bioEl.scrollHeight + 'px';
    bioEl.style.opacity = '1';
    bioEl.style.marginTop = '8px';
    bioEl.style.overflow = 'visible';
  }
}

function startEditTeamMember(idx) {
  editingTeamMemberIndex = idx;
  renderTeamMembers();
}

function cancelTeamMemberEdit() {
  editingTeamMemberIndex = null;
  renderTeamMembers();
}

async function saveTeamMemberEdit(idx) {
  const name = $('edit-tm-name-' + idx).value.trim();
  const role = $('edit-tm-role-' + idx).value.trim();
  const bio = $('edit-tm-bio-' + idx).value.trim();
  if (!name || !role) { toast('Name and role are required', 'error'); return; }
  const res = await apiPost('/api/admin/team/' + idx, { name, role, bio });
  if (res.error) { toast(res.error, 'error'); return; }
  teamMembers = res.teamMembers || teamMembers;
  editingTeamMemberIndex = null;
  renderTeamMembers();
  toast('Team member updated!');
}

function teamDragStart(e, idx) {
  dragSrcIndex = idx;
  e.dataTransfer.effectAllowed = 'move';
  e.target.style.opacity = '0.4';
}

function teamDragOver(e, idx) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function teamDrop(e, idx) {
  e.stopPropagation();
  if (dragSrcIndex === null || dragSrcIndex === idx) return;
  const moved = teamMembers.splice(dragSrcIndex, 1)[0];
  teamMembers.splice(idx, 0, moved);
  dragSrcIndex = null;
  saveTeamOrder();
}

function teamDragEnd(e) {
  e.target.style.opacity = '1';
  dragSrcIndex = null;
}

async function saveTeamOrder() {
  const res = await apiPost('/api/admin/team/reorder', { teamMembers: teamMembers });
  if (res.error) { toast(res.error, 'error'); return; }
  teamMembers = res.teamMembers || teamMembers;
  editingTeamMemberIndex = null;
  renderTeamMembers();
  toast('Team order updated!');
}

// ===================== JUDGE =====================
async function loginJudge() {
  const email = $('judgeEmail').value.trim();
  const pw = $('judgePassword').value;
  try {
    const res = await apiPost('/api/judges/login', { email: email, password: pw });
    if (res.error) throw new Error(res.error);
    currentJudge = res;
    const divColor = divisions[currentJudge.division]?.color || '#d4af37';
    $('headerBadge').innerHTML = '<span class="badge" style="border-color:' + divColor + ';color:' + divColor + ';">Judge · ' + (divisions[currentJudge.division]?.name || 'Judge') + '</span>';
    $('judgeDivisionName').textContent = divisions[currentJudge.division]?.name || currentJudge.division;
    $('judgeDivisionName').style.color = divColor;
    setBodyClass('div-' + currentJudge.division);
    showScreen('screenJudge');
    showBackdrop(divisionLogos[currentJudge.division] || mainLogoUrl);
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
  if (currentJudge && currentJudge.division === 'gospelpraise') {
    container.style.display = 'flex';
    const purple = subDivisionColors.gospel;
    container.innerHTML = '<button onclick="switchJudgeSubTab(\'gospel\')" style="flex:1;padding:10px 16px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:' + (currentGospelSubTab === 'gospel' ? purple : 'rgba(0,0,0,0.3)') + ';color:' + (currentGospelSubTab === 'gospel' ? '#fff' : 'rgba(255,255,255,0.6)') + ';font-weight:700;cursor:pointer;font-size:13px;">Gospel</button>' +
      '<button onclick="switchJudgeSubTab(\'praiseandworship\')" style="flex:1;padding:10px 16px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:' + (currentGospelSubTab === 'praiseandworship' ? purple : 'rgba(0,0,0,0.3)') + ';color:' + (currentGospelSubTab === 'praiseandworship' ? '#fff' : 'rgba(255,255,255,0.6)') + ';font-weight:700;cursor:pointer;font-size:13px;">Praise & Worship</button>';
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
    divSubs = divSubs.filter(function(s) { return s.entryType === 'challenge'; });
  } else {
    divSubs = divSubs.filter(function(s) { return s.entryType !== 'challenge'; });
  }
  if (divSubs.length === 0) {
    container.innerHTML = '<p class="text-center text-tertiary" style="padding:40px;font-size:16px;">No ' + (judgeTab === 'challenge' ? 'challenge' : 'Top 20') + ' submissions available for your division right now.</p>';
    return;
  }
  container.innerHTML = divSubs.map(function(sub) {
    const myScore = scores[sub.id] ? scores[sub.id][currentJudge.name] : null;
    const isScored = !!myScore;
    const c = myScore ? myScore.criteria : (editingScores[sub.id] || [0, 0, 0, 0]);
    const activeDivKey = currentJudge.division === 'gospelpraise' ? currentGospelSubTab : currentJudge.division;
    const divColor = divisions[activeDivKey]?.color || subDivisionColors[activeDivKey] || '#d4af37';
    const total = isScored ? myScore.total : Math.round(((c[0] + c[1] + c[2] + c[3]) / 40) * 100);
    return '<div class="card" style="border-left:4px solid ' + divColor + ';" id="song-card-' + sub.id + '">' +
      '<div class="card-header"><div><div class="card-title" style="font-size:18px;">' + sub.title + '</div><div class="card-meta" style="font-size:14px;">by ' + sub.author + ' · ' + formatDate(sub.timestamp) + '</div></div>' +
      (isScored ? '<span style="font-size:13px;color:#6bff6b;font-weight:700;background:rgba(107,255,107,0.1);padding:4px 12px;border-radius:20px;">✓ Scored ' + myScore.total + '%</span>' : '<span style="font-size:13px;color:var(--brand-gold);font-weight:700;background:rgba(212,175,55,0.1);padding:4px 12px;border-radius:20px;">Not Scored</span>') +
      '</div>' +
      '<div class="tags">' + (sub.tags || []).map(function(t) { return '<span class="tag ' + t + '">#' + t + '</span>'; }).join('') + (sub.entryType === 'challenge' ? '<span class="challenge-badge">Challenge</span>' : '') + '</div>' +
      (sub.image ? '<img src="' + sub.image + '" class="submission-img" style="margin-top:10px;max-width:200px;border-radius:8px;">' : '') +
      '<a href="' + sub.link + '" target="_blank" class="link-btn" style="font-size:14px;padding:10px 18px;margin-top:12px;display:inline-block;background:var(--brand-gold);color:#1a1a2e;font-weight:700;border-radius:6px;text-decoration:none;">▶️ Play Song</a>' +
      '<div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.1);">' +
      '<p style="font-size:14px;font-weight:700;color:rgba(255,255,255,0.8);margin-bottom:14px;">Score this song (0-10 each):</p>' +
      '<div class="criteria-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;">' +
      '<div class="criterion"><label style="font-size:13px;display:block;margin-bottom:4px;">Vocals</label><div class="score-control" style="display:flex;align-items:center;gap:8px;"><button class="score-btn" onclick="adjustScore(\'' + sub.id + '\',\'vocals\',-1)">−</button><span class="score-value" id="val-vocals-' + sub.id + '">' + c[0] + '</span><button class="score-btn" onclick="adjustScore(\'' + sub.id + '\',\'vocals\',1)">+</button></div></div>' +
      '<div class="criterion"><label style="font-size:13px;display:block;margin-bottom:4px;">Production</label><div class="score-control" style="display:flex;align-items:center;gap:8px;"><button class="score-btn" onclick="adjustScore(\'' + sub.id + '\',\'production\',-1)">−</button><span class="score-value" id="val-production-' + sub.id + '">' + c[1] + '</span><button class="score-btn" onclick="adjustScore(\'' + sub.id + '\',\'production\',1)">+</button></div></div>' +
      '<div class="criterion"><label style="font-size:13px;display:block;margin-bottom:4px;">Originality</label><div class="score-control" style="display:flex;align-items:center;gap:8px;"><button class="score-btn" onclick="adjustScore(\'' + sub.id + '\',\'originality\',-1)">−</button><span class="score-value" id="val-originality-' + sub.id + '">' + c[2] + '</span><button class="score-btn" onclick="adjustScore(\'' + sub.id + '\',\'originality\',1)">+</button></div></div>' +
      '<div class="criterion"><label style="font-size:13px;display:block;margin-bottom:4px;">Impact</label><div class="score-control" style="display:flex;align-items:center;gap:8px;"><button class="score-btn" onclick="adjustScore(\'' + sub.id + '\',\'impact\',-1)">−</button><span class="score-value" id="val-impact-' + sub.id + '">' + c[3] + '</span><button class="score-btn" onclick="adjustScore(\'' + sub.id + '\',\'impact\',1)">+</button></div></div>' +
      '</div>' +
      '<div class="score-display" style="margin-top:16px;display:flex;justify-content:space-between;align-items:center;"><span class="label" style="font-size:15px;">Current Total</span><span class="value" id="display-total-' + sub.id + '" style="font-size:32px;font-weight:800;color:var(--brand-gold);">' + total + '%</span></div>' +
      '<div id="btn-container-' + sub.id + '" style="margin-top:12px;">' + (isScored ? '<button class="btn btn-secondary score-edit-btn" onclick="enableEdit(\'' + sub.id + '\')">✏️ Edit My Score</button>' : '<button class="btn btn-gold save-score-btn" id="save-btn-' + sub.id + '" onclick="saveScore(\'' + sub.id + '\')">💾 Save My Score</button>') + '</div>' +
      '<p style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:10px;">' + (isScored ? '✓ Your score is saved. Other judges cannot see it.' : 'Adjust all 4 criteria, then click Save.') + '</p>' +
      '</div></div>';
  }).join('');
}

function adjustScore(subId, criterion, delta) {
  const criteriaMap = { vocals: 0, production: 1, originality: 2, impact: 3 };
  const idx = criteriaMap[criterion];
  if (!editingScores[subId]) {
    const myScore = scores[subId] ? scores[subId][currentJudge.name] : null;
    editingScores[subId] = myScore ? myScore.criteria.slice() : [0, 0, 0, 0];
  }
  editingScores[subId][idx] = Math.max(0, Math.min(10, editingScores[subId][idx] + delta));
  const valEl = $('val-' + criterion + '-' + subId);
  if (valEl) valEl.textContent = editingScores[subId][idx];
  const sum = editingScores[subId].reduce(function(a, b) { return a + b; }, 0);
  const pct = Math.round((sum / 40) * 100);
  const totalEl = $('display-total-' + subId);
  if (totalEl) totalEl.textContent = pct + '%';
}

function enableEdit(subId) {
  const myScore = scores[subId] ? scores[subId][currentJudge.name] : null;
  if (!myScore) return;
  editingScores[subId] = myScore.criteria.slice();
  const container = $('btn-container-' + subId);
  if (container) {
    container.innerHTML = '<button class="btn btn-gold save-score-btn" id="save-btn-' + subId + '" onclick="saveScore(\'' + subId + '\')">💾 Update My Score</button>';
  }
  toast('You can now edit your score. Click Update when done.');
}

async function saveScore(subId) {
  const c = editingScores[subId] || [0, 0, 0, 0];
  const sum = c.reduce(function(a, b) { return a + b; }, 0);
  if (sum === 0) {
    toast('Please score at least one criterion before saving.', 'error');
    return;
  }
  await apiPost('/api/scores', { submissionId: subId, judgeName: currentJudge.name, criteria: c });
  scores = await apiGet('/api/scores');
  delete editingScores[subId];
  renderJudgePanel();
  toast('Score saved! Other judges cannot see it.');
}

// ===================== PUBLIC VIEW =====================
function setPublicTab(tab) {
  publicTab = tab;
  document.querySelectorAll('#screenPublic .tab').forEach(function(t) { t.classList.remove('active'); });
  const activeTabBtn = $('tab' + tab.charAt(0).toUpperCase() + tab.slice(1));
  if (activeTabBtn) activeTabBtn.classList.add('active');
  hide('publicTop20'); hide('publicChallenges'); hide('publicResults'); hide('publicNews');
  show('public' + (tab === 'top20' ? 'Top20' : tab === 'challenges' ? 'Challenges' : tab === 'news' ? 'News' : 'Results'));
  if (publicDivFilter === 'all') {
    setBodyClass('main-page');
  } else {
    setBodyClass('div-' + publicDivFilter);
  }
  if (tab === 'top20') renderTop20();
  if (tab === 'challenges') renderChallenges();
  if (tab === 'results') renderResults();
  if (tab === 'news') renderPublicNews();
}

function setPublicDiv(div) {
  publicDivFilter = div;
  publicGospelSubTab = 'all';
  document.querySelectorAll('#publicDivTabs .div-tab').forEach(function(b) { b.classList.remove('active'); });
  if (window.event && window.event.target) window.event.target.classList.add('active');
  if (div === 'all') {
    setBodyClass('main-page');
    showBackdrop(mainLogoUrl);
  } else {
    setBodyClass('div-' + div);
    showBackdrop(divisionLogos[div] || mainLogoUrl);
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
  divs.forEach(function(div) {
    if (publicDivFilter !== 'all' && publicDivFilter !== div) return;
    let allDivSubs = getSubsForDivision(div)
      .filter(function(s) { return s.entryType !== 'challenge'; })
      .map(function(s) { return Object.assign({}, s, { avg: getAverageScore(s.id) }); })
      .sort(function(a, b) { return (b.avg || 0) - (a.avg || 0); });
    let divSubs = allDivSubs;
    if (div === 'gospelpraise' && publicGospelSubTab !== 'all') {
      divSubs = allDivSubs.filter(function(s) { return s.tags && s.tags.indexOf(publicGospelSubTab) !== -1; });
    }
    if (div === 'gospelpraise' && publicGospelSubTab === 'gospel') {
      divSubs = divSubs.slice(0, 10);
    } else {
      divSubs = divSubs.slice(0, 20);
    }
    if (allDivSubs.length === 0) return;
    const divColor = divisions[div].color;
    const divLogo = divisionLogos[div];
    const divJudges = Object.values(judges).filter(function(j) { return j.division === div; });
    html += '<div class="div-header" style="border-left:4px solid ' + divColor + ';padding:12px;background:rgba(255,255,255,0.03);border-radius:8px;margin-top:16px;display:flex;align-items:center;">';
    if (divLogo) {
      html += '<img src="' + divLogo + '" alt="' + divisions[div].name + '" style="width:40px;height:40px;object-fit:contain;border-radius:6px;margin-right:12px;">';
    }
    html += '<div style="flex:1;"><h2 style="color:' + divColor + ';margin:0;font-size:18px;">' + divisions[div].name + '</h2></div>';
    if (divJudges.length > 0) {
      html += '<div style="display:flex;gap:6px;align-items:center;">';
      divJudges.forEach(function(j) {
        if (j.photo) {
          html += '<img src="' + j.photo + '" title="Judge: ' + j.name + '" style="width:32px;height:32px;object-fit:cover;border-radius:50%;border:2px solid ' + divColor + ';">';
        } else {
          html += '<div title="Judge: ' + j.name + '" style="width:32px;height:32px;border-radius:50%;background:' + divColor + ';display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:white;">' + j.name.split(' ').map(function(n) { return n[0]; }).join('').slice(0, 2) + '</div>';
        }
      });
      html += '</div>';
    }
    html += '</div>';
    if (div === 'gospelpraise') {
      const purple = divisions.gospelpraise.color;
      html += '<div style="display:flex;gap:8px;margin:12px 0;">' +
        '<button onclick="setPublicGospelSubTab(\'all\')" style="flex:1;padding:8px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:' + (publicGospelSubTab === 'all' ? purple : 'rgba(0,0,0,0.3)') + ';color:' + (publicGospelSubTab === 'all' ? '#fff' : 'rgba(255,255,255,0.6)') + ';font-weight:700;cursor:pointer;font-size:13px;">All</button>' +
        '<button onclick="setPublicGospelSubTab(\'gospel\')" style="flex:1;padding:8px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:' + (publicGospelSubTab === 'gospel' ? purple : 'rgba(0,0,0,0.3)') + ';color:' + (publicGospelSubTab === 'gospel' ? '#fff' : 'rgba(255,255,255,0.6)') + ';font-weight:700;cursor:pointer;font-size:13px;">Gospel</button>' +
        '<button onclick="setPublicGospelSubTab(\'praiseandworship\')" style="flex:1;padding:8px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:' + (publicGospelSubTab === 'praiseandworship' ? purple : 'rgba(0,0,0,0.3)') + ';color:' + (publicGospelSubTab === 'praiseandworship' ? '#fff' : 'rgba(255,255,255,0.6)') + ';font-weight:700;cursor:pointer;font-size:13px;">Praise & Worship</button>' +
        '</div>';
    }
    if (divSubs.length === 0) {
      html += '<p style="padding:20px;color:rgba(255,255,255,0.4);font-size:13px;">No submissions in this category.</p>';
    } else {
      html += divSubs.map(function(sub, idx) {
        return '<div class="card" style="margin-top:10px;display:flex;align-items:center;justify-content:space-between;gap:12px;">' +
          '<div style="display:flex;align-items:center;gap:12px;">' +
          '<div style="font-size:20px;font-weight:800;color:' + (idx < 3 ? 'var(--brand-gold)' : 'rgba(255,255,255,0.4)') + ';width:28px;">#' + (idx + 1) + '</div>' +
          (sub.image ? '<img src="' + sub.image + '" style="width:48px;height:48px;object-fit:cover;border-radius:6px;">' : '') +
          '<div><a href="' + sub.link + '" target="_blank" style="font-weight:700;font-size:15px;color:white;text-decoration:none;">' + sub.title + '</a><div style="font-size:13px;color:rgba(255,255,255,0.6);">by ' + sub.author + '</div></div>' +
          '</div>' +
          '<div style="text-align:right;"><button onclick="likeSubmission(' + sub.id + ')" style="background:none;border:none;cursor:pointer;font-size:22px;padding:4px;">❤️</button><div style="font-size:12px;color:rgba(255,255,255,0.5);">' + (submissionLikes[sub.id] || 0) + ' likes</div></div>' +
          '</div>';
      }).join('');
    }
  });
  list.innerHTML = html || '<p class="text-center text-tertiary" style="padding:40px;">No submissions found.</p>';
}

function renderChallenges() {
  const list = $('challengesList');
  if (!list) return;
  const divs = ['english', 'afrikaans'];
  let html = '';
  divs.forEach(function(div) {
    const divColor = divisions[div].color;
    const isRevealed = divisionRevealStatus[div];
    const revealTs = divisionRevealTimes[div] || revealTime;
    const divChals = getChallengeSubs().filter(function(c) { return c.challengeDivision === div || (c.tags && c.tags.indexOf(div) !== -1); });
    const ranked = divChals.map(function(s) { return Object.assign({}, s, { avg: getAverageScore(s.id) }); }).filter(function(s) { return s.avg !== null; }).sort(function(a, b) { return b.avg - a.avg; });
    const img = challengeImages[currentWeekId] ? challengeImages[currentWeekId][div] : null;

    html += '<div style="margin-top:24px;padding:16px;background:rgba(255,255,255,0.02);border-radius:12px;border:1px solid rgba(255,255,255,0.05);">';
    html += '<h2 style="color:' + divColor + ';font-size:18px;margin-bottom:10px;display:flex;align-items:center;gap:10px;">' + divisions[div].name + ' Challenge' + (isRevealed ? ' <span style="font-size:12px;background:rgba(107,255,107,0.15);color:#6bff6b;padding:2px 10px;border-radius:12px;">✓ Results Revealed</span>' : '') + '</h2>';
    if (img) html += '<img src="' + img + '" style="width:100%;max-height:200px;object-fit:cover;border-radius:10px;margin-bottom:14px;">';

    if (!isRevealed) {
      const diff = revealTs - Date.now();
      const d = Math.max(0, Math.floor(diff / 86400000));
      const h = Math.max(0, Math.floor((diff % 86400000) / 3600000));
      const m = Math.max(0, Math.floor((diff % 3600000) / 60000));
      const s = Math.max(0, Math.floor((diff % 60000) / 1000));
      html += '<div style="background:rgba(0,0,0,0.2);padding:14px;border-radius:8px;text-align:center;margin-bottom:12px;">' +
        '<p style="font-size:13px;color:rgba(255,255,255,0.5);margin:0 0 8px 0;">Results revealed in:</p>' +
        '<div style="display:flex;justify-content:center;gap:12px;">' +
        '<div><div style="font-size:24px;font-weight:800;color:var(--brand-gold);">' + String(d).padStart(2,'0') + '</div><div style="font-size:10px;color:rgba(255,255,255,0.4);">days</div></div>' +
        '<div><div style="font-size:24px;font-weight:800;color:var(--brand-gold);">' + String(h).padStart(2,'0') + '</div><div style="font-size:10px;color:rgba(255,255,255,0.4);">hrs</div></div>' +
        '<div><div style="font-size:24px;font-weight:800;color:var(--brand-gold);">' + String(m).padStart(2,'0') + '</div><div style="font-size:10px;color:rgba(255,255,255,0.4);">mins</div></div>' +
        '<div><div style="font-size:24px;font-weight:800;color:var(--brand-gold);">' + String(s).padStart(2,'0') + '</div><div style="font-size:10px;color:rgba(255,255,255,0.4);">secs</div></div>' +
        '</div></div>';
    }

    if (divChals.length === 0) {
      html += '<p style="font-size:13px;color:rgba(255,255,255,0.4);">No challenge entries for this division yet.</p>';
    } else if (isRevealed && ranked.length > 0) {
      // Show podium for top 3
      html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;">';
      [1,0,2].forEach(function(pos) {
        const sub = ranked[pos];
        if (!sub) return;
        const isFirst = pos === 0;
        html += '<div style="background:' + (isFirst ? 'rgba(212,175,55,0.15)' : 'rgba(255,255,255,0.03)') + ';padding:14px;border-radius:10px;text-align:center;border:1px solid ' + (isFirst ? 'rgba(212,175,55,0.3)' : 'rgba(255,255,255,0.05)') + ';' + (isFirst ? 'transform:scale(1.05);' : '') + '">' +
          '<div style="font-size:28px;margin-bottom:4px;">' + (isFirst ? '🥇' : pos === 1 ? '🥈' : '🥉') + '</div>' +
          '<div style="font-weight:700;font-size:14px;color:white;margin-bottom:2px;">' + sub.title + '</div>' +
          '<div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:6px;">by ' + sub.author + '</div>' +
          '<div style="font-size:20px;font-weight:800;color:var(--brand-gold);">' + sub.avg + '%</div>' +
          '</div>';
      });
      html += '</div>';
      // Full ranked list
      html += ranked.map(function(sub, idx) {
        return '<div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;border-left:3px solid ' + divColor + ';">' +
          '<div style="display:flex;align-items:center;gap:12px;">' +
          '<div style="font-weight:800;color:' + (idx < 3 ? 'var(--brand-gold)' : 'rgba(255,255,255,0.4)') + ';width:28px;">#' + (idx + 1) + '</div>' +
          '<div><div style="font-weight:700;font-size:14px;color:white;">' + sub.title + '</div><div style="font-size:12px;color:rgba(255,255,255,0.5);">by ' + sub.author + '</div></div>' +
          '</div>' +
          '<div style="font-weight:800;font-size:16px;color:var(--brand-gold);">' + sub.avg + '%</div>' +
          '</div>';
      }).join('');
    } else {
      // Not revealed yet - just show entries without scores
      html += divChals.map(function(sub) {
        return '<div class="card" style="border-left:4px solid ' + divColor + ';margin-bottom:10px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<div><div style="font-weight:700;font-size:16px;">' + sub.title + '</div><div style="font-size:13px;color:rgba(255,255,255,0.6);">by ' + sub.author + '</div></div>' +
          '<a href="' + sub.link + '" target="_blank" style="padding:6px 12px;background:var(--brand-gold);color:#1a1a2e;text-decoration:none;font-weight:700;border-radius:6px;font-size:12px;">Play</a>' +
          '</div></div>';
      }).join('');
    }
    html += '</div>';
  });
  list.innerHTML = html;
}

function renderResults() {
  const container = $('resultsContent');
  if (!container) return;

  const divs = Object.keys(divisions);
  let html = '';

  divs.forEach(function(div) {
    const isRevealed = divisionRevealStatus[div];
    const revealTs = divisionRevealTimes[div] || revealTime;
    const divColor = divisions[div].color;
    let divRankings = getRankings().filter(function(s) { return s.tags && s.tags.indexOf(div) !== -1; });
    if (div === 'gospelpraise') {
      divRankings = getRankings().filter(function(s) { return s.tags && (s.tags.indexOf('gospel') !== -1 || s.tags.indexOf('praiseandworship') !== -1); });
    }

    html += '<div style="margin-top:24px;padding:16px;background:rgba(255,255,255,0.02);border-radius:12px;border:1px solid rgba(255,255,255,0.05);">';
    html += '<h2 style="color:' + divColor + ';font-size:18px;margin-bottom:12px;display:flex;align-items:center;gap:10px;">' + divisions[div].name + (isRevealed ? ' <span style="font-size:12px;background:rgba(107,255,107,0.15);color:#6bff6b;padding:2px 10px;border-radius:12px;">✓ Revealed</span>' : ' <span style="font-size:12px;background:rgba(212,175,55,0.15);color:var(--brand-gold);padding:2px 10px;border-radius:12px;">⏳ Hidden</span>') + '</h2>';

    if (!isRevealed) {
      const diff = revealTs - Date.now();
      const d = Math.max(0, Math.floor(diff / 86400000));
      const h = Math.max(0, Math.floor((diff % 86400000) / 3600000));
      const m = Math.max(0, Math.floor((diff % 3600000) / 60000));
      const s = Math.max(0, Math.floor((diff % 60000) / 1000));
      html += '<div style="background:rgba(0,0,0,0.2);padding:14px;border-radius:8px;text-align:center;">' +
        '<p style="font-size:13px;color:rgba(255,255,255,0.5);margin:0 0 8px 0;">Results revealed in:</p>' +
        '<div style="display:flex;justify-content:center;gap:12px;">' +
        '<div><div style="font-size:24px;font-weight:800;color:var(--brand-gold);">' + String(d).padStart(2,'0') + '</div><div style="font-size:10px;color:rgba(255,255,255,0.4);">days</div></div>' +
        '<div><div style="font-size:24px;font-weight:800;color:var(--brand-gold);">' + String(h).padStart(2,'0') + '</div><div style="font-size:10px;color:rgba(255,255,255,0.4);">hrs</div></div>' +
        '<div><div style="font-size:24px;font-weight:800;color:var(--brand-gold);">' + String(m).padStart(2,'0') + '</div><div style="font-size:10px;color:rgba(255,255,255,0.4);">mins</div></div>' +
        '<div><div style="font-size:24px;font-weight:800;color:var(--brand-gold);">' + String(s).padStart(2,'0') + '</div><div style="font-size:10px;color:rgba(255,255,255,0.4);">secs</div></div>' +
        '</div></div>';
    } else if (divRankings.length === 0) {
      html += '<p style="font-size:13px;color:rgba(255,255,255,0.4);padding:20px;">No scores available for this division.</p>';
    } else {
      // Podium
      html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;">';
      [1,0,2].forEach(function(pos) {
        const sub = divRankings[pos];
        if (!sub) return;
        const isFirst = pos === 0;
        html += '<div style="background:' + (isFirst ? 'rgba(212,175,55,0.15)' : 'rgba(255,255,255,0.03)') + ';padding:14px;border-radius:10px;text-align:center;border:1px solid ' + (isFirst ? 'rgba(212,175,55,0.3)' : 'rgba(255,255,255,0.05)') + ';' + (isFirst ? 'transform:scale(1.05);' : '') + '">' +
          '<div style="font-size:28px;margin-bottom:4px;">' + (isFirst ? '🥇' : pos === 1 ? '🥈' : '🥉') + '</div>' +
          '<div style="font-weight:700;font-size:14px;color:white;margin-bottom:2px;">' + sub.title + '</div>' +
          '<div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:6px;">by ' + sub.author + '</div>' +
          '<div style="font-size:20px;font-weight:800;color:var(--brand-gold);">' + sub.avg + '%</div>' +
          '</div>';
      });
      html += '</div>';
      // Rest of rankings
      html += divRankings.slice(3).map(function(sub, idx) {
        return '<div class="card" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
          '<div style="display:flex;align-items:center;gap:12px;"><div style="font-weight:700;color:rgba(255,255,255,0.5);">#' + (idx + 4) + '</div><div><div style="font-weight:700;">' + sub.title + '</div><div style="font-size:12px;color:rgba(255,255,255,0.5);">by ' + sub.author + '</div></div></div>' +
          '<div style="font-weight:800;color:var(--brand-gold);">' + sub.avg + '%</div></div>';
      }).join('');
    }
    html += '</div>';
  });

  container.innerHTML = html;
  hide('resultsCountdownWrap');
  show('resultsContent');
}

function updateCountdown() {
  if (publicTab === 'challenges') renderChallenges();
  if (publicTab === 'results') renderResults();
  // Legacy single countdown (kept for compatibility)
  const diff = revealTime - Date.now();
  if (diff <= 0) {
    ['Days', 'Hours', 'Mins', 'Secs'].forEach(function(u) { const el = $('cd' + u); if (el) el.textContent = '00'; });
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
  document.querySelectorAll('#screenAdmin .tab').forEach(function(t) { t.classList.remove('active'); });
  const tabBtn = $('tabAdmin' + tab.charAt(0).toUpperCase() + tab.slice(1));
  if (tabBtn) tabBtn.classList.add('active');
  hide('adminSubmissions'); hide('adminJudges'); hide('adminChallenges'); hide('adminResults'); hide('adminSettings'); hide('adminNews');
  show('admin' + tab.charAt(0).toUpperCase() + tab.slice(1));
  if (tab === 'submissions') renderAdminSubmissions();
  if (tab === 'judges') renderAdminJudges();
  if (tab === 'challenges') renderAdminChallenges();
  if (tab === 'results') renderAdminResults();
  if (tab === 'settings') renderAdminSettings();
  if (tab === 'news') renderAdminNews();
}

function updateDivisionOptions() {
  const type = $('mType').value;
  const divSelect = $('mChallengeDiv');
  if (!divSelect) return;
  if (type === 'challenge') {
    divSelect.innerHTML = '<option value="english">English</option><option value="afrikaans">Afrikaans</option>';
  } else {
    divSelect.innerHTML = '<option value="english">English</option><option value="afrikaans">Afrikaans</option><option value="gospel">Gospel</option><option value="praiseandworship">Praise & Worship</option><option value="liveartists">Live Artists</option>';
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
  let tags = tagsRaw.split(' ').map(function(t) { return t.replace('#', ''); }).filter(Boolean);
  if (tags.indexOf(div) === -1) tags.push(div);
  let image = '';
  if (imageInput && imageInput.files && imageInput.files[0]) {
    image = await fileToBase64(imageInput.files[0]);
  }
  const res = await apiPost('/api/submissions', {
    author: author, title: title, link: link, tags: tags, entryType: entryType,
    challengeDivision: div, image: image, weekId: currentWeekId
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
  toast('Challenge banner uploaded for ' + (divisions[div]?.name || div) + '!');
  fileInput.value = '';
  if ($('challengeImgPreview')) $('challengeImgPreview').style.display = 'none';
  await loadData();
}

function filterAdmin(tag) {
  adminDivFilter = tag;
  document.querySelectorAll('#adminFilters .filter-btn').forEach(function(b) { b.classList.remove('active'); });
  if (window.event && window.event.target) window.event.target.classList.add('active');
  renderAdminSubmissions();
}

function renderAdminSubmissions() {
  const container = $('adminSubmissionList');
  if (!container) return;
  let subs = submissions;
  if (adminDivFilter !== 'all') subs = subs.filter(function(s) { return s.tags && s.tags.indexOf(adminDivFilter) !== -1; });
  container.innerHTML = subs.map(function(sub) {
    const subScores = scores[sub.id] || {};
    const judgeCount = Object.keys(subScores).length;
    const avg = getAverageScore(sub.id);
    return '<div class="card" style="margin-top:12px;">' +
      '<div class="card-header" style="display:flex;justify-content:space-between;align-items:flex-start;">' +
      '<div><div class="card-title" style="font-weight:700;font-size:16px;">' + sub.title + '</div><div class="card-meta" style="font-size:13px;color:rgba(255,255,255,0.6);">by ' + sub.author + ' · ' + (sub.tags || []).map(function(t) { return '#' + t; }).join(' ') + '</div></div>' +
      '<div style="text-align:right;"><div style="font-size:12px;color:rgba(255,255,255,0.5);">' + judgeCount + ' judge(s) scored</div><div style="font-size:20px;font-weight:800;color:var(--brand-gold);">' + (avg !== null ? avg + '%' : '—') + '</div></div>' +
      '</div>' +
      (sub.entryType === 'challenge' ? '<span class="challenge-badge">Challenge</span>' : '') +
      (sub.image ? '<img src="' + sub.image + '" style="margin-top:10px;max-width:120px;border-radius:6px;">' : '') +
      '<div style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;"><a href="' + sub.link + '" target="_blank" style="font-size:12px;color:var(--brand-gold);">Open Link 🔗</a><button class="btn btn-danger" style="width:auto;padding:4px 12px;font-size:12px;" onclick="deleteSubmission(\'' + sub.id + '\')">🗑️ Delete</button></div>' +
      '</div>';
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
  tbody.innerHTML = Object.entries(judgesData).map(function(entry) {
    const id = entry[0], j = entry[1];
    const scoreCount = Object.values(scores).filter(function(s) { return s[j.name]; }).length;
    const totalSubs = getSubsForDivision(j.division).length;
    if (editingJudgeId === id) {
      return '<tr id="judge-row-' + id + '">' +
        '<td style="padding:10px;"><input type="text" id="edit-name-' + id + '" value="' + j.name + '" style="width:100%;padding:6px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.2);border-radius:4px;color:white;font-size:13px;"></td>' +
        '<td style="padding:10px;"><input type="email" id="edit-email-' + id + '" value="' + j.email + '" style="width:100%;padding:6px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.2);border-radius:4px;color:white;font-size:13px;"></td>' +
        '<td style="padding:10px;">' +
          '<select id="edit-div-' + id + '" style="padding:6px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.2);border-radius:4px;color:white;font-size:13px;">' +
            '<option value="english" ' + (j.division === 'english' ? 'selected' : '') + '>English</option>' +
            '<option value="afrikaans" ' + (j.division === 'afrikaans' ? 'selected' : '') + '>Afrikaans</option>' +
            '<option value="gospelpraise" ' + (j.division === 'gospelpraise' ? 'selected' : '') + '>Gospel & P&W</option>' +
            '<option value="liveartists" ' + (j.division === 'liveartists' ? 'selected' : '') + '>Live Artists</option>' +
          '</select>' +
        '</td>' +
        '<td style="padding:10px;color:#6bff6b;">● Active</td>' +
        '<td style="padding:10px;"><input type="text" id="edit-pw-' + id + '" placeholder="New password" style="width:110px;padding:6px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.2);border-radius:4px;color:white;font-size:12px;"></td>' +
        '<td style="padding:10px;">' + scoreCount + ' / ' + totalSubs + '</td>' +
        '<td style="padding:10px;">' +
          '<button onclick="saveJudgeEdit(\'' + id + '\')" style="background:none;border:none;color:#6bff6b;cursor:pointer;font-size:16px;margin-right:8px;" title="Save">💾</button>' +
          '<button onclick="cancelJudgeEdit()" style="background:none;border:none;color:#ff6b6b;cursor:pointer;font-size:16px;" title="Cancel">✖</button>' +
        '</td>' +
        '</tr>';
    }
    return '<tr>' +
      '<td style="font-weight:600;padding:10px;">' + j.name + '</td>' +
      '<td style="padding:10px;">' + j.email + '</td>' +
      '<td style="padding:10px;"><span class="tag ' + j.division + '" style="font-size:11px;padding:2px 8px;">' + (divisions[j.division]?.name || j.division) + '</span></td>' +
      '<td style="padding:10px;color:#6bff6b;">● Active</td>' +
      '<td style="padding:10px;">' + (j.hasSetPassword ? '✓ Changed' : 'Admin Set') + '</td>' +
      '<td style="padding:10px;">' + scoreCount + ' / ' + totalSubs + '</td>' +
      '<td style="padding:10px;">' +
        '<button onclick="startEditJudge(\'' + id + '\')" style="background:none;border:none;color:#d4af37;cursor:pointer;font-size:16px;margin-right:8px;" title="Edit">✏️</button>' +
        '<button onclick="deleteJudge(\'' + id + '\')" style="background:none;border:none;color:#ff6b6b;cursor:pointer;font-size:16px;" title="Delete">🗑️</button>' +
      '</td>' +
      '</tr>';
  }).join('') || '<tr><td colspan="7" style="text-align:center;padding:20px;">No judges configured.</td></tr>';
}

function startEditJudge(id) {
  editingJudgeId = id;
  renderAdminJudges();
}

function cancelJudgeEdit() {
  editingJudgeId = null;
  renderAdminJudges();
}

async function saveJudgeEdit(id) {
  const name = $('edit-name-' + id).value.trim();
  const email = $('edit-email-' + id).value.trim();
  const division = $('edit-div-' + id).value;
  const newPw = $('edit-pw-' + id).value.trim();
  if (!name || !email) { toast('Name and email are required', 'error'); return; }
  const res = await apiPost('/api/judges/' + id, { name, email, division });
  if (res.error) { toast(res.error, 'error'); return; }
  if (newPw && newPw.length >= 4) {
    const pwRes = await apiPost('/api/admin/reset-judge-password', { judgeId: id, newPassword: newPw });
    if (pwRes.error) { toast('Info saved, but password reset failed', 'error'); }
    else { toast('Judge updated and password reset!'); }
  } else {
    toast('Judge info updated successfully!');
  }
  editingJudgeId = null;
  await loadData();
  renderAdminJudges();
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
  const res = await apiPost('/api/judges', { name: name, email: email, division: division, password: password, photo: photo });
  if (res.error) { toast(res.error, 'error'); return; }
  toast('Judge ' + name + ' added successfully!');
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
    summary.innerHTML = '<div style="font-size:14px;margin-bottom:8px;"><span style="color:rgba(255,255,255,0.6);">Week ID:</span> <b>' + currentWeekId + '</b></div>' +
      '<div style="font-size:14px;margin-bottom:8px;"><span style="color:rgba(255,255,255,0.6);">Total Scored:</span> <b>' + rankings.length + ' / ' + submissions.length + '</b></div>' +
      '<div style="font-size:14px;margin-bottom:8px;"><span style="color:rgba(255,255,255,0.6);">Current Leader:</span> <b>' + (rankings[0] ? rankings[0].title : 'None') + '</b> ' + (rankings[0] && rankings[0].avg !== undefined ? '(' + rankings[0].avg + '%)' : '') + '</div>';
  }
  // Render per-division reveal controls
  const revealContainer = $('adminRevealControls');
  if (revealContainer) {
    const divs = Object.keys(divisions);
    revealContainer.innerHTML = divs.map(function(div) {
      const isRevealed = divisionRevealStatus[div];
      const revealTs = divisionRevealTimes[div] || revealTime;
      const dateStr = new Date(revealTs).toISOString().slice(0, 16);
      const divColor = divisions[div].color;
      return '<div class="card" style="border-left:4px solid ' + divColor + ';margin-bottom:12px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">' +
        '<h4 style="margin:0;color:' + divColor + ';font-size:15px;">' + divisions[div].name + '</h4>' +
        '<span style="font-size:12px;padding:3px 10px;border-radius:10px;background:' + (isRevealed ? 'rgba(107,255,107,0.15)' : 'rgba(212,175,55,0.15)') + ';color:' + (isRevealed ? '#6bff6b' : 'var(--brand-gold)') + ';">' + (isRevealed ? '✓ Revealed' : '⏳ Hidden') + '</span>' +
        '</div>' +
        '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">' +
        '<input type="datetime-local" id="reveal-time-' + div + '" value="' + dateStr + '" style="padding:6px;background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:13px;">' +
        '<button class="btn btn-primary" onclick="saveRevealTime(\'' + div + '\')" style="padding:6px 14px;font-size:12px;">💾 Save Time</button>' +
        (isRevealed ? 
          '<button class="btn btn-secondary" onclick="hideDivisionResults(\'' + div + '\')" style="padding:6px 14px;font-size:12px;">🔒 Hide</button>' :
          '<button class="btn btn-gold" onclick="revealDivisionResults(\'' + div + '\')" style="padding:6px 14px;font-size:12px;">🔓 Reveal Now</button>'
        ) +
        '</div></div>';
    }).join('');
  }
}

async function saveRevealTime(div) {
  const input = $('reveal-time-' + div);
  if (!input || !input.value) { toast('Select a date and time', 'error'); return; }
  const ts = new Date(input.value).getTime();
  await apiPost('/api/admin/set-reveal-time', { division: div, timestamp: ts });
  divisionRevealTimes[div] = ts;
  toast('Reveal time updated for ' + divisions[div].name);
  renderAdminResults();
}

async function revealDivisionResults(div) {
  await apiPost('/api/admin/reveal', { division: div, revealed: true });
  divisionRevealStatus[div] = true;
  toast(divisions[div].name + ' results revealed!');
  renderAdminResults();
}

async function hideDivisionResults(div) {
  await apiPost('/api/admin/reveal', { division: div, revealed: false });
  divisionRevealStatus[div] = false;
  toast(divisions[div].name + ' results hidden.');
  renderAdminResults();
}



function exportExcel() {
  if (typeof XLSX === 'undefined') {
    toast('Excel library loading error. Try refreshing.', 'error');
    return;
  }
  const exportData = submissions.map(function(sub) {
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
    Object.entries(subScores).forEach(function(entry) {
      const jName = entry[0], scoreObj = entry[1];
      row['Judge (' + jName + ') Total'] = scoreObj.total + '%';
      row['Judge (' + jName + ') Breakdown'] = scoreObj.criteria.join('/');
    });
    return row;
  });
  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Submissions & Scores');
  XLSX.writeFile(workbook, 'Astra_Musica_' + currentWeekId + '_Results.xlsx');
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

function setAdminChallengeDiv(div) {
  adminChallengeDiv = div;
  document.querySelectorAll('#adminChallengeDivTabs .div-tab').forEach(function(b) { b.classList.remove('active'); });
  if (window.event && window.event.target) window.event.target.classList.add('active');
  renderAdminChallenges();
}

function renderAdminChallenges() {
  const container = $('adminChallengeList');
  if (!container) return;
  const div = adminChallengeDiv;
  const divColor = divisions[div].color;
  const allChals = getChallengeSubs().filter(function(c) { return c.challengeDivision === div || (c.tags && c.tags.indexOf(div) !== -1); });
  const ranked = allChals.map(function(s) { return Object.assign({}, s, { avg: getAverageScore(s.id) }); }).filter(function(s) { return s.avg !== null; }).sort(function(a, b) { return b.avg - a.avg; });
  const img = challengeImages[currentWeekId] ? challengeImages[currentWeekId][div] : null;

  let html = '<div style="margin-bottom:16px;">';
  html += '<h2 style="color:' + divColor + ';font-size:18px;margin-bottom:10px;">' + divisions[div].name + ' Challenge</h2>';
  if (img) html += '<img src="' + img + '" style="width:100%;max-height:200px;object-fit:cover;border-radius:10px;margin-bottom:14px;">';

  if (allChals.length === 0) {
    html += '<p style="font-size:13px;color:rgba(255,255,255,0.4);">No challenge entries for this division yet.</p>';
  } else if (ranked.length > 0) {
    html += '<div style="background:rgba(0,0,0,0.15);padding:10px;border-radius:8px;margin-bottom:12px;">' +
      '<p style="font-size:12px;color:rgba(255,255,255,0.5);margin:0;">' + ranked.length + ' of ' + allChals.length + ' entries scored · Leader: <b style="color:var(--brand-gold);">' + ranked[0].title + '</b> (' + ranked[0].avg + '%)</p></div>';
    html += ranked.map(function(sub, idx) {
      return '<div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;border-left:3px solid ' + divColor + ';">' +
        '<div style="display:flex;align-items:center;gap:12px;">' +
        '<div style="font-weight:800;color:' + (idx < 3 ? 'var(--brand-gold)' : 'rgba(255,255,255,0.4)') + ';width:28px;">#' + (idx + 1) + '</div>' +
        (sub.image ? '<img src="' + sub.image + '" style="width:40px;height:40px;object-fit:cover;border-radius:6px;">' : '') +
        '<div><div style="font-weight:700;font-size:14px;color:white;">' + sub.title + '</div><div style="font-size:12px;color:rgba(255,255,255,0.5);">by ' + sub.author + '</div></div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:10px;">' +
        '<div style="font-weight:800;font-size:16px;color:var(--brand-gold);">' + sub.avg + '%</div>' +
        '<a href="' + sub.link + '" target="_blank" style="padding:4px 10px;background:var(--brand-gold);color:#1a1a2e;text-decoration:none;font-weight:700;border-radius:4px;font-size:11px;">Play</a>' +
        '</div></div>';
    }).join('');
  } else {
    html += '<p style="font-size:13px;color:rgba(255,255,255,0.4);">Entries submitted but not yet scored by judges.</p>';
    html += allChals.map(function(sub) {
      return '<div class="card" style="border-left:4px solid ' + divColor + ';margin-bottom:10px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
        '<div><div style="font-weight:700;font-size:16px;">' + sub.title + '</div><div style="font-size:13px;color:rgba(255,255,255,0.6);">by ' + sub.author + '</div></div>' +
        '<a href="' + sub.link + '" target="_blank" style="padding:6px 12px;background:var(--brand-gold);color:#1a1a2e;text-decoration:none;font-weight:700;border-radius:6px;font-size:12px;">Play</a>' +
        '</div></div>';
    }).join('');
  }
  html += '</div>';
  container.innerHTML = html;
}

function renderAdminSettings() {
  renderDivisionLogoSettings();
  renderNotificationSettings();
}

function renderNotificationSettings() {
  const container = $('notificationSettings');
  if (!container) return;
  const statusColor = emailEnabled ? '#6bff6b' : '#ff6b6b';
  const statusText = emailEnabled ? '✅ ACTIVE — Emails are being sent to judges' : '❌ DISABLED — SMTP not configured on Render';
  container.innerHTML = '<div style="background:rgba(0,0,0,0.2);padding:16px;border-radius:8px;margin-bottom:16px;border-left:3px solid ' + statusColor + ';">' +
    '<p style="font-size:14px;font-weight:700;color:' + statusColor + ';margin:0 0 8px 0;">' + statusText + '</p>' +
    '<p style="font-size:12px;color:rgba(255,255,255,0.5);margin:0;">' + (emailEnabled ? 'Judges will receive an email every time a new submission is added to their division.' : 'You must add SMTP environment variables on Render for email to work. The frontend cannot send emails by itself.') + '</p>' +
    '</div>' +
    '<div id="testEmailWrap" style="display:' + (emailEnabled ? 'block' : 'none') + ';margin-bottom:16px;">' +
    '<p style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:8px;">Send a test email to verify delivery:</p>' +
    '<div style="display:flex;gap:8px;">' +
    '<input type="email" id="testEmailInput" placeholder="your@email.com" style="flex:1;padding:8px 12px;background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:13px;">' +
    '<button onclick="sendTestEmail()" style="padding:8px 16px;background:#6bff6b;border:none;border-radius:6px;color:#1a1a2e;cursor:pointer;font-size:12px;font-weight:700;">Send Test</button>' +
    '</div></div>' +
    '<div style="background:rgba(0,0,0,0.15);padding:12px;border-radius:6px;">' +
    '<p style="font-size:12px;color:rgba(255,255,255,0.6);margin:0 0 8px 0;font-weight:600;">Required Render Environment Variables:</p>' +
    '<code style="display:block;background:rgba(0,0,0,0.3);padding:10px;border-radius:4px;font-size:11px;color:#6bff6b;line-height:1.6;">SMTP_HOST=smtp.gmail.com<br>SMTP_PORT=587<br>SMTP_USER=your-email@gmail.com<br>SMTP_PASS=your-app-password<br>SMTP_FROM=astra-musica@yourdomain.com</code>' +
    '<p style="font-size:11px;color:rgba(255,255,255,0.4);margin:8px 0 0 0;">For Gmail, use an App Password (not your regular password). Go to Google Account → Security → 2-Step Verification → App passwords.</p>' +
    '</div>' +
    '<h4 style="font-size:14px;font-weight:600;margin:20px 0 10px 0;color:rgba(255,255,255,0.7);">WhatsApp Notifications</h4>' +
    '<p style="font-size:13px;color:rgba(255,255,255,0.5);margin-bottom:12px;">Send manual WhatsApp alerts to judges. Click a judge below to open WhatsApp.</p>' +
    '<div id="whatsappNotifyList"></div>';
  const waList = container.querySelector('#whatsappNotifyList');
  if (waList) {
    waList.innerHTML = Object.values(judges).map(function(j) {
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);">' +
        '<div><div style="font-size:13px;font-weight:600;">' + j.name + '</div><div style="font-size:11px;color:rgba(255,255,255,0.5);">' + (divisions[j.division]?.name || j.division) + '</div></div>' +
        '<a href="https://wa.me/?text=' + encodeURIComponent('Hi ' + j.name + ', new submissions are ready for judging in ' + (divisions[j.division]?.name || j.division) + ' on Astra Musica!') + '" target="_blank" class="btn btn-secondary" style="font-size:11px;padding:4px 10px;text-decoration:none;">📲 Send WhatsApp</a>' +
        '</div>';
    }).join('') || '<p style="font-size:12px;color:rgba(255,255,255,0.4);">No judges available.</p>';
  }
}

async function sendTestEmail() {
  const email = $('testEmailInput').value.trim();
  if (!email) { toast('Enter email address', 'error'); return; }
  const res = await apiPost('/api/admin/test-email', { email: email });
  if (res.error) { toast(res.error, 'error'); return; }
  toast('Test email sent successfully!');
}

async function updateLogo() {
  const url = $('logoUrl').value.trim();
  if (!url) { toast('Please enter a valid logo URL', 'error'); return; }
  await apiPost('/api/admin/logo', { logoUrl: url });
  mainLogoUrl = url;
  renderMainLogo();
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
  mainLogoUrl = base64;
  renderMainLogo();
  toast('Main logo uploaded!');
}

function renderDivisionLogoSettings() {
  const container = $('divisionLogosList');
  if (!container) return;
  container.innerHTML = Object.keys(divisions).map(function(div) {
    const divColor = divisions[div].color;
    const currentLogo = divisionLogos[div] || '';
    return '<div class="card" style="border-left:4px solid ' + divColor + ';margin-bottom:10px;padding:12px;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">' +
      '<b style="color:' + divColor + ';font-size:14px;">' + divisions[div].name + '</b>' +
      (currentLogo ? '<img src="' + currentLogo + '" style="max-width:36px;max-height:36px;object-fit:contain;border-radius:4px;">' : '') +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:8px;">' +
      '<input type="text" id="logo-input-' + div + '" value="' + currentLogo + '" placeholder="Logo URL..." style="flex:1;padding:6px;font-size:12px;">' +
      '<button class="btn btn-primary" style="width:auto;padding:6px 12px;font-size:12px;" onclick="saveDivisionLogo(\'' + div + '\')">Save</button>' +
      '</div></div>';
  }).join('');
}

async function saveDivisionLogo(div) {
  const url = $('logo-input-' + div).value.trim();
  divisionLogos[div] = url;
  await apiPost('/api/admin/division-logos', { division: div, logoUrl: url });
  toast('Logo updated for ' + divisions[div].name + '!');
  renderDivisionLogoSettings();
}

// ===================== FILE PREVIEWS & BINDINGS =====================
function setupImagePreviews() {
  const bindPreview = function(inputId, previewId) {
    const input = $(inputId);
    const preview = $(previewId);
    if (input && preview) {
      input.addEventListener('change', async function() {
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
  bindPreview('newsImage', 'newsImagePreview');
}

// ===================== NEWS STATION =====================

function renderAdminNews() {
  const container = $('adminNewsList');
  if (!container) return;
  container.innerHTML = news.map(function(a) {
    return '<div class="card" style="margin-top:12px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">' +
      '<div style="flex:1;">' +
      '<h4 style="margin:0 0 6px 0;font-size:16px;color:white;">' + a.title + '</h4>' +
      '<p style="margin:0 0 8px 0;font-size:12px;color:rgba(255,255,255,0.5);">' + formatDate(a.timestamp) + ' · ' + (a.comments ? a.comments.length : 0) + ' comments · ' + (a.likes || 0) + ' ❤️</p>' +
      '<p style="margin:0;font-size:13px;color:rgba(255,255,255,0.7);line-height:1.5;">' + a.content.substring(0, 180) + (a.content.length > 180 ? '...' : '') + '</p>' +
      '</div>' +
      (a.image ? '<img src="' + a.image + '" style="width:80px;height:80px;object-fit:cover;border-radius:8px;flex-shrink:0;">' : '') +
      '</div>' +
      '<div style="margin-top:12px;display:flex;gap:8px;">' +
      '<button onclick="deleteNews(' + a.id + ')" style="background:none;border:none;color:#ff6b6b;cursor:pointer;font-size:13px;">🗑️ Delete</button>' +
      '</div></div>';
  }).join('') || '<p style="padding:20px;color:rgba(255,255,255,0.4);font-size:13px;">No news articles yet.</p>';
}

async function addNews() {
  const title = $('newsTitle').value.trim();
  const content = $('newsContent').value.trim();
  const photoInput = $('newsImage');
  if (!title || !content) { toast('Title and content are required', 'error'); return; }
  let image = '';
  if (photoInput && photoInput.files && photoInput.files[0]) {
    image = await fileToBase64(photoInput.files[0]);
  }
  const res = await apiPost('/api/admin/news', { title, content, image });
  if (res.error) { toast(res.error, 'error'); return; }
  toast('News article published!');
  $('newsTitle').value = ''; $('newsContent').value = '';
  if (photoInput) photoInput.value = '';
  if ($('newsImagePreview')) $('newsImagePreview').style.display = 'none';
  await loadData();
  renderAdminNews();
}

async function deleteNews(id) {
  if (!confirm('Delete this news article?')) return;
  await apiDelete('/api/admin/news/' + id);
  await loadData();
  renderAdminNews();
  toast('Article deleted');
}

function renderPublicNews() {
  const container = $('publicNewsList');
  if (!container) return;
  container.innerHTML = news.map(function(a) {
    return '<div class="card" style="margin-top:12px;">' +
      (a.image ? '<img src="' + a.image + '" style="width:100%;max-height:220px;object-fit:cover;border-radius:8px;margin-bottom:12px;">' : '') +
      '<h3 style="margin:0 0 6px 0;font-size:18px;color:white;">' + a.title + '</h3>' +
      '<p style="margin:0 0 12px 0;font-size:12px;color:rgba(255,255,255,0.5);">' + formatDate(a.timestamp) + '</p>' +
      '<p style="margin:0 0 16px 0;font-size:14px;color:rgba(255,255,255,0.8);line-height:1.6;white-space:pre-wrap;">' + a.content + '</p>' +
      '<div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.1);">' +
      '<button onclick="likeNews(' + a.id + ')" style="background:none;border:none;cursor:pointer;font-size:18px;color:#ff6b6b;">❤️ ' + (a.likes || 0) + '</button>' +
      '<span style="font-size:13px;color:rgba(255,255,255,0.5);">💬 ' + (a.comments ? a.comments.length : 0) + ' comments</span>' +
      '</div>' +
      '<div style="background:rgba(0,0,0,0.2);padding:12px;border-radius:8px;">' +
      '<p style="font-size:13px;font-weight:700;color:rgba(255,255,255,0.7);margin:0 0 8px 0;">Comments</p>' +
      (a.comments && a.comments.length > 0 ? a.comments.map(function(c) {
        return '<div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);">' +
          '<span style="font-weight:700;font-size:12px;color:var(--brand-gold);">' + c.name + '</span>' +
          '<span style="font-size:11px;color:rgba(255,255,255,0.4);margin-left:8px;">' + formatDate(c.timestamp) + '</span>' +
          '<p style="margin:4px 0 0 0;font-size:13px;color:rgba(255,255,255,0.8);">' + c.text + '</p>' +
          '</div>';
      }).join('') : '<p style="font-size:12px;color:rgba(255,255,255,0.3);margin:0;">No comments yet.</p>') +
      '<div style="display:flex;gap:8px;margin-top:10px;">' +
      '<input type="text" id="news-comment-name-' + a.id + '" placeholder="Your name" style="flex:0 0 100px;padding:6px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:white;font-size:12px;">' +
      '<input type="text" id="news-comment-text-' + a.id + '" placeholder="Write a comment..." style="flex:1;padding:6px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:white;font-size:12px;">' +
      '<button onclick="addNewsComment(' + a.id + ')" style="padding:6px 12px;background:var(--brand-gold);color:#1a1a2e;border:none;border-radius:4px;font-weight:700;font-size:12px;cursor:pointer;">Post</button>' +
      '</div></div></div>';
  }).join('') || '<p class="text-center text-tertiary" style="padding:40px;">No news articles yet.</p>';
}

async function addNewsComment(id) {
  const name = $('news-comment-name-' + id).value.trim();
  const text = $('news-comment-text-' + id).value.trim();
  if (!name || !text) { toast('Enter your name and a comment', 'error'); return; }
  const res = await apiPost('/api/news/' + id + '/comment', { name, text });
  if (res.error) { toast(res.error, 'error'); return; }
  toast('Comment posted!');
  await loadData();
  renderPublicNews();
}

async function likeNews(id) {
  const res = await apiPost('/api/news/' + id + '/like', {});
  if (res.error) { toast(res.error, 'error'); return; }
  toast('❤️ Liked!');
  await loadData();
  renderPublicNews();
}

async function likeSubmission(subId) {
  const res = await apiPost('/api/submissions/' + subId + '/like', {});
  if (res.error) { toast(res.error, 'error'); return; }
  toast('❤️ Liked!');
  await loadData();
  renderTop20();
}

// ===================== INITIALIZATION =====================
window.addEventListener('DOMContentLoaded', async function() {
  setupImagePreviews();
  const parentForm = document.querySelector('#adminSubmissions .manual-form');
  if (parentForm && !parentForm.querySelector('button.btn-gold')) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-gold full';
    btn.style.marginTop = '12px';
    btn.textContent = '➕ Save Submission';
    btn.onclick = addManualSubmission;
    parentForm.appendChild(btn);
  }
  await loadData();
  showScreen('screenRole');
  showBackdrop(mainLogoUrl);
});