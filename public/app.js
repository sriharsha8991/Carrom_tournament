// ---------- State ----------
const state = {
  admin: false,
  teams: [],
  matches: [],
  activeTab: 'leaderboard',
};

// ---------- Helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let msg = 'Request failed';
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function dateKey(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function formatCountdown(iso) {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const diff = t - Date.now();
  if (diff <= 0) return '';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return `Starts in ${days}d ${hours}h`;
  if (hours > 0) return `Starts in ${hours}h ${mins}m`;
  return `Starts in ${mins}m`;
}

// ---------- Tabs ----------
function setupTabs() {
  const tabs = $$('.tab');
  const underline = $('.tab-underline');
  const moveUnderline = (el) => {
    const r = el.getBoundingClientRect();
    const parent = el.parentElement.getBoundingClientRect();
    underline.style.width = r.width + 'px';
    underline.style.transform = `translateX(${r.left - parent.left}px)`;
  };

  tabs.forEach((t) => {
    t.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.remove('active'));
      $$('.tab-panel').forEach((p) => p.classList.remove('active'));
      t.classList.add('active');
      const id = 'tab-' + t.dataset.tab;
      $('#' + id).classList.add('active');
      state.activeTab = t.dataset.tab;
      moveUnderline(t);
    });
  });

  // initial
  requestAnimationFrame(() => moveUnderline($('.tab.active')));
  window.addEventListener('resize', () => moveUnderline($('.tab.active')));
}

// ---------- Auth ----------
async function checkAuth() {
  try {
    const r = await api('/api/auth/check');
    state.admin = !!r.admin;
  } catch { state.admin = false; }
  renderAuthUI();
}

function renderAuthUI() {
  $('#adminBadge').classList.toggle('hidden', !state.admin);
  $('#logoutBtn').classList.toggle('hidden', !state.admin);
  $('#loginBtn').classList.toggle('hidden', state.admin);
  $('#scheduleForm').classList.toggle('hidden', !state.admin);
  $('#adminTeamCol').classList.toggle('hidden', !state.admin);
}

function setupAuth() {
  const modal = $('#loginModal');
  const open = () => { modal.classList.remove('hidden'); $('#loginPassword').focus(); };
  const close = () => { modal.classList.add('hidden'); $('#loginPassword').value = ''; $('#loginError').textContent = ''; };

  $('#loginBtn').addEventListener('click', open);
  $('#cancelLogin').addEventListener('click', close);
  $('.modal-backdrop').addEventListener('click', close);
  $('#loginPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#submitLogin').click(); });

  $('#submitLogin').addEventListener('click', async () => {
    const password = $('#loginPassword').value;
    $('#loginError').textContent = '';
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
      state.admin = true;
      close();
      renderAuthUI();
      await refreshAll();
    } catch (e) {
      $('#loginError').textContent = e.message;
    }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    state.admin = false;
    renderAuthUI();
    await refreshAll();
  });
}

// ---------- Leaderboard ----------
function computeRanks(teams) {
  // teams already sorted by points DESC, penalties DESC
  const ranks = [];
  let lastRank = 0;
  teams.forEach((t, i) => {
    if (i === 0) { lastRank = 1; }
    else {
      const prev = teams[i - 1];
      if (prev.points === t.points && prev.penalties === t.penalties) {
        // same rank
      } else {
        lastRank = i + 1;
      }
    }
    ranks.push(lastRank);
  });
  return ranks;
}

const TEAMS_PER_PAGE = 6;
let leaderboardPage = 0;

