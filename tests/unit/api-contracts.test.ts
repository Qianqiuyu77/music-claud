import { describe, expect, it } from "vitest";
import { GET as defaultQueueGet } from "@/app/api/default-queue/route";
import { POST as recommendationsPost } from "@/app/api/recommendations/route";
import {
  createDefaultLikedQueueResponse,
  createRecommendationResponse,
  getMusicRepositoryForApp,
  mergeStoredAiTagsForImport,
  recordSongPlayback,
  selectSongsForAiTagging,
  tagImportedSongsForStorage,
  resetAppServicesForTests
} from "@/lib/appServices";
import { getLoginQrPreview, getLoginStatusPreview, saveNeteaseCookie } from "@/lib/appServices";
import { normalizeNeteaseCookie } from "@/lib/netease/cookie";
import type { CandidateSong } from "@/lib/recommendation/types";
import { visibleSongTags } from "@/lib/recommendation/songTags";
import { metadata } from "@/app/layout";
import packageJson from "../../package.json";
import type { AiProvider } from "@/lib/ai/types";
import type { RankedRecommendation } from "@/lib/recommendation/types";

describe("app services", () => {
  it("creates a recommendation response with parsed context, strategy, and items", async () => {
    const response = await createRecommendationResponse("写代码，安静，少人声", { songs: fixtureSongs, partialFailures: [] });

    expect(response.context.scene).toBe("work");
    expect(response.strategy.candidateSources.length).toBeGreaterThan(1);
    expect(response.items.length).toBeGreaterThanOrEqual(8);
    expect(response.libraryCounts).toEqual(
      expect.objectContaining({
        songs: fixtureSongs.length,
        playableSongs: fixtureSongs.length,
        partialFailures: 0
      })
    );
    expect(response.items[0].reason.length).toBeGreaterThan(10);
    expect(response.items[0].embedUrl).toContain("music.163.com/outchain/player");
    expect(response.items[0]).toHaveProperty("streamUrl");
    expect(response.flow.tags).toEqual(
      expect.objectContaining({
        totalSongs: fixtureSongs.length,
        aiTaggedSongs: expect.any(Number),
        aiTagCoverage: expect.any(Number),
        examples: expect.any(Array)
      })
    );
  });

  it("uses the local playback proxy instead of exposing stale NetEase media URLs", async () => {
    const response = await createRecommendationResponse("coding quietly", { songs: fixtureSongs, partialFailures: [] });

    expect(response.items[0].streamUrl).toBe(`/api/playback?id=${encodeURIComponent(response.items[0].id)}`);
    expect(response.items[0].streamUrl).not.toContain("music.example");
    expect(response.items[0].streamUrl).not.toContain("music.126.net");
  });

  it("returns distinct visible category tags for each recommended song", async () => {
    const response = await createRecommendationResponse("写代码，安静，少人声", { songs: fixtureSongs, partialFailures: [] });
    const signatures = response.items.map((item) => visibleSongTags(item.song.tags).map(({ label }) => label).join("|"));

    expect(new Set(signatures).size).toBe(response.items.length);
    expect(response.items.every((item) => item.song.tags.some((tag) => tag.startsWith("artist:")))).toBe(true);
  });

  it("does not fabricate recommendations when neither NetEase cookie nor local library exists", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    delete process.env.NETEASE_COOKIE;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    const response = await recommendationsPost(
      new Request("http://localhost/api/recommendations", {
        method: "POST",
        body: JSON.stringify({ prompt: "写代码，安静，少人声" })
      })
    );

    if (originalCookie === undefined) {
      delete process.env.NETEASE_COOKIE;
    } else {
      process.env.NETEASE_COOKIE = originalCookie;
    }
    if (originalDbPath === undefined) {
      delete process.env.MUSIC_DB_PATH;
    } else {
      process.env.MUSIC_DB_PATH = originalDbPath;
    }
    resetAppServicesForTests();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: expect.stringContaining("网易云 Cookie")
    });
  });

  it("generates recommendations from the stored local library without reusing the NetEase cookie", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    let stage = "setup";

    try {
      stage = "reset before seed";
      resetAppServicesForTests();
      stage = "open repository";
      const repository = await getMusicRepositoryForApp();
      stage = "seed songs";
      repository.upsertCandidateSongs(fixtureSongs);
      stage = "record sync";
      repository.recordSync("netease_import", fixtureSongs.length, []);
      stage = "delete cookie";
      delete process.env.NETEASE_COOKIE;

      stage = "recommend from stored library";
      const body = await createRecommendationResponse("写代码，安静，少人声", undefined, { limit: 8, requireAi: false });
      expect(body.libraryCounts.songs).toBe(fixtureSongs.length);
      expect(body.items).toHaveLength(8);
      expect(body.items[0].song.name).toContain("测试歌曲");
    } catch (error) {
      throw new Error(`local library recommendation failed during ${stage}: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
    } finally {
      if (originalCookie === undefined) {
        delete process.env.NETEASE_COOKIE;
      } else {
        process.env.NETEASE_COOKIE = originalCookie;
      }
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("allows the recommendation API to use a stored local library without a NetEase cookie", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalKey = process.env.DEEPSEEK_API_KEY;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    delete process.env.NETEASE_COOKIE;
    delete process.env.DEEPSEEK_API_KEY;
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      repository.upsertCandidateSongs(fixtureSongs);
      repository.recordSync("netease_import", fixtureSongs.length, []);

      const response = await recommendationsPost(
        new Request("http://localhost/api/recommendations", {
          method: "POST",
          body: JSON.stringify({ prompt: "写代码，安静，少人声" })
        })
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: expect.stringContaining("DeepSeek")
      });
    } finally {
      if (originalCookie === undefined) {
        delete process.env.NETEASE_COOKIE;
      } else {
        process.env.NETEASE_COOKIE = originalCookie;
      }
      if (originalKey === undefined) {
        delete process.env.DEEPSEEK_API_KEY;
      } else {
        process.env.DEEPSEEK_API_KEY = originalKey;
      }
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("continues recommendations by excluding songs that were already played", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      repository.upsertCandidateSongs(longFixtureSongs);
      repository.recordSync("netease_import", longFixtureSongs.length, []);
      delete process.env.NETEASE_COOKIE;

      const firstBody = await createRecommendationResponse("写代码，安静，少人声", undefined, { limit: 8, requireAi: false });
      const excludeIds = firstBody.items.map((item: { id: string }) => item.id);

      const nextBody = await createRecommendationResponse("写代码，安静，少人声", undefined, { limit: 8, excludeIds, requireAi: false });

      expect(nextBody.items).toHaveLength(8);
      expect(nextBody.items.map((item: { id: string }) => item.id)).not.toEqual(expect.arrayContaining(excludeIds));
      expect(nextBody.page).toEqual(
        expect.objectContaining({
          requested: 8,
          excluded: excludeIds.length,
          hasMore: true
        })
      );
    } finally {
      if (originalCookie === undefined) {
        delete process.env.NETEASE_COOKIE;
      } else {
        process.env.NETEASE_COOKIE = originalCookie;
      }
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("creates a default liked queue from stored playable songs without AI", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      repository.upsertCandidateSongs(longFixtureSongs);
      repository.recordSync("netease_import", longFixtureSongs.length, []);
      delete process.env.NETEASE_COOKIE;

      const body = await createDefaultLikedQueueResponse({ limit: 8 });

      expect(body.items).toHaveLength(8);
      expect(body.items.every((item) => item.selectionSource === "default_liked")).toBe(true);
      expect(body.flow.ai?.calls).toEqual([]);
      expect(body.flow.input.prompt).toBe("默认我喜欢随机播放");
      expect(body.items.every((item) => item.song.sources.includes("liked"))).toBe(true);
    } finally {
      if (originalCookie === undefined) {
        delete process.env.NETEASE_COOKIE;
      } else {
        process.env.NETEASE_COOKIE = originalCookie;
      }
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("exposes the default liked queue through an API route", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      repository.upsertCandidateSongs(longFixtureSongs);
      repository.recordSync("netease_import", longFixtureSongs.length, []);
      delete process.env.NETEASE_COOKIE;

      const response = await defaultQueueGet(new Request("http://localhost/api/default-queue?limit=6"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.items).toHaveLength(6);
      expect(body.items.every((item: { selectionSource?: string }) => item.selectionSource === "default_liked")).toBe(true);
    } finally {
      if (originalCookie === undefined) {
        delete process.env.NETEASE_COOKIE;
      } else {
        process.env.NETEASE_COOKIE = originalCookie;
      }
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("filters recently played songs during the cooldown window", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      repository.upsertCandidateSongs(longFixtureSongs);
      repository.recordSync("netease_import", longFixtureSongs.length, []);
      delete process.env.NETEASE_COOKIE;

      await recordSongPlayback({
        itemId: "long-fixture-1",
        playedSeconds: 190,
        durationSeconds: 190,
        completed: true
      });
      const body = await createRecommendationResponse("写代码，安静，少人声", undefined, { limit: 8, requireAi: false });

      expect(body.items.map((item) => item.id)).not.toContain("long-fixture-1");
      expect(body.flow.filters.cooldownExcluded).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "long-fixture-1", reason: "完整播放 7 天冷却" })])
      );
    } finally {
      if (originalCookie === undefined) {
        delete process.env.NETEASE_COOKIE;
      } else {
        process.env.NETEASE_COOKIE = originalCookie;
      }
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("fails loudly when AI recommendation is required but DeepSeek is not configured", async () => {
    const originalKey = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;

    try {
      await expect(
        createRecommendationResponse("写代码，安静，少人声", { songs: fixtureSongs, partialFailures: [] }, { requireAi: true })
      ).rejects.toThrow("DeepSeek");
    } finally {
      if (originalKey === undefined) {
        delete process.env.DEEPSEEK_API_KEY;
      } else {
        process.env.DEEPSEEK_API_KEY = originalKey;
      }
    }
  });

  it("uses AI intent parsing and AI reranking for recommendation selection", async () => {
    const calls: string[] = [];
    const aiProvider: AiProvider = {
      async summarizePreference() {
        calls.push("summarizePreference");
        return "偏好安静、专注、少人声的音乐。";
      },
      async parseListeningContext(input: string, profileSummary: string) {
        calls.push(`parseListeningContext:${input}:${profileSummary}`);
        return {
          scene: "work",
          mood: ["calm"],
          energy: "low" as const,
          vocal: "less_vocal" as const,
          novelty: "balanced" as const,
          avoid: [],
          targetTags: ["scene:focus", "mood:calm", "vocal:less_vocal"],
          excludeTags: ["energy:high"],
          familiarRatio: 0.6,
          exploreRatio: 0.4
        };
      },
      async generateReasons() {
        return [];
      },
      async rerankRecommendations(recommendations: RankedRecommendation[]) {
        calls.push("rerankRecommendations");
        return [...recommendations]
          .reverse()
          .map((item, index) => ({
            song: item.song,
            score: 100 - index,
            reason: `AI 重排第 ${index + 1} 首`,
            breakdown: item.breakdown
          }));
      }
    };

    const response = await createRecommendationResponse("写代码，安静，少人声", { songs: fixtureSongs, partialFailures: [] }, { requireAi: true, aiProvider });

    expect(calls).toEqual([
      "parseListeningContext:写代码，安静，少人声:",
      "rerankRecommendations"
    ]);
    expect(response.context.targetTags).toEqual(expect.arrayContaining(["scene:focus", "mood:calm", "vocal:less_vocal"]));
    expect(response.items[0].reason).toBe("AI 重排第 1 首");
    expect(response.items[0].id).toBe("fixture-8");
  });

  it("skips preference summary when no user profile data exists", async () => {
    const calls: string[] = [];
    const aiProvider: AiProvider & { getTrace: () => unknown[]; clearTrace: () => void } = {
      clearTrace() {
        return undefined;
      },
      getTrace() {
        return [
          {
            id: "preference-skipped-1",
            stage: "preference",
            title: "AI 偏好摘要已跳过",
            rawResponse: "",
            parsed: { skipped: true, reason: "缺少用户画像，未调用 AI 偏好摘要。" }
          }
        ];
      },
      async summarizePreference() {
        calls.push("summarizePreference");
        return "不应该调用";
      },
      async parseListeningContext(input: string, profileSummary: string) {
        calls.push(`parseListeningContext:${input}:${profileSummary}`);
        return {
          scene: "work",
          mood: ["calm"],
          energy: "low" as const,
          vocal: "less_vocal" as const,
          novelty: "balanced" as const,
          avoid: [],
          targetTags: ["scene:focus"],
          excludeTags: [],
          familiarRatio: 0.6,
          exploreRatio: 0.4
        };
      },
      async generateReasons() {
        return [];
      },
      async rerankRecommendations(recommendations: RankedRecommendation[]) {
        return recommendations;
      }
    };

    const response = await createRecommendationResponse("写代码，安静，少人声", { songs: fixtureSongs, partialFailures: [] }, { requireAi: true, aiProvider });

    expect(calls).toEqual(["parseListeningContext:写代码，安静，少人声:"]);
    expect(response.flow.ai?.calls?.[0].stage).toBe("preference");
    expect(response.flow.ai?.calls?.[0].parsed).toEqual(expect.objectContaining({ skipped: true }));
  });

  it("exposes the full raw AI returns in the recommendation flow", async () => {
    const aiProvider: AiProvider & { getTrace: () => unknown[]; clearTrace: () => void } = {
      clearTrace() {
        return undefined;
      },
      getTrace() {
        return [
          {
            id: "intent-1",
            stage: "intent",
            title: "AI 意图解析",
            model: "deepseek-chat",
            rawResponse: "{\"scene\":\"work\",\"targetTags\":[\"scene:focus\"]}",
            parsed: { scene: "work", targetTags: ["scene:focus"] }
          },
          {
            id: "rerank-1",
            stage: "rerank",
            title: "AI 推荐重排",
            model: "deepseek-chat",
            rawResponse: "{\"items\":[{\"id\":\"fixture-8\",\"reason\":\"AI 原始推荐理由\",\"score\":99}]}",
            parsed: { items: [{ id: "fixture-8", reason: "AI 原始推荐理由", score: 99 }] }
          }
        ];
      },
      async summarizePreference() {
        return "偏好安静、专注、少人声的音乐。";
      },
      async parseListeningContext() {
        return {
          scene: "work",
          mood: ["calm"],
          energy: "low" as const,
          vocal: "less_vocal" as const,
          novelty: "balanced" as const,
          avoid: [],
          targetTags: ["scene:focus"],
          excludeTags: [],
          familiarRatio: 0.6,
          exploreRatio: 0.4
        };
      },
      async generateReasons() {
        return [];
      },
      async rerankRecommendations(recommendations: RankedRecommendation[]) {
        return [...recommendations].reverse().map((item, index) => ({
          ...item,
          score: 99 - index,
          reason: `AI 原始推荐理由 ${index + 1}`
        }));
      }
    };

    const response = await createRecommendationResponse("写代码，安静，少人声", { songs: fixtureSongs, partialFailures: [] }, { requireAi: true, aiProvider });
    const flow = response.flow as typeof response.flow & { ai?: { calls?: Array<{ rawResponse?: string }> } };

    expect(flow.ai?.calls).toHaveLength(3);
    expect(flow.ai?.calls?.[0].parsed).toEqual(expect.objectContaining({ skipped: true }));
    expect(flow.ai?.calls?.[1].rawResponse).toContain("\"scene\":\"work\"");
    expect(flow.ai?.calls?.[2].rawResponse).toContain("\"items\"");
  });

  it("separates AI-selected songs from local fill in the recommendation flow", async () => {
    const aiProvider: AiProvider = {
      clearTrace() {
        return undefined;
      },
      async summarizePreference() {
        return "偏好安静、专注、少人声的音乐。";
      },
      async parseListeningContext() {
        return {
          scene: "work",
          mood: ["calm"],
          energy: "low" as const,
          vocal: "less_vocal" as const,
          novelty: "balanced" as const,
          avoid: [],
          targetTags: ["scene:focus"],
          excludeTags: [],
          familiarRatio: 0.6,
          exploreRatio: 0.4
        };
      },
      async generateReasons() {
        return [];
      },
      async rerankRecommendations(recommendations: RankedRecommendation[]) {
        return [
          {
            ...recommendations[0],
            reason: "AI 只返回这一首"
          }
        ];
      }
    };

    const response = await createRecommendationResponse("写代码，安静，少人声", { songs: fixtureSongs, partialFailures: [] }, { requireAi: true, aiProvider, limit: 4 });

    expect(response.items).toHaveLength(4);
    expect(response.flow.ranking.aiSelectedCount).toBe(1);
    expect(response.flow.ranking.localFillCount).toBe(3);
    expect(response.flow.ranking.final[0].selectionSource).toBe("ai");
    expect(response.flow.ranking.final.slice(1).every((song) => song.selectionSource === "local_fill")).toBe(true);
  });

  it("hard-filters songs that match AI excludeTags and exposes the recommendation flow", async () => {
    const rerankInputIds: string[] = [];
    const songs: CandidateSong[] = [
      {
        ...fixtureSongs[0],
        neteaseSongId: "keep-calm",
        name: "安静保留歌曲",
        tags: ["scene:focus", "mood:calm", "energy:low", "vocal:less_vocal", "ai_tagged"]
      },
      {
        ...fixtureSongs[1],
        neteaseSongId: "exclude-high",
        name: "高能应排除歌曲",
        tags: ["scene:workout", "energy:high", "mood:focused", "ai_tagged"]
      },
      {
        ...fixtureSongs[2],
        neteaseSongId: "keep-soft",
        name: "柔和保留歌曲",
        tags: ["scene:focus", "mood:calm", "energy:medium", "vocal:vocal_ok", "ai_tagged"]
      }
    ];
    const aiProvider: AiProvider = {
      async summarizePreference() {
        return "偏好安静、专注，不要高能量歌曲。";
      },
      async parseListeningContext() {
        return {
          scene: "work",
          mood: ["calm"],
          energy: "low" as const,
          vocal: "less_vocal" as const,
          novelty: "balanced" as const,
          avoid: ["high energy"],
          targetTags: ["scene:focus", "mood:calm"],
          excludeTags: ["energy:high"],
          familiarRatio: 0.7,
          exploreRatio: 0.3
        };
      },
      async generateReasons() {
        return [];
      },
      async rerankRecommendations(recommendations: RankedRecommendation[]) {
        rerankInputIds.push(...recommendations.map((item) => item.song.neteaseSongId));
        return recommendations.map((item, index) => ({
          ...item,
          score: 100 - index,
          reason: `AI 保留第 ${index + 1} 首`
        }));
      }
    };

    const response = await createRecommendationResponse("写代码，安静，去掉高能量", { songs, partialFailures: [] }, { requireAi: true, aiProvider, limit: 2 });

    expect(rerankInputIds).not.toContain("exclude-high");
    expect(response.items.map((item) => item.id)).toEqual(["keep-calm", "keep-soft"]);
    expect(response.flow.context.excludeTags).toEqual(["energy:high"]);
    expect(response.flow.filters.excludedByTags).toEqual([
      expect.objectContaining({
        id: "exclude-high",
        name: "高能应排除歌曲",
        matchedTags: ["energy:high"]
      })
    ]);
    expect(response.flow.ranking.finalCount).toBe(2);
  });

  it("reuses stored AI tags for already imported songs without preserving stale playback state", () => {
    const importedSongs: CandidateSong[] = [
      {
        ...fixtureSongs[0],
        streamUrl: null,
        tags: ["liked", "copyright_limited"]
      },
      {
        ...fixtureSongs[1],
        tags: ["playlist", "playable"]
      }
    ];
    const storedSongs: CandidateSong[] = [
      {
        ...fixtureSongs[0],
        tags: ["ai:tagged", "ai:scene:focus", "ai:mood:calm", "ai:genre:folk", "source:liked", "playback:playable"]
      }
    ];

    const merged = mergeStoredAiTagsForImport(importedSongs, storedSongs);

    expect(merged[0].tags).toEqual(expect.arrayContaining(["ai:tagged", "ai:scene:focus", "ai:mood:calm", "ai:genre:folk", "source:liked", "playback:copyright_limited"]));
    expect(merged[0].tags).not.toContain("playback:playable");
    expect(merged[1].tags).toEqual(["playlist", "playable"]);
  });

  it("limits sync AI tagging to the next untagged batch", () => {
    const songs = Array.from({ length: 5 }, (_, index) => ({
      ...fixtureSongs[index],
      neteaseSongId: `batch-${index + 1}`,
      tags: index === 0 ? ["ai:tagged", "ai:scene:focus"] : ["liked", "playable"]
    }));

    expect(selectSongsForAiTagging(songs, 2).map((song) => song.neteaseSongId)).toEqual(["batch-2", "batch-3"]);
  });

  it("uses a larger default AI tagging batch for library backfill", () => {
    const songs = Array.from({ length: 120 }, (_, index) => ({
      ...fixtureSongs[index % fixtureSongs.length],
      neteaseSongId: `default-batch-${index + 1}`,
      tags: ["liked", "playable"]
    }));

    expect(selectSongsForAiTagging(songs).map((song) => song.neteaseSongId)).toHaveLength(100);
  });

  it("calls the AI provider for future imported songs before storage", async () => {
    const calls: string[][] = [];
    const aiProvider: AiProvider = {
      async summarizePreference() {
        return "";
      },
      async parseListeningContext() {
        throw new Error("not used");
      },
      async generateReasons() {
        return [];
      },
      async tagSongs(songs: CandidateSong[]) {
        calls.push(songs.map((song) => song.neteaseSongId));
        return songs.map((song) => ({
          ...song,
          tags: [...song.tags, "ai:tagged", "ai:scene:focus", "ai:mood:calm"]
        }));
      }
    };

    const result = await tagImportedSongsForStorage(
      [{ ...fixtureSongs[0], neteaseSongId: "future-import-1", tags: ["liked", "playable"] }],
      { aiProvider, limit: 10 }
    );

    expect(calls).toEqual([["future-import-1"]]);
    expect(result.partialFailures).toEqual([]);
    expect(result.songs[0].tags).toEqual(expect.arrayContaining(["ai:tagged", "ai:scene:focus", "ai:mood:calm"]));
  });

  it("rejects empty recommendation prompts instead of using a default scene", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    process.env.NETEASE_COOKIE = "MUSIC_U=test-cookie";

    const response = await recommendationsPost(
      new Request("http://localhost/api/recommendations", {
        method: "POST",
        body: JSON.stringify({ prompt: "   " })
      })
    );

    process.env.NETEASE_COOKIE = originalCookie;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "请输入当前想听歌的场景。"
    });
  });

  it("exposes QR login preview data for the login panel", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalRealLogin = process.env.NETEASE_USE_REAL_LOGIN;
    delete process.env.NETEASE_COOKIE;
    delete process.env.NETEASE_USE_REAL_LOGIN;
    await expect(getLoginQrPreview()).resolves.toEqual({
      key: "login-unavailable",
      qrUrl: ""
    });
    await expect(getLoginStatusPreview("login-unavailable")).resolves.toEqual({
      status: "waiting"
    });
    process.env.NETEASE_COOKIE = originalCookie;
    process.env.NETEASE_USE_REAL_LOGIN = originalRealLogin;
  });

  it("marks the login preview as cookie-authorized when a backend Cookie exists", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    process.env.NETEASE_COOKIE = "MUSIC_U=test-cookie";

    await expect(getLoginQrPreview()).resolves.toEqual({
      key: "cookie-login",
      qrUrl: "",
      source: "cookie"
    });

    process.env.NETEASE_COOKIE = originalCookie;
  });

  it("rejects malformed NetEase cookies before saving", async () => {
    await expect(saveNeteaseCookie("foo=bar")).resolves.toEqual({
      ok: false,
      error: expect.stringContaining("MUSIC_U")
    });
  });

  it("normalizes a DevTools cookie table into a NetEase cookie header", () => {
    const normalized = normalizeNeteaseCookie(
      [
        "BAIDUID\tignore-me\t.baidu.com\t/",
        "__csrf\tcsrf-token\t.music.163.com\t/",
        "MUSIC_U\tmusic-u-token\t.music.163.com\t/",
        "JSESSIONID-WYYY\tsession-token\t.music.163.com\t/",
        "NMTID\tnmtid-token\t.music.163.com\t/",
        "sDeviceId\tdevice-token\t.music.163.com\t/",
        "Hm_lvt_1483fb4774c02a30ffa6f0e2945e9b70\tstat-token\t.music.163.com\t/"
      ].join("\n")
    );

    expect(normalized).toBe(
      "MUSIC_U=music-u-token; __csrf=csrf-token; JSESSIONID-WYYY=session-token; NMTID=nmtid-token; sDeviceId=device-token"
    );
  });

  it("normalizes a space-aligned DevTools cookie table", () => {
    expect(normalizeNeteaseCookie("MUSIC_U  music-u-token  .music.163.com  /\n__csrf  csrf-token  .music.163.com  /")).toBe(
      "MUSIC_U=music-u-token; __csrf=csrf-token"
    );
  });

  it("accepts a bare MUSIC_U token pasted from the browser", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const token = "unit_test_music_u_token_for_cookie_normalization_000000000000";

    try {
      expect(normalizeNeteaseCookie(token)).toBe(`MUSIC_U=${token}`);
      await expect(saveNeteaseCookie(token)).resolves.toEqual({
        ok: true,
        status: "authorized",
        source: "cookie"
      });
    } finally {
      if (originalCookie === undefined) {
        delete process.env.NETEASE_COOKIE;
      } else {
        process.env.NETEASE_COOKIE = originalCookie;
      }
    }
  });

  it("uses Chinese app metadata", () => {
    expect(metadata.title).toBe("AI 私人歌单");
    expect(metadata.description).toContain("网易云");
  });

  it("declares the QR code dependency used by real NetEase login", () => {
    expect(packageJson.dependencies).toHaveProperty("qrcode");
  });
});

const fixtureSongs: CandidateSong[] = Array.from({ length: 8 }, (_, index) => ({
  neteaseSongId: `fixture-${index + 1}`,
  name: `测试歌曲 ${index + 1}`,
  artistNames: [`歌手 ${index + 1}`],
  albumName: "测试专辑",
  coverUrl: null,
  streamUrl: `https://music.example/${index + 1}.mp3`,
  durationMs: 180000,
  popularity: 70,
  sources: index % 2 === 0 ? ["liked"] : ["playlist"],
  tags: ["calm", "focused"],
  recentPlayCount: 0,
  daysSinceLastPlayed: 30,
  feedback: []
}));

const longFixtureSongs: CandidateSong[] = Array.from({ length: 24 }, (_, index) => ({
  neteaseSongId: `long-fixture-${index + 1}`,
  name: `连续推荐测试歌曲 ${index + 1}`,
  artistNames: [`歌手 ${index + 1}`],
  albumName: "连续推荐测试专辑",
  coverUrl: null,
  streamUrl: `https://music.example/long-${index + 1}.mp3`,
  durationMs: 180000,
  popularity: 70,
  sources: index % 3 === 0 ? ["liked"] : index % 3 === 1 ? ["playlist"] : ["exploration"],
  tags: index % 2 === 0 ? ["scene:focus", "mood:calm", "vocal:less_vocal", "ai_tagged"] : ["scene:focus", "mood:focused", "vocal:vocal_ok", "ai_tagged"],
  recentPlayCount: 0,
  daysSinceLastPlayed: 30 + index,
  feedback: []
}));
