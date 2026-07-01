import type { AppDatabase } from "./client";

export function migrate(db: AppDatabase) {
  db.run(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      netease_user_id TEXT,
      nickname TEXT,
      avatar_url TEXT,
      encrypted_cookie TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      netease_song_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      artist_names TEXT NOT NULL,
      artist_ids_json TEXT NOT NULL,
      album_name TEXT,
      album_id TEXT,
      cover_url TEXT,
      stream_url TEXT,
      duration_ms INTEGER,
      popularity INTEGER,
      sources_json TEXT NOT NULL DEFAULT '[]',
      tags_json TEXT NOT NULL DEFAULT '[]',
      recent_play_count INTEGER NOT NULL DEFAULT 0,
      days_since_last_played INTEGER,
      raw_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      netease_playlist_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      cover_url TEXT,
      creator_name TEXT,
      source_type TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS playlist_songs (
      playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      added_at TEXT,
      PRIMARY KEY (playlist_id, song_id)
    );

    CREATE TABLE IF NOT EXISTS song_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      source TEXT NOT NULL,
      context_text TEXT,
      weight REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS recommendation_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt TEXT NOT NULL,
      parsed_context_json TEXT NOT NULL,
      strategy_json TEXT NOT NULL,
      overall_rating TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS recommendation_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES recommendation_sessions(id) ON DELETE CASCADE,
      song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      rank INTEGER NOT NULL,
      score REAL NOT NULL,
      source TEXT NOT NULL,
      reason TEXT NOT NULL,
      score_breakdown_json TEXT NOT NULL,
      feedback TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS library_syncs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_type TEXT NOT NULL,
      songs_imported INTEGER NOT NULL,
      partial_failures_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_login_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      encrypted_cookie TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL,
      last_verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, provider)
    );

    CREATE TABLE IF NOT EXISTS user_song_sources (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, song_id, source)
    );

    CREATE TABLE IF NOT EXISTS user_song_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      source TEXT NOT NULL,
      context_text TEXT,
      weight REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      profile_json TEXT NOT NULL,
      compact_summary TEXT NOT NULL,
      confidence REAL NOT NULL,
      last_refreshed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tagging_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(song_id)
    );

    CREATE INDEX IF NOT EXISTS idx_user_song_sources_user_id ON user_song_sources(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_song_events_user_id ON user_song_events(user_id);
    CREATE INDEX IF NOT EXISTS idx_tagging_jobs_status ON tagging_jobs(status);
  `);
  addColumnIfMissing(db, "users", "handle", "TEXT");
  addColumnIfMissing(db, "recommendation_sessions", "user_id", "INTEGER REFERENCES users(id) ON DELETE CASCADE");
  addColumnIfMissing(db, "tagging_jobs", "next_attempt_at", "TEXT");
  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_handle ON users(handle);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_netease_user_id ON users(netease_user_id) WHERE netease_user_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_recommendation_sessions_user_id ON recommendation_sessions(user_id);

    INSERT OR IGNORE INTO users (id, handle, nickname)
    VALUES (1, 'owner', 'Owner');

    UPDATE recommendation_sessions SET user_id = 1 WHERE user_id IS NULL;
  `);
}

function addColumnIfMissing(db: AppDatabase, tableName: string, columnName: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) return;
  db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}
