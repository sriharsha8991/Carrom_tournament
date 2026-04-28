require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// --- Prepared statements ---
const stmts = {
  insertSession: db.prepare("INSERT INTO admin_session (token, created_at) VALUES (?, datetime('now'))"),
  getSession: db.prepare('SELECT token, created_at FROM admin_session WHERE token = ?'),
  deleteSession: db.prepare('DELETE FROM admin_session WHERE token = ?'),
  cleanSessions: db.prepare("DELETE FROM admin_session WHERE created_at < datetime('now', '-1 day')"),

  allTeams: db.prepare('SELECT * FROM teams ORDER BY points DESC, penalties DESC, id ASC'),
  getTeam: db.prepare('SELECT * FROM teams WHERE id = ?'),
  updateTeamStats: db.prepare('UPDATE teams SET points = ?, penalties = ?, played = ? WHERE id = ?'),
  applyTeamDelta: db.prepare(
    'UPDATE teams SET points = points + ?, penalties = penalties + ?, played = played + ? WHERE id = ?'
  ),

  allMatches: db.prepare(`
    SELECT m.*,
      ta.name AS team_a_name, ta.player1 AS team_a_p1, ta.player2 AS team_a_p2,
      tb.name AS team_b_name, tb.player1 AS team_b_p1, tb.player2 AS team_b_p2
    FROM matches m
    LEFT JOIN teams ta ON ta.id = m.team_a_id
    LEFT JOIN teams tb ON tb.id = m.team_b_id
    ORDER BY m.date DESC, m.id DESC
  `),
  getMatch: db.prepare('SELECT * FROM matches WHERE id = ?'),
  insertMatch: db.prepare('INSERT INTO matches (date, team_a_id, team_b_id) VALUES (?, ?, ?)'),
  updateMatchResult: db.prepare(
    "UPDATE matches SET score_a = ?, score_b = ?, penalty_a = ?, penalty_b = ?, status = 'completed' WHERE id = ?"
  ),
  deleteMatch: db.prepare('DELETE FROM matches WHERE id = ?'),
};

// --- Auth ---
function requireAdmin(req, res, next) {
  const token = req.cookies && req.cookies.adminToken;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  stmts.cleanSessions.run();
  const row = stmts.getSession.get(token);
  if (!row) return res.status(401).json({ error: 'Unauthorized' });
  const created = new Date(row.created_at + 'Z').getTime();
  if (isNaN(created) || Date.now() - created > SESSION_TTL_MS) {
    stmts.deleteSession.run(token);
    return res.status(401).json({ error: 'Session expired' });
  }
  next();
}

app.post('/api/auth/login', (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== 'string' || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  stmts.insertSession.run(token);
  res.cookie('adminToken', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
  });
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies && req.cookies.adminToken;
  if (token) stmts.deleteSession.run(token);
  res.clearCookie('adminToken');
  res.json({ ok: true });
});

app.get('/api/auth/check', (req, res) => {
  const token = req.cookies && req.cookies.adminToken;
  if (!token) return res.json({ admin: false });
  stmts.cleanSessions.run();
  const row = stmts.getSession.get(token);
  if (!row) return res.json({ admin: false });
  const created = new Date(row.created_at + 'Z').getTime();
  if (isNaN(created) || Date.now() - created > SESSION_TTL_MS) {
    stmts.deleteSession.run(token);
    return res.json({ admin: false });
  }
  res.json({ admin: true });
});

// --- Teams ---
app.get('/api/teams', (req, res) => {
  res.json(stmts.allTeams.all());
});

app.put('/api/teams/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  const team = stmts.getTeam.get(id);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  const points = Number.isFinite(+req.body.points) ? Math.trunc(+req.body.points) : team.points;
  const penalties = Number.isFinite(+req.body.penalties) ? Math.trunc(+req.body.penalties) : team.penalties;
  const played = Number.isFinite(+req.body.played) ? Math.trunc(+req.body.played) : team.played;
  stmts.updateTeamStats.run(points, penalties, played, id);
  res.json(stmts.getTeam.get(id));
});

// --- Matches ---
app.get('/api/matches', (req, res) => {
  res.json(stmts.allMatches.all());
});

app.post('/api/matches', requireAdmin, (req, res) => {
  const { date, team_a_id, team_b_id } = req.body || {};
  if (!date || typeof date !== 'string') return res.status(400).json({ error: 'date required' });
  const a = Number(team_a_id);
  const b = Number(team_b_id);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) {
    return res.status(400).json({ error: 'Two distinct team ids required' });
  }
  if (!stmts.getTeam.get(a) || !stmts.getTeam.get(b)) {
    return res.status(400).json({ error: 'Team not found' });
  }
  const info = stmts.insertMatch.run(date, a, b);
  res.json(stmts.getMatch.get(info.lastInsertRowid));
});

app.put('/api/matches/:id/result', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  const match = stmts.getMatch.get(id);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const score_a = Math.trunc(+req.body.score_a) || 0;
  const score_b = Math.trunc(+req.body.score_b) || 0;
  let penalty_a = Math.trunc(+req.body.penalty_a) || 0;
  let penalty_b = Math.trunc(+req.body.penalty_b) || 0;
  // Penalties only allowed on a tie
  if (score_a !== score_b) {
    penalty_a = 0;
    penalty_b = 0;
  }

  const tx = db.transaction(() => {
    // If match was already completed, first reverse old contribution
    if (match.status === 'completed') {
      stmts.applyTeamDelta.run(-match.score_a, -match.penalty_a, -1, match.team_a_id);
      stmts.applyTeamDelta.run(-match.score_b, -match.penalty_b, -1, match.team_b_id);
    }
    stmts.updateMatchResult.run(score_a, score_b, penalty_a, penalty_b, id);
    stmts.applyTeamDelta.run(score_a, penalty_a, 1, match.team_a_id);
    stmts.applyTeamDelta.run(score_b, penalty_b, 1, match.team_b_id);
  });
  tx();

  res.json(stmts.getMatch.get(id));
});

app.delete('/api/matches/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  const match = stmts.getMatch.get(id);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const tx = db.transaction(() => {
    if (match.status === 'completed') {
      stmts.applyTeamDelta.run(-match.score_a, -match.penalty_a, -1, match.team_a_id);
      stmts.applyTeamDelta.run(-match.score_b, -match.penalty_b, -1, match.team_b_id);
    }
    stmts.deleteMatch.run(id);
  });
  tx();

  res.json({ ok: true });
});

// Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Carrom tournament running on http://localhost:${PORT}`);
});

// --- Ensure data is flushed to disk ---
// Checkpoint WAL every 30 seconds so data survives hard kills
setInterval(() => {
  try { db.pragma('wal_checkpoint(PASSIVE)'); } catch {}
}, 30000);

// Graceful shutdown: checkpoint and close DB
function shutdown() {
  console.log('Shutting down — flushing database...');
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
  } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Keep server alive on unexpected errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