function renderLeaderboard() {
  const tbody = $('#leaderboardBody');
  const teams = state.teams;
  const ranks = computeRanks(teams);
  const totalPages = Math.ceil(teams.length / TEAMS_PER_PAGE);
  if (leaderboardPage >= totalPages) leaderboardPage = totalPages - 1;
  if (leaderboardPage < 0) leaderboardPage = 0;
  const start = leaderboardPage * TEAMS_PER_PAGE;
  const pageTeams = teams.slice(start, start + TEAMS_PER_PAGE);
  const pageRanks = ranks.slice(start, start + TEAMS_PER_PAGE);

  tbody.innerHTML = pageTeams.map((t, i) => {
    const rank = pageRanks[i];
    let badgeClass = '';
    let podiumClass = '';
    if (rank === 1) { badgeClass = 'gold'; podiumClass = 'podium-gold'; }
    else if (rank === 2) { badgeClass = 'silver'; podiumClass = 'podium-silver'; }
    else if (rank === 3) { badgeClass = 'bronze'; podiumClass = 'podium-bronze'; }
    const penaltyDisplay = t.penalties === 0 ? '—' : t.penalties;
    return `
      <tr data-team-id="${t.id}" class="${podiumClass}">
        <td><span class="rank-badge ${badgeClass}">${rank}</span></td>
        <td><div class="team-name">${escapeHtml(t.name)}</div></td>
        <td><div class="players">${escapeHtml(t.player1)} & ${escapeHtml(t.player2)}</div></td>
        <td class="num">${t.points}</td>
        <td class="num">${penaltyDisplay}</td>
        <td class="num">${t.played}</td>
        ${state.admin ? `<td class="num"><button class="btn ghost small edit-team-btn" data-id="${t.id}">Edit</button></td>` : ''}
      </tr>
    `;
  }).join('');

  // Pagination controls
  let paginationEl = document.getElementById('leaderboardPagination');
  if (!paginationEl) {
    paginationEl = document.createElement('div');
    paginationEl.id = 'leaderboardPagination';
    paginationEl.className = 'pagination';
    tbody.closest('.table-wrap').parentElement.appendChild(paginationEl);
  }
  if (totalPages <= 1) {
    paginationEl.innerHTML = '';
  } else {
    paginationEl.innerHTML = `
      <button class="btn ghost small pg-prev" ${leaderboardPage === 0 ? 'disabled' : ''}>← Prev</button>
      <span class="pg-info">Page ${leaderboardPage + 1} of ${totalPages}</span>
      <button class="btn ghost small pg-next" ${leaderboardPage >= totalPages - 1 ? 'disabled' : ''}>Next →</button>
    `;
    paginationEl.querySelector('.pg-prev').addEventListener('click', () => { leaderboardPage--; renderLeaderboard(); });
    paginationEl.querySelector('.pg-next').addEventListener('click', () => { leaderboardPage++; renderLeaderboard(); });
  }

  if (state.admin) {
    $$('.edit-team-btn').forEach((b) => {
      b.addEventListener('click', () => openEditTeamRow(Number(b.dataset.id)));
    });
  }
}

