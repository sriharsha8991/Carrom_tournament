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

function renderLeaderboard() {
  const tbody = $('#leaderboardBody');
  const teams = state.teams;
  const ranks = computeRanks(teams);

  // Build a map of points → count, but only counting teams that have played
  const activePointsCounts = {};
  teams.forEach((t) => {
    if (t.played > 0) {
      activePointsCounts[t.points] = (activePointsCounts[t.points] || 0) + 1;
    }
  });

  tbody.innerHTML = teams.map((t, i) => {
    const rank = ranks[i];
    let badgeClass = '';
    if (rank === 1) badgeClass = 'gold';
    else if (rank === 2) badgeClass = 'silver';
    else if (rank === 3) badgeClass = 'bronze';
    // Only show TIE for teams that have played and share their points with another active team
    const tied = t.played > 0 && (activePointsCounts[t.points] || 0) > 1;
    const penaltyDisplay = t.penalties === 0 ? '—' : t.penalties;
    return `
      <tr data-team-id="${t.id}">
        <td><span class="rank-badge ${badgeClass}">${rank}</span></td>
        <td><div class="team-name">${escapeHtml(t.name)}</div></td>
        <td><div class="players">${escapeHtml(t.player1)} & ${escapeHtml(t.player2)}</div></td>
        <td class="num">${t.points}${tied ? '<span class="tie-badge">TIE</span>' : ''}</td>
        <td class="num">${penaltyDisplay}</td>
        <td class="num">${t.played}</td>
        ${state.admin ? `<td class="num"><button class="btn ghost small edit-team-btn" data-id="${t.id}">Edit</button></td>` : ''}
      </tr>
    `;
  }).join('');

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
    $$('.enter-result-btn').forEach((b) => b.addEventListener('click', () => openResultForm(Number(b.dataset.id))));
    $$('.delete-match-btn').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete this match? If it was completed, points will be reversed.')) return;
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
          ${!isPast ? `<button class="btn primary small enter-result-btn" data-id="${m.id}">Enter result</button>` : `<button class="btn ghost small enter-result-btn" data-id="${m.id}">Edit result</button>`}
          <button class="btn danger small delete-match-btn" data-id="${m.id}">Delete</button>
        </div>` : ''}
    </div>
  `;
}

function openResultForm(id) {
  const card = document.querySelector(`.match-card[data-match-id="${id}"]`);
  if (!card || card.querySelector('.inline-result-form')) return;
  const m = state.matches.find((x) => x.id === id);
  if (!m) return;
  setEditing(true);

  const form = document.createElement('div');
  form.className = 'inline-result-form';
  form.innerHTML = `
    <span><strong>${escapeHtml(m.team_a_name)}</strong> score</span>
    <input type="number" id="ra-${id}" value="${m.score_a || 0}">
    <span><strong>${escapeHtml(m.team_b_name)}</strong> score</span>
    <input type="number" id="rb-${id}" value="${m.score_b || 0}">
    <div class="penalty-section" style="display:none; gap:10px; align-items:center; flex-wrap:wrap">
      <span class="muted">Tie — penalties:</span>
      <input type="number" id="pa-${id}" placeholder="A pen" value="${m.penalty_a || 0}">
      <input type="number" id="pb-${id}" placeholder="B pen" value="${m.penalty_b || 0}">
    </div>
    <button class="btn primary small save-result">Save</button>
    <button class="btn ghost small cancel-result">Cancel</button>
  `;
  card.appendChild(form);

  const ra = form.querySelector(`#ra-${id}`);
  const rb = form.querySelector(`#rb-${id}`);
  const penaltySection = form.querySelector('.penalty-section');
  const updatePenaltyVisibility = () => {
    penaltySection.style.display = (Number(ra.value) === Number(rb.value)) ? 'flex' : 'none';
  };
  ra.addEventListener('input', updatePenaltyVisibility);
  rb.addEventListener('input', updatePenaltyVisibility);
  updatePenaltyVisibility();

  form.querySelector('.cancel-result').addEventListener('click', () => { form.remove(); setEditing(false); });
  form.querySelector('.save-result').addEventListener('click', async () => {
    const score_a = Number(ra.value);
    const score_b = Number(rb.value);
    const tie = score_a === score_b;
    const penalty_a = tie ? Number(form.querySelector(`#pa-${id}`).value) : 0;
    const penalty_b = tie ? Number(form.querySelector(`#pb-${id}`).value) : 0;
    try {
      await api(`/api/matches/${id}/result`, {
        method: 'PUT',
        body: JSON.stringify({ score_a, score_b, penalty_a, penalty_b }),
      });
      setEditing(false);
      await refreshAll();
    } catch (e) { alert(e.message); }
  });
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

function renderTeams() {
  $('#teamsGrid').innerHTML = state.teams
    .slice()
    .sort((a, b) => a.id - b.id)
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
  if (el('statCompleted')) el('statCompleted').textContent = state.matches.filter(m => m.status === 'completed').length;
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
      renderTeams();
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
  await checkAuth();
  await refreshAll();

  // Poll every 10s
  setInterval(refreshAll, 10000);
  // Refresh on focus
  window.addEventListener('focus', refreshAll);
});
