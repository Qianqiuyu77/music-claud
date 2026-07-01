import type { AppDatabase, BindParams } from "@/lib/db/client";

export type UserProfileRecord = {
  userId: number;
  profileJson: Record<string, unknown>;
  compactSummary: string;
  confidence: number;
  lastRefreshedAt?: string | null;
};

type UserProfileRow = {
  user_id: number;
  profile_json: string;
  compact_summary: string;
  confidence: number;
  last_refreshed_at: string | null;
};

export class UserProfileRepository {
  constructor(private readonly db: AppDatabase) {}

  save(profile: UserProfileRecord) {
    this.db.run(
      `
        INSERT INTO user_profiles (user_id, profile_json, compact_summary, confidence, last_refreshed_at)
        VALUES ($userId, $profileJson, $compactSummary, $confidence, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
          profile_json = excluded.profile_json,
          compact_summary = excluded.compact_summary,
          confidence = excluded.confidence,
          last_refreshed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      `,
      {
        $userId: profile.userId,
        $profileJson: JSON.stringify(profile.profileJson),
        $compactSummary: profile.compactSummary,
        $confidence: profile.confidence
      }
    );
  }

  getByUserId(userId: number): UserProfileRecord | null {
    const row = this.getFirst<UserProfileRow>("SELECT * FROM user_profiles WHERE user_id = $userId", { $userId: userId });
    if (!row) return null;
    return {
      userId: row.user_id,
      profileJson: parseJsonObject(row.profile_json),
      compactSummary: row.compact_summary,
      confidence: row.confidence,
      lastRefreshedAt: row.last_refreshed_at
    };
  }

  private getFirst<T>(sql: string, params?: BindParams): T | undefined {
    const stmt = this.db.prepare(sql);
    return stmt.get(params ?? {}) as T | undefined;
  }
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
