const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      player1 TEXT NOT NULL,
      player2 TEXT NOT NULL,
      points INTEGER DEFAULT 0,
      penalties INTEGER DEFAULT 0,
      played INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const count = db.prepare('SELECT COUNT(*) AS c FROM teams').get().c;
  if (count === 0) {
    const seed = db.prepare(
      'INSERT INTO teams (name, player1, player2, points, penalties, played) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const rows = [
      ['Team 1', 'Sameer Kamble', 'Jayesh Shivaji Sutar', 0, 0, 0],
      ['Team 2', 'Viresh Navtake', 'Aditya Deshpande', 0, 0, 0],
      ['Team 3', 'Ravindra Kumar Gurung', 'Aditya Tiwari', 9, 0, 0],
      ['Team 4', 'Sachin Shivaji Mardane', 'Hari Patnam', 5, 0, 1],
      ['Team 5', 'Sagar Shinde', 'Manisha Sabaji Shelke', 0, 0, 0],
      ['Team 6', 'Nipun Shah', 'Datta', -1, -2, 1],
      ['Team 7', 'Anand Fulkari', 'Girish Udeg', 0, 0, 0],
      ['Team 8', 'Shashikant Badgujar', 'Milind Anand', 0, 1, 1],
      ['Team 9', 'Shubham Bagal', 'Prashant Patel', 0, 0, 0],
      ['Team 10', 'Tejashri', 'Varsha', 0, 0, 0],
      ['Team 11', 'Mandar Lokhande', 'Esha Pandey', 9, 0, 1],
      ['Team 12', 'Atul Mogal', 'Prashant Datir', 1, 0, 1],
      ['Team 13', 'Mayur Chaudhary', 'Manushree Bihade', 0, 0, 0],
      ['Team 14', 'Shrinath', 'Kumar Shubham', 0, 0, 0],
    ];
    const insertMany = db.transaction((items) => {
      for (const r of items) seed.run(...r);
    });
    insertMany(rows);
  }
}

init();

module.exports = db;
