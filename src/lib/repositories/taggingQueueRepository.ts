import type { AppDatabase, BindParams } from "@/lib/db/client";

type SongTagRow = {
  id: number;
  tags_json: string;
};

export type TaggingJobRecord = {
  id: number;
  songId: number;
  reason: string;
  status: "pending" | "processing" | "done" | "failed";
  attempts: number;
};

type RetryOptions = {
  maxAttempts?: number;
  retryDelaySeconds?: number;
};

export class TaggingQueueRepository {
  constructor(private readonly db: AppDatabase) {}

  enqueueMissingTags(songIds: number[], reason: string) {
    let inserted = 0;
    let skipped = 0;
    for (const songId of uniqueIds(songIds)) {
      const song = this.getFirst<SongTagRow>("SELECT id, tags_json FROM songs WHERE id = $songId", { $songId: songId });
      if (!song || hasAiTaggedMarker(parseJsonArray(song.tags_json))) {
        skipped += 1;
        continue;
      }
      this.db.run(
        `
          INSERT OR IGNORE INTO tagging_jobs (song_id, reason, status)
          VALUES ($songId, $reason, 'pending')
        `,
        { $songId: song.id, $reason: reason }
      );
      const changes = this.getFirst<{ changes: number }>("SELECT changes() AS changes")?.changes ?? 0;
      if (changes > 0) inserted += 1;
      else skipped += 1;
    }
    return { inserted, skipped };
  }

  listPending(): TaggingJobRecord[] {
    const rows = this.getAll<{
      id: number;
      song_id: number;
      reason: string;
      status: TaggingJobRecord["status"];
      attempts: number;
    }>(
      `
        SELECT id, song_id, reason, status, attempts
        FROM tagging_jobs
        WHERE status = 'pending'
          AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
        ORDER BY id
      `
    );
    return rows.map(rowToRecord);
  }

  claimPending(limit: number): TaggingJobRecord[] {
    const jobs = this.listPending().slice(0, Math.max(0, Math.floor(limit)));
    for (const job of jobs) {
      this.db.run(
        `
          UPDATE tagging_jobs
          SET status = 'processing',
              attempts = attempts + 1,
              next_attempt_at = NULL,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $jobId AND status = 'pending'
        `,
        { $jobId: job.id }
      );
    }
    return jobs.length ? this.getJobsByIds(jobs.map((job) => job.id)) : [];
  }

  markDone(jobId: number) {
    this.db.run("UPDATE tagging_jobs SET status = 'done', next_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $jobId", { $jobId: jobId });
  }

  markFailed(jobId: number, options: RetryOptions = {}) {
    const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 1));
    const retryDelaySeconds = Math.max(0, Math.floor(options.retryDelaySeconds ?? 0));
    const job = this.getFirst<{ attempts: number }>("SELECT attempts FROM tagging_jobs WHERE id = $jobId", { $jobId: jobId });
    if (job && job.attempts < maxAttempts) {
      this.db.run(
        `
          UPDATE tagging_jobs
          SET status = 'pending',
              next_attempt_at = datetime(CURRENT_TIMESTAMP, '+' || $retryDelaySeconds || ' seconds'),
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $jobId
        `,
        { $jobId: jobId, $retryDelaySeconds: retryDelaySeconds }
      );
      return;
    }
    this.db.run("UPDATE tagging_jobs SET status = 'failed', next_attempt_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $jobId", { $jobId: jobId });
  }

  listByStatus(status: TaggingJobRecord["status"]): TaggingJobRecord[] {
    const rows = this.getAll<{
      id: number;
      song_id: number;
      reason: string;
      status: TaggingJobRecord["status"];
      attempts: number;
    }>("SELECT id, song_id, reason, status, attempts FROM tagging_jobs WHERE status = $status ORDER BY id", { $status: status });
    return rows.map(rowToRecord);
  }

  getCounts() {
    const rows = this.getAll<{ status: TaggingJobRecord["status"]; count: number }>(
      "SELECT status, COUNT(*) AS count FROM tagging_jobs GROUP BY status"
    );
    const counts = { pending: 0, processing: 0, done: 0, failed: 0 };
    for (const row of rows) counts[row.status] = row.count;
    return counts;
  }

  listRecent(limit: number): TaggingJobRecord[] {
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
    const rows = this.getAll<{
      id: number;
      song_id: number;
      reason: string;
      status: TaggingJobRecord["status"];
      attempts: number;
    }>("SELECT id, song_id, reason, status, attempts FROM tagging_jobs ORDER BY updated_at DESC, id DESC LIMIT $limit", { $limit: safeLimit });
    return rows.map(rowToRecord);
  }

  private getJobsByIds(jobIds: number[]): TaggingJobRecord[] {
    if (!jobIds.length) return [];
    const placeholders = jobIds.map((_, index) => `$id${index}`).join(", ");
    const params = Object.fromEntries(jobIds.map((id, index) => [`$id${index}`, id]));
    const rows = this.getAll<{
      id: number;
      song_id: number;
      reason: string;
      status: TaggingJobRecord["status"];
      attempts: number;
    }>(`SELECT id, song_id, reason, status, attempts FROM tagging_jobs WHERE id IN (${placeholders}) ORDER BY id`, params);
    return rows.map(rowToRecord);
  }

  private getFirst<T>(sql: string, params?: BindParams): T | undefined {
    return this.getAll<T>(sql, params)[0];
  }

  private getAll<T>(sql: string, params?: BindParams): T[] {
    const stmt = this.db.prepare(sql);
    return stmt.all(params ?? {}) as T[];
  }
}

function rowToRecord(row: {
  id: number;
  song_id: number;
  reason: string;
  status: TaggingJobRecord["status"];
  attempts: number;
}): TaggingJobRecord {
  return {
    id: row.id,
    songId: row.song_id,
    reason: row.reason,
    status: row.status,
    attempts: row.attempts
  };
}

function uniqueIds(ids: number[]) {
  return Array.from(new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0)));
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function hasAiTaggedMarker(tags: string[]) {
  return tags.includes("ai:tagged") || tags.includes("ai_tagged");
}
