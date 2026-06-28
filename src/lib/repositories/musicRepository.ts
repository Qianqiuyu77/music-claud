import type { AppDatabase, BindParams } from "@/lib/db/client";
import type { Feedback, SongEventInput, SongInput } from "@/lib/db/types";
import type { CandidateSong, CandidateSourceName } from "@/lib/recommendation/types";

type SongRow = {
  id: number;
  netease_song_id: string;
  name: string;
  artist_names: string;
  artist_ids_json: string;
  album_name: string | null;
  album_id: string | null;
  cover_url: string | null;
  stream_url: string | null;
  duration_ms: number | null;
  popularity: number | null;
  sources_json: string;
  tags_json: string;
  recent_play_count: number;
  days_since_last_played: number | null;
  raw_json: string;
  created_at: string;
  updated_at: string;
};

type FeedbackRow = {
  song_id: number;
  context_text: string | null;
};

type PlaybackRow = {
  netease_song_id: string;
  context_text: string | null;
  created_at: string;
};

export type LatestPlayback = {
  itemId: string;
  playedSeconds: number;
  durationSeconds: number | null;
  completed: boolean;
  createdAt: string;
};

type SyncRow = {
  sync_type: string;
  songs_imported: number;
  partial_failures_json: string;
  created_at: string;
};

export class MusicRepository {
  constructor(private readonly db: AppDatabase) {}

  upsertSong(input: SongInput): number {
    const existing = this.getFirst<SongRow>("SELECT * FROM songs WHERE netease_song_id = $id", { $id: input.neteaseSongId });
    const sources = unique([...(parseJsonArray(existing?.sources_json) as string[]), ...(input.sources ?? [])]);
    const tags = unique([...(parseJsonArray(existing?.tags_json) as string[]), ...(input.tags ?? [])]);
    const recentPlayCount = Math.max(existing?.recent_play_count ?? 0, input.recentPlayCount ?? 0);
    const daysSinceLastPlayed = minNullable(existing?.days_since_last_played ?? null, input.daysSinceLastPlayed ?? null);

    this.db.run(
      `
        INSERT INTO songs (
          netease_song_id, name, artist_names, artist_ids_json, album_name, album_id,
          cover_url, stream_url, duration_ms, popularity, sources_json, tags_json,
          recent_play_count, days_since_last_played, raw_json
        )
        VALUES ($neteaseSongId, $name, $artistNames, $artistIdsJson, $albumName, $albumId,
          $coverUrl, $streamUrl, $durationMs, $popularity, $sourcesJson, $tagsJson,
          $recentPlayCount, $daysSinceLastPlayed, $rawJson)
        ON CONFLICT(netease_song_id) DO UPDATE SET
          name = excluded.name,
          artist_names = excluded.artist_names,
          artist_ids_json = excluded.artist_ids_json,
          album_name = excluded.album_name,
          album_id = excluded.album_id,
          cover_url = excluded.cover_url,
          stream_url = excluded.stream_url,
          duration_ms = excluded.duration_ms,
          popularity = excluded.popularity,
          sources_json = excluded.sources_json,
          tags_json = excluded.tags_json,
          recent_play_count = excluded.recent_play_count,
          days_since_last_played = excluded.days_since_last_played,
          raw_json = excluded.raw_json,
          updated_at = CURRENT_TIMESTAMP
      `,
      {
        $neteaseSongId: input.neteaseSongId,
        $name: input.name,
        $artistNames: input.artistNames.join(", "),
        $artistIdsJson: JSON.stringify(input.artistIds),
        $albumName: input.albumName,
        $albumId: input.albumId,
        $coverUrl: input.coverUrl,
        $streamUrl: input.streamUrl ?? existing?.stream_url ?? null,
        $durationMs: input.durationMs,
        $popularity: input.popularity,
        $sourcesJson: JSON.stringify(sources),
        $tagsJson: JSON.stringify(tags),
        $recentPlayCount: recentPlayCount,
        $daysSinceLastPlayed: daysSinceLastPlayed,
        $rawJson: JSON.stringify(input.raw)
      }
    );
    const row = this.getFirst<{ id: number }>("SELECT id FROM songs WHERE netease_song_id = $id", { $id: input.neteaseSongId });
    if (!row) throw new Error(`Song not found after upsert: ${input.neteaseSongId}`);
    return row.id;
  }

