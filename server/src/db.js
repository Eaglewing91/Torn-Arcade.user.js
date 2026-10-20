// Postgres: the connection pool and the tables. The tables are created on start-up if they don't exist yet.
'use strict';
const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }
const local = /localhost|127\.0\.0\.1|\.railway\.internal/.test(url);
const pool = new Pool({ connectionString: url, max: 10, ssl: local ? false : { rejectUnauthorized: false } });
pool.on('error', function (e) { console.error('db pool error', e.message); });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id          BIGSERIAL PRIMARY KEY,
  torn_id     INTEGER UNIQUE,                 -- set once the player has verified with a Torn API key
  name        TEXT NOT NULL,
  verified    BOOLEAN NOT NULL DEFAULT FALSE,
  banned      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tokens (
  hash        BYTEA PRIMARY KEY,               -- SHA-256 of the sign-in token; the token itself is never stored
  account_id  BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tokens_account ON tokens(account_id);
CREATE TABLE IF NOT EXISTS ratings (
  account_id  BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  game        TEXT NOT NULL,
  rating      INTEGER NOT NULL DEFAULT 1200,
  games       INTEGER NOT NULL DEFAULT 0,
  wins        INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, game)
);
CREATE INDEX IF NOT EXISTS ratings_board ON ratings(game, rating DESC);
CREATE TABLE IF NOT EXISTS scores (
  account_id  BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  board       TEXT NOT NULL,                   -- e.g. 'flappy:hard', 'defence:3', 'tornies:caught'
  value       DOUBLE PRECISION NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, board)
);
CREATE INDEX IF NOT EXISTS scores_board ON scores(board, value);
`;

async function migrate() { await pool.query(SCHEMA); }
function q(text, params) { return pool.query(text, params); }

module.exports = { pool, q, migrate };
