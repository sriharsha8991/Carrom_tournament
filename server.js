require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const { pool, init } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// --- Auth middleware ---
async function requireAdmin(req, res, next) {
  const token = req.cookies && req.cookies.adminToken;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  await pool.query("DELETE FROM admin_session WHERE created_at < NOW() - INTERVAL '1 day'");
  const { rows } = await pool.query('SELECT token, created_at FROM admin_session WHERE token = $1', [token]);
  if (rows.length === 0) return res.status(401).json({ error: 'Unauthorized' });
  const created = new Date(rows[0].created_at).getTime();
  if (isNaN(created) || Date.now() - created > SESSION_TTL_MS) {
    await pool.query('DELETE FROM admin_session WHERE token = $1', [token]);
    return res.status(401).json({ error: 'Session expired' });
  }
  next();
}

// --- Lazy DB init middleware (for serverless) ---
app.use(async (req, res, next) => {
  try { await init(); next(); }
  catch (err) { console.error('DB init error:', err); res.status(500).json({ error: 'DB init failed' }); }
});

// --- Auth routes ---
app.post('/api/auth/login', async (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== 'string' || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('INSERT INTO admin_session (token) VALUES ($1)', [token]);
  res.cookie('adminToken', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
  });
  res.json({ ok: true });
});

app.post('/api/auth/logout', async (req, res) => {
  const token = req.cookies && req.cookies.adminToken;
  if (token) await pool.query('DELETE FROM admin_session WHERE token = $1', [token]);
  res.clearCookie('adminToken');
  res.json({ ok: true });
});

app.get('/api/auth/check', async (req, res) => {
  const token = req.cookies && req.cookies.adminToken;
  if (!token) return res.json({ admin: false });
  await pool.query("DELETE FROM admin_session WHERE created_at < NOW() - INTERVAL '1 day'");
  const { rows } = await pool.query('SELECT token, created_at FROM admin_session WHERE token = $1', [token]);
  if (rows.length === 0) return res.json({ admin: false });
  const created = new Date(rows[0].created_at).getTime();
  if (isNaN(created) || Date.now() - created > SESSION_TTL_MS) {
    await pool.query('DELETE FROM admin_session WHERE token = $1', [token]);
    return res.json({ admin: false });
  }
  res.json({ admin: true });
});

// --- Teams ---
app.get('/api/teams', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM teams ORDER BY points DESC, penalties DESC, id ASC');
  res.json(rows);
});

app.put('/api/teams/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  const { rows: [team] } = await pool.query('SELECT * FROM teams WHERE id = $1', [id]);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  const points = Number.isFinite(+req.body.points) ? Math.trunc(+req.body.points) : team.points;
  const penalties = Number.isFinite(+req.body.penalties) ? Math.trunc(+req.body.penalties) : team.penalties;
  const played = Number.isFinite(+req.body.played) ? Math.trunc(+req.body.played) : team.played;
  await pool.query('UPDATE teams SET points = $1, penalties = $2, played = $3 WHERE id = $4', [points, penalties, played, id]);
  const { rows: [updated] } = await pool.query('SELECT * FROM teams WHERE id = $1', [id]);
  res.json(updated);
});

// Reset all team stats to zero (admin only)
app.post('/api/teams/reset', requireAdmin, async (req, res) => {
  await pool.query('UPDATE teams SET points = 0, penalties = 0, played = 0');
  res.json({ ok: true, message: 'All team stats reset to zero' });
});

// --- Matches ---
app.get('/api/matches', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT m.*,
      ta.name AS team_a_name, ta.player1 AS team_a_p1, ta.player2 AS team_a_p2,
      tb.name AS team_b_name, tb.player1 AS team_b_p1, tb.player2 AS team_b_p2
    FROM matches m
    LEFT JOIN teams ta ON ta.id = m.team_a_id
    LEFT JOIN teams tb ON tb.id = m.team_b_id
    ORDER BY m.date DESC, m.id DESC
  `);
  res.json(rows);
});

app.post('/api/matches', requireAdmin, async (req, res) => {
  const { date, team_a_id, team_b_id } = req.body || {};
  if (!date || typeof date !== 'string') return res.status(400).json({ error: 'date required' });
  const a = Number(team_a_id);
  const b = Number(team_b_id);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) {
    return res.status(400).json({ error: 'Two distinct team ids required' });
  }
  const { rows: teamCheck } = await pool.query('SELECT id FROM teams WHERE id IN ($1, $2)', [a, b]);
  if (teamCheck.length < 2) return res.status(400).json({ error: 'Team not found' });
  const { rows: [match] } = await pool.query(
    'INSERT INTO matches (date, team_a_id, team_b_id) VALUES ($1, $2, $3) RETURNING *', [date, a, b]
  );
  res.json(match);
});

app.delete('/api/matches/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
  const { rows: [match] } = await pool.query('SELECT * FROM matches WHERE id = $1', [id]);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  await pool.query('DELETE FROM matches WHERE id = $1', [id]);
  res.json({ ok: true });
});

// Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Start server after DB init ---
init().then(() => {
  app.listen(PORT, () => {
    console.log(`Carrom tournament running on http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// Keep server alive on unexpected errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

// Export for Vercel serverless
module.exports = app;