  upsertCandidateSong(song: CandidateSong): number {
    return this.upsertSong({
      neteaseSongId: song.neteaseSongId,
      name: song.name,
      artistNames: song.artistNames,
      artistIds: song.artistIds ?? [],
      albumName: song.albumName,
      albumId: null,
      coverUrl: song.coverUrl,
      streamUrl: song.streamUrl ?? null,
      durationMs: song.durationMs,
      popularity: song.popularity,
      sources: song.sources,
      tags: song.tags,
      recentPlayCount: song.recentPlayCount,
      daysSinceLastPlayed: song.daysSinceLastPlayed,
      raw: song
    });
  }

  upsertCandidateSongs(songs: CandidateSong[]) {
    for (const song of songs) {
      this.upsertCandidateSong(song);
    }
  }

  replaceCandidateSongTags(song: CandidateSong): number {
    this.db.run(
      `
        UPDATE songs
        SET tags_json = $tagsJson,
            raw_json = $rawJson,
            updated_at = CURRENT_TIMESTAMP
        WHERE netease_song_id = $neteaseSongId
      `,
      {
        $neteaseSongId: song.neteaseSongId,
        $tagsJson: JSON.stringify(unique(song.tags)),
        $rawJson: JSON.stringify(song)
      }
    );
    const row = this.getFirst<{ changes: number }>("SELECT changes() AS changes");
    return row?.changes ?? 0;
  }

  listSongs(): SongRow[] {
    return this.getAll<SongRow>("SELECT * FROM songs ORDER BY id");
  }

  listCandidateSongs(): CandidateSong[] {
    const rows = this.listSongs();
    const feedbackBySongId = this.feedbackBySongId();
    return rows.map((row) => ({
      neteaseSongId: row.netease_song_id,
      name: row.name,
      artistNames: row.artist_names ? row.artist_names.split(", ").filter(Boolean) : [],
      artistIds: parseJsonArray(row.artist_ids_json) as string[],
      albumName: row.album_name,
      coverUrl: row.cover_url,
      streamUrl: row.stream_url,
      durationMs: row.duration_ms,
      popularity: row.popularity,
      sources: normalizeSources(parseJsonArray(row.sources_json)),
      tags: parseJsonArray(row.tags_json) as string[],
      recentPlayCount: row.recent_play_count,
      daysSinceLastPlayed: row.days_since_last_played,
      feedback: feedbackBySongId.get(row.id) ?? []
    }));
  }

  addSongEvent(input: SongEventInput): number {
    this.db.run(
      `
        INSERT INTO song_events (song_id, event_type, source, context_text, weight)
        VALUES ($songId, $eventType, $source, $contextText, $weight)
      `,
      {
        $songId: input.songId,
        $eventType: input.eventType,
        $source: input.source,
        $contextText: input.contextText,
        $weight: input.weight
      }
    );
    const row = this.getFirst<{ id: number }>("SELECT last_insert_rowid() AS id");
    return row?.id ?? 0;
  }

  recordFeedbackByNeteaseSongId(neteaseSongId: string, feedback: Feedback) {
    const row = this.getFirst<{ id: number }>("SELECT id FROM songs WHERE netease_song_id = $id", { $id: neteaseSongId });
    if (!row) return null;
    this.addSongEvent({
      songId: row.id,
      eventType: "feedback",
      source: "local",
      contextText: feedback,
      weight: feedback === "dislike" || feedback === "too_familiar" ? -1 : 1
    });
    return {
      itemId: neteaseSongId,
      feedback
    };
  }

  recordPlaybackByNeteaseSongId(
    neteaseSongId: string,
    playback: { playedSeconds: number; durationSeconds: number | null; completed: boolean }
  ) {
    const row = this.getFirst<{ id: number }>("SELECT id FROM songs WHERE netease_song_id = $id", { $id: neteaseSongId });
    if (!row) return null;

    this.addSongEvent({
      songId: row.id,
      eventType: "played",
      source: "local",
      contextText: JSON.stringify(playback),
      weight: playback.completed ? 1 : 0.5
    });
    this.db.run(
      `
        UPDATE songs
        SET recent_play_count = recent_play_count + 1,
            days_since_last_played = 0,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $id
      `,
      { $id: row.id }
    );

    return {
      itemId: neteaseSongId,
      playback
    };
  }

