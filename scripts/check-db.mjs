import { createDatabase } from "../src/lib/db/client.ts";
import { migrate } from "../src/lib/db/schema.ts";

const dbPath = process.env.MUSIC_DB_PATH?.trim() || "data/music.sqlite";
const requiredTables = [
  "users",
  "songs",
  "user_login_states",
  "user_song_sources",
  "recommendation_sessions",
  "tagging_jobs",
  "user_profiles"
];

const db = await createDatabase(dbPath);
migrate(db);

const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
const names = new Set(rows.map((row) => row.name));
const missing = requiredTables.filter((table) => !names.has(table));

db.close();

if (missing.length) {
  console.error(`Database check failed. Missing tables: ${missing.join(", ")}`);
  process.exit(1);
}

console.log(`Database check passed: ${dbPath}`);
