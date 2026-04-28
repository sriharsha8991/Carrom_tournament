# Carrom Tournament Leaderboard

A small full-stack app for tracking the DatasmithAI & ParallelMinds carrom league.

- **Backend:** Node.js + Express + better-sqlite3
- **Frontend:** Plain HTML / CSS / Vanilla JS (served by Express)
- **Auth:** Single admin password via cookie session (24h expiry)

## Run

```bash
npm install
cp .env.example .env      # then set ADMIN_PASSWORD
node server.js            # http://localhost:3000
```

The SQLite file (`data.sqlite`) is created automatically on first run and seeded with all 14 teams.

## Features

- Public leaderboard, matches, and teams views (read-only).
- Admin login (lock icon in nav) unlocks inline editing:
  - Override team points / penalties / played.
  - Schedule new matches.
  - Enter or edit match results (penalties only allowed on ties).
  - Delete matches — completed matches reverse their points/penalties on delete.
- Live polling every 10s and refresh on tab focus.
- Tie indicator badges and gold/silver/bronze rank styling.

## Business rules

- **Points** are summed directly from match results.
- **Penalties** apply only when scores are tied; the API zeroes them otherwise.
- Leaderboard sort: `points DESC, penalties DESC` (higher penalties = worse tiebreaker).
- Teams sharing the same `points` AND `penalties` share a rank number.
- Any team sharing a `points` value with another team gets a `TIE` badge.

## Security

- Prepared statements everywhere — no string interpolation in SQL.
- Cookies are `httpOnly` + `sameSite=lax`.
- Admin sessions expire after 24h; expired tokens are pruned on each request.
- `.env` is gitignored.
