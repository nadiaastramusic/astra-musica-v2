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