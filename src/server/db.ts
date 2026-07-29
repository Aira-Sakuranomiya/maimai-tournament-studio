import Database from 'better-sqlite3'
import path from 'node:path'
import { DATA_DIR } from './config.js'

export type Db = Database.Database

export function createDatabase(filename = path.join(DATA_DIR, 'maimai-studio.db')): Db {
  const db = new Database(filename)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      avatar_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS tournaments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      bracket_size INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'setup',
      mode TEXT NOT NULL DEFAULT 'bracket',
      team1_name TEXT NOT NULL DEFAULT '黄队',
      team1_color TEXT NOT NULL DEFAULT '#f5c84c',
      team2_name TEXT NOT NULL DEFAULT '绿队',
      team2_color TEXT NOT NULL DEFAULT '#55d68b',
      current_match_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS tournament_participants (
      tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id),
      name_snapshot TEXT NOT NULL,
      avatar_snapshot TEXT,
      PRIMARY KEY (tournament_id, player_id)
    );
    CREATE TABLE IF NOT EXISTS bracket_slots (
      tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      slot_index INTEGER NOT NULL,
      player_id INTEGER REFERENCES players(id),
      PRIMARY KEY (tournament_id, slot_index)
    );
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      round_index INTEGER NOT NULL,
      match_index INTEGER NOT NULL,
      player1_id INTEGER REFERENCES players(id),
      player2_id INTEGER REFERENCES players(id),
      winner_id INTEGER REFERENCES players(id),
      status TEXT NOT NULL DEFAULT 'locked',
      total1 INTEGER,
      total2 INTEGER,
      manual_winner INTEGER NOT NULL DEFAULT 0,
      manual_pairing INTEGER NOT NULL DEFAULT 0,
      is_tiebreak INTEGER NOT NULL DEFAULT 0,
      UNIQUE (tournament_id, round_index, match_index)
    );
    CREATE TABLE IF NOT EXISTS team_members (
      tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      team_number INTEGER NOT NULL,
      player_id INTEGER NOT NULL REFERENCES players(id),
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (tournament_id, player_id)
    );
    CREATE TABLE IF NOT EXISTS match_songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      song_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      jacket_url TEXT NOT NULL,
      chart_type TEXT NOT NULL,
      level_index INTEGER NOT NULL,
      level TEXT NOT NULL,
      source TEXT NOT NULL,
      UNIQUE (match_id, position)
    );
    CREATE TABLE IF NOT EXISTS scores (
      match_song_id INTEGER NOT NULL REFERENCES match_songs(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id),
      achievement_scaled INTEGER NOT NULL,
      PRIMARY KEY (match_song_id, player_id)
    );
    CREATE TABLE IF NOT EXISTS song_cache (
      song_id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      genre TEXT NOT NULL,
      aliases TEXT NOT NULL DEFAULT '[]',
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS broadcast_states (
      channel TEXT PRIMARY KEY,
      draft_json TEXT,
      published_json TEXT,
      revision INTEGER NOT NULL DEFAULT 0
    );
  `)
  const matchColumns = db.pragma('table_info(matches)') as Array<{ name: string }>
  if (!matchColumns.some((column) => column.name === 'manual_pairing')) {
    db.exec('ALTER TABLE matches ADD COLUMN manual_pairing INTEGER NOT NULL DEFAULT 0')
  }
  if (!matchColumns.some((column) => column.name === 'is_tiebreak')) {
    db.exec('ALTER TABLE matches ADD COLUMN is_tiebreak INTEGER NOT NULL DEFAULT 0')
  }
  const tournamentColumns = db.pragma('table_info(tournaments)') as Array<{ name: string }>
  const tournamentMigrations = [
    ['mode', "TEXT NOT NULL DEFAULT 'bracket'"],
    ['team1_name', "TEXT NOT NULL DEFAULT '黄队'"],
    ['team1_color', "TEXT NOT NULL DEFAULT '#f5c84c'"],
    ['team2_name', "TEXT NOT NULL DEFAULT '绿队'"],
    ['team2_color', "TEXT NOT NULL DEFAULT '#55d68b'"],
    ['current_match_id', 'INTEGER']
  ] as const
  for (const [name, definition] of tournamentMigrations) {
    if (!tournamentColumns.some((column) => column.name === name)) {
      db.exec(`ALTER TABLE tournaments ADD COLUMN ${name} ${definition}`)
    }
  }
  for (const channel of ['match', 'songs', 'results', 'bracket']) {
    db.prepare('INSERT OR IGNORE INTO broadcast_states(channel) VALUES (?)').run(channel)
  }
  return db
}

export function nextPowerOfTwo(value: number): number {
  if (value < 2) return 2
  return 2 ** Math.ceil(Math.log2(value))
}
