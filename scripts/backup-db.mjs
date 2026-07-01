import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";

const dbPath = process.env.MUSIC_DB_PATH?.trim() || "data/music.sqlite";
const backupDir = process.env.MUSIC_DB_BACKUP_DIR?.trim() || "backups";

if (dbPath === ":memory:" || !existsSync(dbPath)) {
  console.error(`Database file does not exist and cannot be backed up: ${dbPath}`);
  process.exit(1);
}

mkdirSync(backupDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = join(backupDir, `${basename(dbPath)}.${timestamp}.bak`);

copyFileSync(dbPath, target);

console.log(`Database backup written: ${target}`);
