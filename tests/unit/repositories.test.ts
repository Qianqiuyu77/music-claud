import { describe, expect, it } from "vitest";
import { createDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/schema";
import { MusicRepository } from "@/lib/repositories/musicRepository";
import { RecommendationRepository } from "@/lib/repositories/recommendationRepository";
import type { CandidateSong } from "@/lib/recommendation/types";

describe("repositories", () => {
  it("stores songs, events, sessions, items, and feedback", async () => {
    const db = await createDatabase(":memory:");
    migrate(db);
    const music = new MusicRepository(db);
    const recs = new RecommendationRepository(db);

    const songId = music.upsertSong({
      neteaseSongId: "1001",
      name: "真实测试歌曲",
      artistNames: ["测试歌手"],
      artistIds: ["artist-1"],
      albumName: "本地测试专辑",
      albumId: "album-1",
      coverUrl: "https://example.com/cover.jpg",
      durationMs: 198000,
      popularity: 72,
      raw: { source: "test" }
    });

    music.addSongEvent({
      songId,
      eventType: "liked",
      source: "netease",
      contextText: null,
      weight: 1
    });

    const sessionId = recs.createSession({
      prompt: "写代码，安静，少人声",
      parsedContext: { scene: "work" },
      strategy: { novelty: "balanced" }
    });

    const itemId = recs.addItem({
      sessionId,
      songId,
      rank: 1,
      score: 8.7,
      source: "liked",
      reason: "来自本地真实数据仓库，适合当前安静工作的场景。",
      scoreBreakdown: { longTermPreference: 3 }
    });

    recs.setFeedback(itemId, "more_like_this");

    expect(music.listSongs()).toHaveLength(1);
    expect(music.listEventsForSong(songId)).toHaveLength(1);
    expect(recs.getSessionWithItems(sessionId)?.items[0].feedback).toBe("more_like_this");
  });

  it("stores and reads playable recommendation candidates with sources, tags, and feedback", async () => {
    const db = await createDatabase(":memory:");
    migrate(db);
    const music = new MusicRepository(db);

    const song: CandidateSong = {
      neteaseSongId: "2001",
      name: "本地候选歌曲",
      artistNames: ["候选歌手"],
      artistIds: ["artist-2001"],
      albumName: "候选专辑",
      coverUrl: "https://img.example/2001.jpg",
      streamUrl: "https://music.example/2001.mp3",
      durationMs: 201000,
      popularity: 81,
      sources: ["liked", "netease_similar_song"],
      tags: ["liked", "playable", "calm", "artist:候选歌手"],
      recentPlayCount: 2,
      daysSinceLastPlayed: 8,
      feedback: []
    };

    const songId = music.upsertCandidateSong(song);
    music.recordFeedbackByNeteaseSongId("2001", "like");

    expect(music.listCandidateSongs()).toEqual([
      expect.objectContaining({
        neteaseSongId: "2001",
        name: "本地候选歌曲",
        artistNames: ["候选歌手"],
        artistIds: ["artist-2001"],
        albumName: "候选专辑",
        coverUrl: "https://img.example/2001.jpg",
        streamUrl: "https://music.example/2001.mp3",
        durationMs: 201000,
        popularity: 81,
        sources: ["liked", "netease_similar_song"],
        tags: ["liked", "playable", "calm", "artist:候选歌手"],
        recentPlayCount: 2,
        daysSinceLastPlayed: 8,
        feedback: ["like"]
      })
    ]);
    expect(music.getLibraryStats()).toEqual(
      expect.objectContaining({
        songs: 1,
        playableSongs: 1
      })
    );
    expect(songId).toBeGreaterThan(0);
  });
});