  listLatestPlaybackByNeteaseSongIds(neteaseSongIds: string[]) {
    const ids = unique(neteaseSongIds.filter(Boolean));
    const result = new Map<string, LatestPlayback>();
    if (!ids.length) return result;

    const placeholders = ids.map((_, index) => `$id${index}`).join(", ");
    const params = Object.fromEntries(ids.map((id, index) => [`$id${index}`, id]));
    const rows = this.getAll<PlaybackRow>(
      `
        SELECT s.netease_song_id, e.context_text, e.created_at
        FROM song_events e
        JOIN songs s ON s.id = e.song_id
        WHERE e.event_type = 'played'
          AND s.netease_song_id IN (${placeholders})
        ORDER BY e.created_at DESC, e.id DESC
      `,
      params
    );

    for (const row of rows) {
      if (result.has(row.netease_song_id)) continue;
      const parsed = parsePlaybackContext(row.context_text);
      result.set(row.netease_song_id, {
        itemId: row.netease_song_id,
        ...parsed,
        createdAt: row.created_at
      });
    }

    return result;
  }

  recordSync(syncType: string, songsImported: number, partialFailures: string[]) {
    this.db.run(
      `
        INSERT INTO library_syncs (sync_type, songs_imported, partial_failures_json)
        VALUES ($syncType, $songsImported, $partialFailuresJson)
      `,
      {
        $syncType: syncType,
        $songsImported: songsImported,
        $partialFailuresJson: JSON.stringify(partialFailures)
      }
    );
  }

  getLastSync() {
    const row = this.getFirst<SyncRow>("SELECT * FROM library_syncs ORDER BY id DESC LIMIT 1");
    if (!row) return null;
    return {
      type: row.sync_type,
      songsImported: row.songs_imported,
      partialFailures: parseJsonArray(row.partial_failures_json) as string[],
      createdAt: row.created_at
    };
  }

  getLibraryStats() {
    const row = this.getFirst<{ songs: number; playable_songs: number }>(
      "SELECT COUNT(*) AS songs, SUM(CASE WHEN stream_url IS NOT NULL AND stream_url != '' THEN 1 ELSE 0 END) AS playable_songs FROM songs"
    );
    const lastSync = this.getLastSync();
    return {
      songs: row?.songs ?? 0,
      playableSongs: row?.playable_songs ?? 0,
      lastSyncAt: lastSync?.createdAt ?? null,
      lastSyncType: lastSync?.type ?? null
    };
  }

  listEventsForSong(songId: number) {
    return this.getAll("SELECT * FROM song_events WHERE song_id = $songId ORDER BY id", { $songId: songId });
  }

  private feedbackBySongId() {
    const rows = this.getAll<FeedbackRow>(
      "SELECT song_id, context_text FROM song_events WHERE event_type = 'feedback' AND context_text IS NOT NULL ORDER BY id"
    );
    const bySongId = new Map<number, Feedback[]>();
    for (const row of rows) {
      if (!isFeedback(row.context_text)) continue;
      bySongId.set(row.song_id, unique([...(bySongId.get(row.song_id) ?? []), row.context_text]));
    }
    return bySongId;
  }

  private getFirst<T>(sql: string, params?: BindParams): T | undefined {
    return this.getAll<T>(sql, params)[0];
  }

  private getAll<T>(sql: string, params?: BindParams): T[] {
    const stmt = this.db.prepare(sql);
    return stmt.all(params ?? {}) as T[];
  }

  close() {
    this.db.close();
  }

  closeQuietly() {
    try {
      this.close();
    } catch {
      // Test resets can call this after the database has already been disposed.
    }
  }
}

function parseJsonArray(value: string | null | undefined): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parsePlaybackContext(value: string | null) {
  try {
    const parsed = value ? JSON.parse(value) : {};
    const playedSeconds = Number(parsed.playedSeconds ?? 0);
    const durationSeconds = parsed.durationSeconds === null || parsed.durationSeconds === undefined ? null : Number(parsed.durationSeconds);
    return {
      playedSeconds: Number.isFinite(playedSeconds) ? playedSeconds : 0,
      durationSeconds: durationSeconds !== null && Number.isFinite(durationSeconds) ? durationSeconds : null,
      completed: Boolean(parsed.completed)
    };
  } catch {
    return {
      playedSeconds: 0,
      durationSeconds: null,
      completed: false
    };
  }
}

function normalizeSources(values: unknown[]): CandidateSourceName[] {
  const allowed = new Set<CandidateSourceName>([
    "liked",
    "playlist",
    "recent",
    "frequent_artist",
    "netease_similar_song",
    "netease_similar_playlist",
    "dormant",
    "exploration"
  ]);
  return values.filter((value): value is CandidateSourceName => typeof value === "string" && allowed.has(value as CandidateSourceName));
}

function isFeedback(value: string | null): value is Feedback {
  return value === "like" || value === "dislike" || value === "too_familiar" || value === "more_like_this" || value === "later";
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function minNullable(left: number | null, right: number | null) {
  if (left === null) return right;
  if (right === null) return left;
  return Math.min(left, right);
}