function openEditTeamRow(id) {
  const team = state.teams.find((t) => t.id === id);
  if (!team) return;
  const row = document.querySelector(`tr[data-team-id="${id}"]`);
  if (!row) return;

  // Close any already-open edit rows
  $$('.inline-edit-row').forEach((r) => r.remove());
  setEditing(true);

  const colCount = state.admin ? 7 : 6;
  const editRow = document.createElement('tr');
  editRow.classList.add('inline-edit-row');
  editRow.innerHTML = `
    <td colspan="${colCount}">
      <div class="inline-edit-form">
        <div class="edit-form-header">
          <strong>Editing ${escapeHtml(team.name)}</strong>
          <span class="muted" style="font-size:12px">${escapeHtml(team.player1)} & ${escapeHtml(team.player2)}</span>
        </div>
        <div class="edit-form-fields">
          <label class="edit-label">Points<input type="number" value="${team.points}" data-field="points"></label>
          <label class="edit-label">Penalties<input type="number" value="${team.penalties}" data-field="penalties"></label>
          <label class="edit-label">Played<input type="number" value="${team.played}" data-field="played"></label>
        </div>
        <div class="edit-form-actions">
          <button class="btn primary small save">Save changes</button>
          <button class="btn ghost small cancel">Cancel</button>
        </div>
      </div>
    </td>
  `;
  row.after(editRow);

  // Focus first input
  const firstInput = editRow.querySelector('input');
  if (firstInput) firstInput.select();

  const close = () => { editRow.remove(); setEditing(false); };
  editRow.querySelector('.cancel').addEventListener('click', close);

  // Esc to close
  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);

  // Enter to save from any input
  editRow.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') editRow.querySelector('.save').click(); });
  });

  editRow.querySelector('.save').addEventListener('click', async () => {
    const payload = {};
    editRow.querySelectorAll('input[data-field]').forEach((inp) => {
      payload[inp.dataset.field] = Number(inp.value);
    });
    try {
      await api(`/api/teams/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      document.removeEventListener('keydown', onKey);
      setEditing(false);
      await refreshAll();
    } catch (e) { alert(e.message); }
  });
}

// ---------- Matches ----------
function renderTeamSelects() {
  const a = $('#matchTeamA');
  const b = $('#matchTeamB');
  if (!a || !b) return;
  const prevA = a.value;
  const prevB = b.value;
  const opts = state.teams.map((t) => `<option value="${t.id}">${escapeHtml(t.name)} — ${escapeHtml(t.player1)} & ${escapeHtml(t.player2)}</option>`).join('');
  a.innerHTML = '<option value="">Team A</option>' + opts;
  b.innerHTML = '<option value="">Team B</option>' + opts;
  if (prevA) a.value = prevA;
  if (prevB) b.value = prevB;
}

function renderMatches() {
  const list = $('#matchesList');
  const matches = state.matches;
  if (matches.length === 0) {
    list.innerHTML = '';
    return;
  }

  const now = new Date();
  const upcoming = matches.filter((m) => new Date(m.date) > now);
  const completed = matches.filter((m) => new Date(m.date) <= now);

  let html = '';

  // --- Upcoming section ---
  if (upcoming.length > 0) {
    html += `<div class="matches-section">
      <div class="section-header upcoming-header">
        <span class="section-icon">&#128197;</span>
        <h3>Upcoming Matches</h3>
        <span class="section-count">${upcoming.length}</span>
      </div>`;
    const upGroups = groupByDate(upcoming);
    for (const [k, ms] of upGroups.entries()) {
      html += `<div class="date-group-header">${escapeHtml(k)}</div>`;
      ms.forEach((m) => { html += renderMatchCard(m); });
    }
    html += `</div>`;
  }

  // --- Completed section ---
  if (completed.length > 0) {
    html += `<div class="matches-section">
      <div class="section-header completed-header">
        <span class="section-icon">&#9989;</span>
        <h3>Completed Matches</h3>
        <span class="section-count">${completed.length}</span>
      </div>`;
    const compGroups = groupByDate(completed);
    for (const [k, ms] of compGroups.entries()) {
      html += `<div class="date-group-header">${escapeHtml(k)}</div>`;
      ms.forEach((m) => { html += renderMatchCard(m); });
    }
    html += `</div>`;
  }

  list.innerHTML = html;

  if (state.admin) {
    $$('.delete-match-btn').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete this match?')) return;
      try {
        await api(`/api/matches/${b.dataset.id}`, { method: 'DELETE' });
        await refreshAll();
      } catch (e) { alert(e.message); }
    }));
  }
}

function groupByDate(matches) {
  const groups = new Map();
  matches.forEach((m) => {
    const k = dateKey(m.date);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  });
  return groups;
}

function renderMatchCard(m) {
  const isPast = new Date(m.date) <= new Date();
  const countdown = !isPast ? formatCountdown(m.date) : '';

  return `
    <div class="match-card ${isPast ? 'match-completed' : 'match-upcoming'}" data-match-id="${m.id}">
      <div class="match-card-row">
        <div class="match-teams">
          <div class="match-team">
            <span class="name">${escapeHtml(m.team_a_name || 'TBD')}</span>
            <span class="players">${escapeHtml((m.team_a_p1 || '') + (m.team_a_p2 ? ' & ' + m.team_a_p2 : ''))}</span>
          </div>
          <div class="match-vs">vs</div>
          <div class="match-team" style="text-align:right; align-items:flex-end">
            <span class="name">${escapeHtml(m.team_b_name || 'TBD')}</span>
            <span class="players">${escapeHtml((m.team_b_p1 || '') + (m.team_b_p2 ? ' & ' + m.team_b_p2 : ''))}</span>
          </div>
        </div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px">
          <span class="muted" style="font-size:12px">${escapeHtml(fmtDate(m.date))}</span>
          ${countdown ? `<span class="countdown">${escapeHtml(countdown)}</span>` : ''}
        </div>
      </div>
      ${state.admin ? `
        <div class="match-actions">
          <button class="btn danger small delete-match-btn" data-id="${m.id}">Delete</button>
        </div>` : ''}
    </div>
  `;
}

function setupSchedule() {
  // Mark editing while schedule form inputs have focus
  ['matchDate', 'matchTeamA', 'matchTeamB'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('focus', () => setEditing(true));
      el.addEventListener('blur', () => setTimeout(() => {
        if (!document.activeElement || !document.activeElement.closest('.schedule-form')) setEditing(false);
      }, 200));
    }
  });

  $('#scheduleBtn').addEventListener('click', async () => {
    const date = $('#matchDate').value;
    const team_a_id = Number($('#matchTeamA').value);
    const team_b_id = Number($('#matchTeamB').value);
    $('#scheduleError').textContent = '';
    if (!date) return $('#scheduleError').textContent = 'Pick a date.';
    if (!team_a_id || !team_b_id) return $('#scheduleError').textContent = 'Select both teams.';
    if (team_a_id === team_b_id) return $('#scheduleError').textContent = 'Teams must be different.';
    try {
      await api('/api/matches', {
        method: 'POST',
        body: JSON.stringify({ date: new Date(date).toISOString(), team_a_id, team_b_id }),
      });
      $('#matchDate').value = '';
      $('#matchTeamA').value = '';
      $('#matchTeamB').value = '';
      setEditing(false);
      await refreshAll();
    } catch (e) { $('#scheduleError').textContent = e.message; }
  });
}

// ---------- Teams ----------
function getTeamNumber(name) {
  const m = name.match(/\d+/);
  return m ? m[0] : '?';
}

function renderTeams(filter = '') {
  const lower = filter.toLowerCase();
  $('#teamsGrid').innerHTML = state.teams
    .slice()
    .sort((a, b) => a.id - b.id)
    .filter(t => !lower || t.name.toLowerCase().includes(lower) || t.player1.toLowerCase().includes(lower) || t.player2.toLowerCase().includes(lower))
    .map((t) => `
      <div class="team-card">
        <div class="team-card-header">
          <div class="team-avatar">${getTeamNumber(t.name)}</div>
          <div class="team-num">${escapeHtml(t.name)}</div>
        </div>
        <div class="team-players">
          <div>${escapeHtml(t.player1)}</div>
          <div>${escapeHtml(t.player2)}</div>
        </div>
      </div>
    `).join('');
}

// ---------- Refresh ----------
function updateHeroStats() {
  const el = (id) => document.getElementById(id);
  if (el('statTeams')) el('statTeams').textContent = state.teams.length;
  if (el('statMatches')) el('statMatches').textContent = state.matches.length;
  if (el('statCompleted')) el('statCompleted').textContent = state.matches.filter(m => new Date(m.date) <= new Date()).length;
}

function updateEmptyState() {
  const noMatches = $('#noMatches');
  const list = $('#matchesList');
  if (!noMatches) return;
  if (state.matches.length === 0) {
    noMatches.classList.remove('hidden');
    list.style.display = 'none';
  } else {
    noMatches.classList.add('hidden');
    list.style.display = '';
  }
}

// Track if user is interacting with forms — skip destructive re-renders
let _userEditing = false;

async function refreshAll() {
  try {
    const [teams, matches] = await Promise.all([api('/api/teams'), api('/api/matches')]);
    state.teams = teams;
    state.matches = matches;

    // Always update hero stats (non-destructive)
    updateHeroStats();

    // Skip DOM-rebuilding renders if user has a form open
    if (!_userEditing) {
      renderLeaderboard();
      renderMatches();
      const searchInput = document.getElementById('teamSearch');
      renderTeams(searchInput ? searchInput.value : '');
      renderTeamSelects();
      updateEmptyState();
    }
  } catch (e) {
    console.error(e);
  }
}

function setEditing(v) { _userEditing = v; }

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupAuth();
  setupSchedule();
  setupDarkMode();
  setupTeamSearch();
  await checkAuth();
  await refreshAll();

  // Refresh on focus (when user switches back to tab)
  window.addEventListener('focus', refreshAll);
});

function setupDarkMode() {
  const toggle = document.getElementById('themeToggle');
  const icon = document.getElementById('themeIcon');
  const sunPath = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
  const moonPath = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';

  function applyTheme(dark) {
    document.documentElement.dataset.theme = dark ? 'dark' : '';
    icon.innerHTML = dark ? sunPath : moonPath;
  }

  const saved = localStorage.getItem('theme');
  applyTheme(saved === 'dark');

  toggle.addEventListener('click', () => {
    const isDark = document.documentElement.dataset.theme === 'dark';
    const next = !isDark;
    localStorage.setItem('theme', next ? 'dark' : 'light');
    applyTheme(next);
  });
}

function setupTeamSearch() {
  const input = document.getElementById('teamSearch');
  if (!input) return;
  input.addEventListener('input', () => {
    renderTeams(input.value);
  });
}
