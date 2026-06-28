import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type BindParams = Record<string, string | number | null>;
export type AppDatabase = DatabaseSync & {
  run(sql: string, params?: BindParams): void;
};

export async function createDatabase(filename = process.env.MUSIC_DB_PATH ?? "data/music.sqlite") {
  if (filename !== ":memory:") {
    mkdirSync(dirname(filename), { recursive: true });
  }
  const db = new DatabaseSync(filename) as AppDatabase;
  db.run = (sql: string, params?: BindParams) => {
    if (params) {
      db.prepare(sql).run(params);
      return;
    }
    db.exec(sql);
  };
  return db;
}
