import type { AppDatabase, BindParams } from "@/lib/db/client";
import type { Feedback, RecommendationItemRecord } from "@/lib/db/types";

type SessionInput = {
  prompt: string;
  parsedContext: unknown;
  strategy: unknown;
};

type ItemInput = {
  sessionId: number;
  songId: number;
  rank: number;
  score: number;
  source: string;
  reason: string;
  scoreBreakdown: Record<string, number>;
};

type ItemRow = {
  id: number;
  session_id: number;
  song_id: number;
  rank: number;
  score: number;
  source: string;
  reason: string;
  score_breakdown_json: string;
  feedback: Feedback | null;
};

export class RecommendationRepository {
  constructor(private readonly db: AppDatabase) {}

  createSession(input: SessionInput): number {
    this.db.run(
      `
        INSERT INTO recommendation_sessions (prompt, parsed_context_json, strategy_json)
        VALUES ($prompt, $parsedContextJson, $strategyJson)
      `,
      {
        $prompt: input.prompt,
        $parsedContextJson: JSON.stringify(input.parsedContext),
        $strategyJson: JSON.stringify(input.strategy)
      }
    );
    return this.lastInsertId();
  }

  addItem(input: ItemInput): number {
    this.db.run(
      `
        INSERT INTO recommendation_items (
          session_id, song_id, rank, score, source, reason, score_breakdown_json
        )
        VALUES ($sessionId, $songId, $rank, $score, $source, $reason, $scoreBreakdownJson)
      `,
      {
        $sessionId: input.sessionId,
        $songId: input.songId,
        $rank: input.rank,
        $score: input.score,
        $source: input.source,
        $reason: input.reason,
        $scoreBreakdownJson: JSON.stringify(input.scoreBreakdown)
      }
    );
    return this.lastInsertId();
  }

  setFeedback(itemId: number, feedback: Feedback): void {
    this.db.run("UPDATE recommendation_items SET feedback = $feedback WHERE id = $itemId", {
      $feedback: feedback,
      $itemId: itemId
    });
  }

  getSessionWithItems(sessionId: number) {
    const session = this.getFirst("SELECT * FROM recommendation_sessions WHERE id = $sessionId", { $sessionId: sessionId });
    if (!session) return null;
    const rows = this.getAll<ItemRow>("SELECT * FROM recommendation_items WHERE session_id = $sessionId ORDER BY rank", {
      $sessionId: sessionId
    });
    const items: RecommendationItemRecord[] = rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      songId: row.song_id,
      rank: row.rank,
      score: row.score,
      source: row.source,
      reason: row.reason,
      scoreBreakdown: JSON.parse(row.score_breakdown_json) as Record<string, number>,
      feedback: row.feedback
    }));
    return { session, items };
  }

  private lastInsertId(): number {
    return this.getFirst<{ id: number }>("SELECT last_insert_rowid() AS id")?.id ?? 0;
  }

  private getFirst<T>(sql: string, params?: BindParams): T | undefined {
    return this.getAll<T>(sql, params)[0];
  }

  private getAll<T>(sql: string, params?: BindParams): T[] {
    const stmt = this.db.prepare(sql);
    return stmt.all(params ?? {}) as T[];
  }
}
