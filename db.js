const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function init() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        player1 TEXT NOT NULL,
        player2 TEXT NOT NULL,
        points INTEGER DEFAULT 0,
        penalties INTEGER DEFAULT 0,
        played INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS matches (
        id SERIAL PRIMARY KEY,
        date TEXT NOT NULL,
        team_a_id INTEGER REFERENCES teams(id),
        team_b_id INTEGER REFERENCES teams(id),
        score_a INTEGER DEFAULT 0,
        score_b INTEGER DEFAULT 0,
        penalty_a INTEGER DEFAULT 0,
        penalty_b INTEGER DEFAULT 0,
        status TEXT DEFAULT 'upcoming'
      );

      CREATE TABLE IF NOT EXISTS admin_session (
        token TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    const { rows } = await client.query('SELECT COUNT(*) AS c FROM teams');
    if (parseInt(rows[0].c) === 0) {
      const seed = [
        ['Team 1', 'Sameer Kamble', 'Jayesh Shivaji Sutar'],
        ['Team 2', 'Viresh Navtake', 'Aditya Deshpande'],
        ['Team 3', 'Ravindra Kumar Gurung', 'Aditya Tiwari'],
        ['Team 4', 'Sachin Shivaji Mardane', 'Hari Patnam'],
        ['Team 5', 'Sagar Shinde', 'Manisha Sabaji Shelke'],
        ['Team 6', 'Nipun Shah', 'Datta'],
        ['Team 7', 'Anand Fulkari', 'Girish Udeg'],
        ['Team 8', 'Shashikant Badgujar', 'Milind Anand'],
        ['Team 9', 'Shubham Bagal', 'Prashant Patel'],
        ['Team 10', 'Tejashri', 'Varsha'],
        ['Team 11', 'Mandar Lokhande', 'Esha Pandey'],
        ['Team 12', 'Atul Mogal', 'Prashant Datir'],
        ['Team 13', 'Mayur Chaudhary', 'Manushree Bihade'],
        ['Team 14', 'Shrinath', 'Kumar Shubham'],
      ];
      for (const [name, p1, p2] of seed) {
        await client.query(
          'INSERT INTO teams (name, player1, player2, points, penalties, played) VALUES ($1, $2, $3, 0, 0, 0)',
          [name, p1, p2]
        );
      }
    }
  } finally {
    client.release();
  }
}

module.exports = { pool, init };
