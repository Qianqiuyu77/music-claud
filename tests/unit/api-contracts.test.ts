import { describe, expect, it, vi } from "vitest";
import { GET as defaultQueueGet } from "@/app/api/default-queue/route";
import { POST as expandPost } from "@/app/api/expand/route";
import { POST as feedbackPost } from "@/app/api/feedback/route";
import { POST as playEventsPost } from "@/app/api/play-events/route";
import { GET as profileStatusGet } from "@/app/api/profiles/status/route";
import { POST as loginCookiePost } from "@/app/api/login/cookie/route";
import { GET as loginDiagnosticsGet } from "@/app/api/login/diagnostics/route";
import { GET as loginQrGet } from "@/app/api/login/qr/route";
import { GET as loginStateGet } from "@/app/api/login/state/route";
import { GET as loginStatusGet } from "@/app/api/login/status/route";
import { GET as libraryGet } from "@/app/api/library/route";
import { GET as lyricsGet } from "@/app/api/lyrics/route";
import { GET as playbackGet } from "@/app/api/playback/route";
import { POST as recommendationsPost } from "@/app/api/recommendations/route";
import { POST as sessionPost } from "@/app/api/session/route";
import { POST as syncPost } from "@/app/api/sync/route";
import { POST as tagsPost } from "@/app/api/tags/route";
import { POST as tagsQueueProcessPost } from "@/app/api/tags/queue/process/route";
import { GET as tagsQueueGet } from "@/app/api/tags/queue/route";
import { POST as tagWorkerPost } from "@/app/api/workers/tagging/route";
import { handleChatRequest } from "@/lib/companionChatRoute";
import { handleProactiveCompanionRequest } from "@/lib/proactiveCompanionRoute";
import type { AppDatabase } from "@/lib/db/client";
import {
  createDefaultLikedQueueResponse,
  createRecommendationResponse,
  expandStoredLibrary,
  getMusicRepositoryForApp,
  getSyncPreview,
  mergeStoredAiTagsForImport,
  processTaggingQueueBatch,
  recordRecommendationFeedback,
  recordSongPlayback,
  refreshUserProfile,
  getCurrentUserLoginStatus,
  markUserLoginExpired,
  selectSongsForAiTagging,
  tagImportedSongsForStorage,
  resetAppServicesForTests
} from "@/lib/appServices";
import { getLoginQrPreview, getLoginStatusPreview, saveNeteaseCookie } from "@/lib/appServices";
import { NeteaseCloudProvider } from "@/lib/netease/cloudProvider";
import { normalizeNeteaseCookie } from "@/lib/netease/cookie";
import { resetLyricsServicesForTests, setLyricsServicesForTests } from "@/lib/lyrics/lyricsService";
import { resetPlaybackServicesForTests, setPlaybackServicesForTests } from "@/lib/playback/playbackService";
import type { CandidateSong } from "@/lib/recommendation/types";
import { visibleSongTags } from "@/lib/recommendation/songTags";
import { metadata } from "@/app/layout";
import { canAccessAdmin } from "@/lib/admin/access";
import { createSessionCookieValue } from "@/lib/user/sessionCookie";
import { TaggingQueueRepository } from "@/lib/repositories/taggingQueueRepository";
import { UserRepository } from "@/lib/repositories/userRepository";
import packageJson from "../../package.json";
import type { AiProvider } from "@/lib/ai/types";
import type { RankedRecommendation } from "@/lib/recommendation/types";

describe("app services", () => {
  it("creates a recommendation response with parsed context, strategy, and items", async () => {
    const response = await createRecommendationResponse("quiet coding focus", { songs: fixtureSongs, partialFailures: [] });

    expect(response.context.scene).toBe("general");
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
    const response = await createRecommendationResponse("鍐欎唬鐮侊紝瀹夐潤锛屽皯浜哄０", { songs: fixtureSongs, partialFailures: [] });
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
        body: JSON.stringify({ prompt: "鍐欎唬鐮侊紝瀹夐潤锛屽皯浜哄０" })
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
      error: expect.stringContaining("缺少网易云 Cookie")
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
      repository.upsertCandidateSongsForUser(1, fixtureSongs);
      stage = "record sync";
      repository.recordSync("netease_import", fixtureSongs.length, []);
      stage = "delete cookie";
      delete process.env.NETEASE_COOKIE;

      stage = "recommend from stored library";
      const body = await createRecommendationResponse("quiet coding focus", undefined, { limit: 8, requireAi: false });
      expect(body.libraryCounts.songs).toBe(fixtureSongs.length);
      expect(body.items).toHaveLength(8);
      expect(body.items[0].song.name).toContain("Test Song");
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
      repository.upsertCandidateSongsForUser(1, fixtureSongs);
      repository.recordSync("netease_import", fixtureSongs.length, []);

      const response = await recommendationsPost(
        new Request("http://localhost/api/recommendations", {
          method: "POST",
          body: JSON.stringify({ prompt: "鍐欎唬鐮侊紝瀹夐潤锛屽皯浜哄０" })
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

  it("accepts mode, scene, and text fields in the recommendation API request", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalKey = process.env.DEEPSEEK_API_KEY;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    delete process.env.NETEASE_COOKIE;
    delete process.env.DEEPSEEK_API_KEY;
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      repository.upsertCandidateSongsForUser(1, fixtureSongs);
      repository.recordSync("netease_import", fixtureSongs.length, []);

      const response = await recommendationsPost(
        new Request("http://localhost/api/recommendations", {
          method: "POST",
          body: JSON.stringify({ mode: "explore", scene: "work_focus", text: "quiet focus music", limit: 12 })
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
      repository.upsertCandidateSongsForUser(1, longFixtureSongs);
      repository.recordSync("netease_import", longFixtureSongs.length, []);
      delete process.env.NETEASE_COOKIE;

      const firstBody = await createRecommendationResponse("鍐欎唬鐮侊紝瀹夐潤锛屽皯浜哄０", undefined, { limit: 8, requireAi: false });
      const excludeIds = firstBody.items.map((item: { id: string }) => item.id);

      const nextBody = await createRecommendationResponse("鍐欎唬鐮侊紝瀹夐潤锛屽皯浜哄０", undefined, { limit: 8, excludeIds, requireAi: false });

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
      repository.upsertCandidateSongsForUser(1, longFixtureSongs);
      repository.recordSync("netease_import", longFixtureSongs.length, []);
      delete process.env.NETEASE_COOKIE;

      const body = await createDefaultLikedQueueResponse({ limit: 8 });

      expect(body.items).toHaveLength(8);
      expect(body.items.every((item) => item.selectionSource === "default_liked")).toBe(true);
      expect(body.flow.ai?.calls).toEqual([]);
      expect(body.flow.input.prompt).toBe("Default liked shuffle");
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

  it("does not let a new user's recommendation API readiness inherit the owner library", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalKey = process.env.DEEPSEEK_API_KEY;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    delete process.env.NETEASE_COOKIE;
    delete process.env.DEEPSEEK_API_KEY;
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      const db = (repository as unknown as { db: AppDatabase }).db;
      db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");
      repository.upsertCandidateSongsForUser(1, fixtureSongs);
      repository.recordSync("netease_import", fixtureSongs.length, []);

      const response = await recommendationsPost(
        new Request("http://localhost/api/recommendations", {
          method: "POST",
          headers: { cookie: signedSessionCookie(2) },
          body: JSON.stringify({ prompt: "quiet focus" })
        })
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: expect.stringContaining("Cookie")
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

  it("allows untagged playable songs into queues with lower profile confidence", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      const untaggedLikedSong: CandidateSong = {
        ...fixtureSongs[0],
        neteaseSongId: "untagged-playable-liked",
        sources: ["liked"],
        tags: ["liked", "playable"],
        streamUrl: "https://music.example/untagged-playable-liked.mp3"
      };
      repository.upsertCandidateSongsForUser(1, [untaggedLikedSong]);
      repository.recordSync("netease_import", 1, []);
      delete process.env.NETEASE_COOKIE;

      const defaultQueue = await createDefaultLikedQueueResponse({ limit: 4 });
      const recommendation = await createRecommendationResponse("quiet focus", undefined, { limit: 4, requireAi: false });

      expect(defaultQueue.items.map((item) => item.id)).toContain("untagged-playable-liked");
      expect(recommendation.items.map((item) => item.id)).toContain("untagged-playable-liked");
      expect(recommendation.items[0].scoreBreakdown.profileConfidenceScore).toBeLessThan(1);
      expect(recommendation.items[0].streamUrl).toBe("/api/playback?id=untagged-playable-liked");
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
      repository.upsertCandidateSongsForUser(1, longFixtureSongs);
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

  it("reports library status from the request user's private library", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      const db = (repository as unknown as { db: AppDatabase }).db;
      db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");
      repository.upsertCandidateSongsForUser(1, longFixtureSongs.slice(0, 2));
      repository.recordSync("netease_import", 2, []);
      delete process.env.NETEASE_COOKIE;

      const ownerResponse = await libraryGet(new Request("http://localhost/api/library"));
      const ownerBody = await ownerResponse.json();
      const friendResponse = await libraryGet(
        new Request("http://localhost/api/library", {
          headers: { cookie: signedSessionCookie(2) }
        })
      );
      const friendBody = await friendResponse.json();

      expect(ownerResponse.status).toBe(200);
      expect(ownerBody.counts.songs).toBe(2);
      expect(friendResponse.status).toBe(200);
      expect(friendBody.counts).toEqual(
        expect.objectContaining({
          songs: 0,
          playableSongs: 0,
          lastSyncAt: null
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

  it("does not let a new user's default queue readiness inherit the owner library", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      const db = (repository as unknown as { db: AppDatabase }).db;
      db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");
      repository.upsertCandidateSongsForUser(1, longFixtureSongs);
      repository.recordSync("netease_import", longFixtureSongs.length, []);
      delete process.env.NETEASE_COOKIE;

      const response = await defaultQueueGet(
        new Request("http://localhost/api/default-queue?limit=6", {
          headers: { cookie: signedSessionCookie(2) }
        })
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        error: expect.stringContaining("本地曲库为空")
      });
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
      repository.upsertCandidateSongsForUser(1, longFixtureSongs);
      repository.recordSync("netease_import", longFixtureSongs.length, []);
      delete process.env.NETEASE_COOKIE;

      await recordSongPlayback({
        itemId: "long-fixture-1",
        playedSeconds: 190,
        durationSeconds: 190,
        completed: true
      });
      const body = await createRecommendationResponse("鍐欎唬鐮侊紝瀹夐潤锛屽皯浜哄０", undefined, { limit: 8, requireAi: false });

      expect(body.items.map((item) => item.id)).not.toContain("long-fixture-1");
      expect(body.flow.filters.cooldownExcluded).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "long-fixture-1", reason: "Completed playback cooldown" })])
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

  it("records playback in the default owner scope without making it public to another user", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      repository.upsertCandidateSongsForUser(1, longFixtureSongs);
      repository.recordSync("netease_import", longFixtureSongs.length, []);

      await recordSongPlayback({
        itemId: "long-fixture-1",
        playedSeconds: 190,
        durationSeconds: 190,
        completed: true
      });

      expect(repository.listLatestPlaybackByNeteaseSongIdsForUser(1, ["long-fixture-1"]).has("long-fixture-1")).toBe(true);
      expect(repository.listLatestPlaybackByNeteaseSongIdsForUser(2, ["long-fixture-1"]).has("long-fixture-1")).toBe(false);
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("refreshes a user profile from that user's private library only", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      (repository as unknown as { db: AppDatabase }).db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");
      repository.upsertCandidateSongsForUser(1, [
        { ...fixtureSongs[0], neteaseSongId: "owner-profile-calm", sources: ["liked"], tags: ["ai:tagged", "ai:mood:calm", "ai:scene:focus"] }
      ]);
      repository.upsertCandidateSongsForUser(2, [
        { ...fixtureSongs[1], neteaseSongId: "friend-profile-rock", sources: ["liked"], tags: ["ai:tagged", "ai:genre:rock", "ai:energy:high"] }
      ]);
      repository.recordFeedbackByNeteaseSongIdForUser(2, "friend-profile-rock", "dislike");

      const ownerProfile = await refreshUserProfile(1);
      const friendProfile = await refreshUserProfile(2);

      expect(ownerProfile.compactSummary).toContain("calm");
      expect(ownerProfile.compactSummary).not.toContain("rock");
      expect(friendProfile.compactSummary).toContain("negative: dislike");
      expect(friendProfile.compactSummary).toContain("rock");
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("optionally saves an AI-compacted profile summary while keeping deterministic profile signals", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      repository.upsertCandidateSongsForUser(1, [
        { ...fixtureSongs[0], neteaseSongId: "ai-compact-profile-calm", sources: ["liked"], tags: ["ai:tagged", "ai:mood:calm", "ai:scene:focus"] }
      ]);
      const calls: unknown[] = [];

      const profile = await refreshUserProfile(1, {
        aiProvider: {
          async summarizePreference(profileData) {
            calls.push(profileData);
            return "prefers calm focus music, avoids noisy switches";
          }
        }
      });

      const saved = (repository as unknown as { db: AppDatabase }).db
        .prepare("SELECT compact_summary, profile_json FROM user_profiles WHERE user_id = 1")
        .get() as { compact_summary: string; profile_json: string };

      expect(calls).toHaveLength(1);
      expect(profile.compactSummary).toBe("prefers calm focus music, avoids noisy switches");
      expect(saved.compact_summary).toBe("prefers calm focus music, avoids noisy switches");
      expect(JSON.parse(saved.profile_json).positiveTags).toEqual(expect.arrayContaining([expect.objectContaining({ key: "mood:calm" })]));
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("falls back to the deterministic profile summary when AI compaction fails", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      repository.upsertCandidateSongsForUser(1, [
        { ...fixtureSongs[0], neteaseSongId: "ai-compact-profile-fallback", sources: ["liked"], tags: ["ai:tagged", "ai:mood:calm", "ai:scene:focus"] }
      ]);

      const profile = await refreshUserProfile(1, {
        aiProvider: {
          async summarizePreference() {
            throw new Error("AI compaction failed");
          }
        }
      });

      expect(profile.compactSummary).toContain("mood:calm");
      expect(profile.compactSummary).toContain("scene:focus");
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("builds the default liked queue only from the default owner's private sources", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      (repository as unknown as { db: { run: (sql: string) => void } }).db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");
      const [ownerSong, friendSong] = longFixtureSongs;
      repository.upsertCandidateSongsForUser(1, [{ ...ownerSong, neteaseSongId: "owner-liked-private", sources: ["liked"] }]);
      repository.upsertCandidateSongsForUser(2, [{ ...friendSong, neteaseSongId: "friend-liked-private", sources: ["liked"] }]);
      repository.recordSync("netease_import", 2, []);
      delete process.env.NETEASE_COOKIE;

      const body = await createDefaultLikedQueueResponse({ limit: 12 });

      expect(body.items.map((item) => item.id)).toContain("owner-liked-private");
      expect(body.items.map((item) => item.id)).not.toContain("friend-liked-private");
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

  it("builds the default liked queue API from the request user's private sources", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      (repository as unknown as { db: { run: (sql: string) => void } }).db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");
      const [ownerSong, friendSong] = longFixtureSongs;
      repository.upsertCandidateSongsForUser(1, [{ ...ownerSong, neteaseSongId: "owner-request-liked", sources: ["liked"] }]);
      repository.upsertCandidateSongsForUser(2, [{ ...friendSong, neteaseSongId: "friend-request-liked", sources: ["liked"] }]);
      repository.recordSync("netease_import", 2, []);
      delete process.env.NETEASE_COOKIE;

      const response = await defaultQueueGet(
        new Request("http://localhost/api/default-queue?limit=12", {
          headers: { cookie: signedSessionCookie(2) }
        })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.items.map((item: { id: string }) => item.id)).toContain("friend-request-liked");
      expect(body.items.map((item: { id: string }) => item.id)).not.toContain("owner-request-liked");
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

  it("records playback from the request user only", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      (repository as unknown as { db: { run: (sql: string) => void } }).db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");
      repository.upsertCandidateSongsForUser(2, [{ ...longFixtureSongs[0], neteaseSongId: "friend-played-request", sources: ["liked"] }]);
      repository.recordSync("netease_import", 1, []);

      const response = await playEventsPost(
        new Request("http://localhost/api/play-events", {
          method: "POST",
          headers: { cookie: signedSessionCookie(2) },
          body: JSON.stringify({
            itemId: "friend-played-request",
            playedSeconds: 190,
            durationSeconds: 190,
            completed: true
          })
        })
      );

      expect(response.status).toBe(200);
      expect(repository.listLatestPlaybackByNeteaseSongIdsForUser(1, ["friend-played-request"]).has("friend-played-request")).toBe(false);
      expect(repository.listLatestPlaybackByNeteaseSongIdsForUser(2, ["friend-played-request"]).has("friend-played-request")).toBe(true);
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("does not let one user write playback for another user's private song", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      (repository as unknown as { db: { run: (sql: string) => void } }).db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");
      repository.upsertCandidateSongsForUser(1, [{ ...longFixtureSongs[0], neteaseSongId: "owner-private-playback-target", sources: ["liked"] }]);

      const response = await playEventsPost(
        new Request("http://localhost/api/play-events", {
          method: "POST",
          headers: { cookie: signedSessionCookie(2) },
          body: JSON.stringify({
            itemId: "owner-private-playback-target",
            playedSeconds: 190,
            durationSeconds: 190,
            completed: true
          })
        })
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body).toEqual({ error: "Song is not in the current user's library." });
      expect(repository.listLatestPlaybackByNeteaseSongIdsForUser(1, ["owner-private-playback-target"]).has("owner-private-playback-target")).toBe(false);
      expect(repository.listLatestPlaybackByNeteaseSongIdsForUser(2, ["owner-private-playback-target"]).has("owner-private-playback-target")).toBe(false);
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("does not let one user read playback for another user's private song", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();
    const resolveFreshPlaybackUrl = vi.fn(async () => "https://media.example/private-owner.mp3");
    const fetchMedia = vi.fn(async () => new Response("audio", { status: 200, headers: { "content-type": "audio/mpeg" } }));
    setPlaybackServicesForTests({ resolveFreshPlaybackUrl, fetchMedia });

    try {
      const repository = await getMusicRepositoryForApp();
      (repository as unknown as { db: { run: (sql: string) => void } }).db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");
      repository.upsertCandidateSongsForUser(1, [{ ...longFixtureSongs[0], neteaseSongId: "owner-private-playback-read", sources: ["liked"] }]);

      const response = await playbackGet(
        new Request("http://localhost/api/playback?id=owner-private-playback-read", {
          headers: { cookie: signedSessionCookie(2) }
        })
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body).toEqual({ error: "Song is not in the current user's library." });
      expect(resolveFreshPlaybackUrl).not.toHaveBeenCalled();
      expect(fetchMedia).not.toHaveBeenCalled();
    } finally {
      resetPlaybackServicesForTests();
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("does not let one user read lyrics for another user's private song", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();
    const getLyrics = vi.fn(async () => [{ time: 0, text: "private lyric" }]);
    setLyricsServicesForTests({ getLyrics });

    try {
      const repository = await getMusicRepositoryForApp();
      (repository as unknown as { db: { run: (sql: string) => void } }).db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");
      repository.upsertCandidateSongsForUser(1, [{ ...longFixtureSongs[0], neteaseSongId: "owner-private-lyrics-read", sources: ["liked"] }]);

      const response = await lyricsGet(
        new Request("http://localhost/api/lyrics?id=owner-private-lyrics-read", {
          headers: { cookie: signedSessionCookie(2) }
        })
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body).toEqual({ error: "Song is not in the current user's library." });
      expect(getLyrics).not.toHaveBeenCalled();
    } finally {
      resetLyricsServicesForTests();
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("records feedback from the request user only", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      (repository as unknown as { db: { run: (sql: string) => void } }).db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");
      repository.upsertCandidateSongsForUser(2, [{ ...longFixtureSongs[0], neteaseSongId: "friend-feedback-request", sources: ["liked"] }]);
      repository.recordSync("netease_import", 1, []);

      const response = await feedbackPost(
        new Request("http://localhost/api/feedback", {
          method: "POST",
          headers: { cookie: signedSessionCookie(2) },
          body: JSON.stringify({
            itemId: "friend-feedback-request",
            feedback: "like"
          })
        })
      );

      expect(response.status).toBe(200);
      expect(repository.listCandidateSongsForUser(1)).toEqual([]);
      expect(repository.listCandidateSongsForUser(2)[0]).toEqual(expect.objectContaining({ feedback: ["like"] }));
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("does not leak in-memory feedback into another user's recommendations", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      (repository as unknown as { db: { run: (sql: string) => void } }).db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");
      const sharedSong: CandidateSong = { ...longFixtureSongs[0], neteaseSongId: "shared-feedback-memory", sources: ["liked"] };
      repository.upsertCandidateSongsForUser(1, [sharedSong]);
      repository.upsertCandidateSongsForUser(2, [sharedSong]);
      repository.recordSync("netease_import", 1, []);
      delete process.env.NETEASE_COOKIE;

      await recordRecommendationFeedback("shared-feedback-memory", "dislike", { userId: 1 });
      const friendResponse = await createRecommendationResponse("quiet work focus", undefined, { userId: 2, limit: 4, requireAi: false });
      const friendSong = friendResponse.items.find((item) => item.id === "shared-feedback-memory")?.song;

      expect(friendSong).toBeDefined();
      expect(friendSong?.feedback).toEqual([]);
      expect(repository.listCandidateSongsForUser(2)[0].feedback).toEqual([]);
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

  it("does not let one user write feedback for another user's private song", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      (repository as unknown as { db: { run: (sql: string) => void } }).db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");
      repository.upsertCandidateSongsForUser(1, [{ ...longFixtureSongs[0], neteaseSongId: "owner-private-feedback-target", sources: ["liked"] }]);

      const response = await feedbackPost(
        new Request("http://localhost/api/feedback", {
          method: "POST",
          headers: { cookie: signedSessionCookie(2) },
          body: JSON.stringify({
            itemId: "owner-private-feedback-target",
            feedback: "dislike"
          })
        })
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body).toEqual({ error: "Song is not in the current user's library." });
      expect(repository.listCandidateSongsForUser(1)[0].feedback).toEqual([]);
      expect(repository.listCandidateSongsForUser(2)).toEqual([]);
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("builds recommendations from the selected user's private library", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      (repository as unknown as { db: { run: (sql: string) => void } }).db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");
      repository.upsertCandidateSongsForUser(1, [{ ...longFixtureSongs[0], neteaseSongId: "owner-recommendation-only", sources: ["liked"] }]);
      repository.upsertCandidateSongsForUser(2, [{ ...longFixtureSongs[1], neteaseSongId: "friend-recommendation-only", sources: ["liked"] }]);
      repository.recordSync("netease_import", 2, []);
      delete process.env.NETEASE_COOKIE;

      const body = await createRecommendationResponse("quiet work focus", undefined, { userId: 2, limit: 4, requireAi: false });

      expect(body.items.map((item) => item.id)).toContain("friend-recommendation-only");
      expect(body.items.map((item) => item.id)).not.toContain("owner-recommendation-only");
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

  it("passes the stored user profile summary into recommendation context parsing", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();
    const calls: string[] = [];

    try {
      const repository = await getMusicRepositoryForApp();
      repository.upsertCandidateSongsForUser(1, [
        { ...longFixtureSongs[0], neteaseSongId: "profile-recommendation-song", sources: ["liked"], tags: ["ai:tagged", "ai:mood:calm", "ai:scene:focus"] }
      ]);
      await refreshUserProfile(1);

      const aiProvider: AiProvider = {
        async summarizePreference(profileData) {
          calls.push(`summarize:${JSON.stringify(profileData)}`);
          return "prefers calm focused songs";
        },
        async parseListeningContext(input: string, profileSummary: string) {
          calls.push(`parse:${profileSummary}`);
          return {
            scene: "work",
            mood: ["calm"],
            energy: "low" as const,
            vocal: "less_vocal" as const,
            novelty: "balanced" as const,
            avoid: [],
            targetTags: ["scene:focus"],
            excludeTags: []
          };
        },
        async generateReasons() {
          return [];
        },
        async rerankRecommendations(recommendations) {
          return recommendations;
        }
      };

      await createRecommendationResponse("quiet work", undefined, { aiProvider, userId: 1, limit: 1 });

      expect(calls[0]).toContain("compactSummary");
      expect(calls[0]).toContain("mood:calm");
      expect(calls).toContain("parse:prefers calm focused songs");
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("refreshes the user profile after explicit feedback", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      repository.upsertCandidateSongsForUser(1, [
        { ...longFixtureSongs[0], neteaseSongId: "profile-feedback-refresh", sources: ["liked"], tags: ["ai:tagged", "ai:mood:calm", "ai:scene:focus"] }
      ]);
      const before = await refreshUserProfile(1);

      await recordRecommendationFeedback("profile-feedback-refresh", "dislike", { userId: 1 });
      const after = ((repository as unknown as { db: AppDatabase }).db
        .prepare("SELECT compact_summary FROM user_profiles WHERE user_id = 1")
        .get() as { compact_summary: string }).compact_summary;

      expect(before.compactSummary).not.toContain("negative: dislike");
      expect(after).toContain("negative: dislike");
      expect(after).toContain("mood:calm");
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("refreshes the user profile after significant playback", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      repository.upsertCandidateSongsForUser(1, [
        { ...longFixtureSongs[0], neteaseSongId: "profile-playback-refresh", sources: ["liked"], tags: ["ai:tagged", "ai:mood:calm", "ai:scene:focus"] }
      ]);
      const db = (repository as unknown as { db: AppDatabase }).db;
      expect(db.prepare("SELECT COUNT(*) AS count FROM user_profiles WHERE user_id = 1").get()).toEqual({ count: 0 });

      await recordSongPlayback({
        itemId: "profile-playback-refresh",
        playedSeconds: 190,
        durationSeconds: 190,
        completed: true
      });

      const profile = db.prepare("SELECT compact_summary FROM user_profiles WHERE user_id = 1").get() as { compact_summary: string };
      expect(profile.compact_summary).toContain("mood:calm");
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("refreshes the selected user's profile after sync", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    delete process.env.NETEASE_COOKIE;
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      (repository as unknown as { db: { run: (sql: string) => void } }).db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");
      await saveNeteaseCookie("MUSIC_U=friend-profile-sync-cookie", { userId: 2 });
      const getAccountProfile = vi.fn(async (cookie: string) => ({ userId: 2, nickname: "Friend", cookie }));
      const importedSongs: CandidateSong[] = [
        {
          ...longFixtureSongs[0],
          neteaseSongId: "friend-sync-profile",
          sources: ["liked"],
          tags: ["ai:tagged", "ai:mood:calm", "ai:scene:focus"]
        }
      ];
      const importLibrary = vi.fn(async (cookie?: string) => ({
        songs: cookie === "MUSIC_U=friend-profile-sync-cookie" ? importedSongs : [],
        partialFailures: []
      }));

      const result = await getSyncPreview({
        userId: 2,
        provider: {
          importLibrary,
          getAccountProfile
        }
      });

      const db = (repository as unknown as { db: AppDatabase }).db;
      const ownerProfile = db.prepare("SELECT compact_summary FROM user_profiles WHERE user_id = 1").get();
      const friendProfile = db.prepare("SELECT compact_summary FROM user_profiles WHERE user_id = 2").get() as { compact_summary: string };

      expect(getAccountProfile).toHaveBeenCalledWith("MUSIC_U=friend-profile-sync-cookie");
      expect(importLibrary).toHaveBeenCalledWith("MUSIC_U=friend-profile-sync-cookie");
      expect(result.songs.map((song) => song.neteaseSongId)).toEqual(["friend-sync-profile"]);
      expect(repository.listCandidateSongsForUser(1)).toEqual([]);
      expect(repository.listCandidateSongsForUser(2).map((song) => song.neteaseSongId)).toEqual(["friend-sync-profile"]);
      expect(ownerProfile).toBeUndefined();
      expect(friendProfile.compact_summary).toContain("mood:calm");
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

  it("syncs from the request user and refreshes that user's profile", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    delete process.env.NETEASE_COOKIE;
    resetAppServicesForTests();
    const profileMock = vi.spyOn(NeteaseCloudProvider.prototype, "getAccountProfile").mockResolvedValue({ userId: 2, nickname: "Friend" });
    const importMock = vi.spyOn(NeteaseCloudProvider.prototype, "importLibrary").mockResolvedValue({
      songs: [],
      partialFailures: []
    });

    try {
      const repository = await getMusicRepositoryForApp();
      (repository as unknown as { db: { run: (sql: string) => void } }).db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");
      await saveNeteaseCookie("MUSIC_U=friend-route-sync-cookie", { userId: 2 });
      repository.upsertCandidateSongsForUser(2, [
        {
          ...longFixtureSongs[0],
          neteaseSongId: "friend-existing-sync-profile",
          sources: ["liked"],
          tags: ["ai:tagged", "ai:mood:calm", "ai:scene:focus"]
        }
      ]);

      const response = await syncPost(
        new Request("http://localhost/api/sync", {
          method: "POST",
          headers: { cookie: signedSessionCookie(2) }
        })
      );
      const body = await response.json();
      const profile = (repository as unknown as { db: AppDatabase }).db
        .prepare("SELECT compact_summary FROM user_profiles WHERE user_id = 2")
        .get() as { compact_summary: string };

      expect(response.status).toBe(200);
      expect(body.counts.imported).toBe(0);
      expect(profile.compact_summary).toContain("mood:calm");
    } finally {
      profileMock.mockRestore();
      importMock.mockRestore();
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

  it("uses quick sync for first-use consumers without blocking on AI tagging", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    delete process.env.NETEASE_COOKIE;
    resetAppServicesForTests();
    const importedSongs: CandidateSong[] = [
      {
        ...longFixtureSongs[0],
        neteaseSongId: "friend-quick-sync-song",
        sources: ["liked"],
        tags: ["liked", "playable"]
      }
    ];
    const profileMock = vi.spyOn(NeteaseCloudProvider.prototype, "getAccountProfile").mockResolvedValue({ userId: 2, nickname: "Friend" });
    const importMock = vi.spyOn(NeteaseCloudProvider.prototype, "importLibrary").mockResolvedValue({
      songs: importedSongs,
      partialFailures: []
    });

    try {
      const repository = await getMusicRepositoryForApp();
      const db = (repository as unknown as { db: AppDatabase }).db;
      db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");
      await saveNeteaseCookie("MUSIC_U=friend-quick-sync-cookie", { userId: 2 });

      const response = await syncPost(
        new Request("http://localhost/api/sync?mode=quick", {
          method: "POST",
          headers: { cookie: signedSessionCookie(2) }
        })
      );
      const body = await response.json();
      const queueCounts = new TaggingQueueRepository(db).getCounts();

      expect(response.status).toBe(200);
      expect(profileMock).toHaveBeenCalledWith("MUSIC_U=friend-quick-sync-cookie");
      expect(importMock).toHaveBeenCalledWith("MUSIC_U=friend-quick-sync-cookie", { quick: true, limit: 120 });
      expect(body.counts.imported).toBe(1);
      expect(repository.listCandidateSongsForUser(2)[0].tags).not.toContain("ai:tagged");
      expect(queueCounts.pending).toBe(1);
    } finally {
      profileMock.mockRestore();
      importMock.mockRestore();
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

  it("syncs with the request user's stored NetEase Cookie when no global Cookie exists", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    delete process.env.NETEASE_COOKIE;
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      const db = (repository as unknown as { db: AppDatabase }).db;
      db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");
      await saveNeteaseCookie("MUSIC_U=friend-stored-sync-cookie", { userId: 2 });
      const getAccountProfile = vi.fn(async (cookie: string) => ({ userId: 2, nickname: "Friend", cookie }));
      const importedSongs: CandidateSong[] = [
        {
          ...longFixtureSongs[0],
          neteaseSongId: "friend-stored-cookie-sync",
          sources: ["liked"],
          tags: ["ai:tagged", "ai:mood:calm", "ai:scene:focus"]
        }
      ];
      const importLibrary = vi.fn(async (cookie?: string) => ({
        songs: importedSongs,
        partialFailures: cookie === "MUSIC_U=friend-stored-sync-cookie" ? [] : ["wrong cookie"]
      }));

      const result = await getSyncPreview({
        userId: 2,
        provider: {
          getAccountProfile,
          importLibrary
        }
      });

      expect(getAccountProfile).toHaveBeenCalledWith("MUSIC_U=friend-stored-sync-cookie");
      expect(importLibrary).toHaveBeenCalledWith("MUSIC_U=friend-stored-sync-cookie");
      expect(result.partialFailures).toEqual([]);
      expect(result.songs.map((song) => song.neteaseSongId)).toEqual(["friend-stored-cookie-sync"]);
      expect(repository.listCandidateSongsForUser(2).map((song) => song.neteaseSongId)).toEqual(["friend-stored-cookie-sync"]);
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

  it("marks the selected user's login as expired when Cookie validation fails before sync", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    process.env.NETEASE_COOKIE = "MUSIC_U=expired-sync-cookie";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      const db = (repository as unknown as { db: AppDatabase }).db;
      db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");
      new UserRepository(db).saveLoginState({
        userId: 2,
        provider: "netease",
        encryptedCookie: "local-dev:expired-sync-cookie",
        status: "active",
        source: "cookie"
      });
      const importLibrary = vi.fn(async () => ({ songs: longFixtureSongs.slice(0, 1), partialFailures: [] }));

      await expect(
        getSyncPreview({
          userId: 2,
          provider: {
            async getAccountProfile() {
              throw new Error("401 invalid cookie");
            },
            importLibrary
          }
        })
      ).rejects.toThrow("NetEase login expired");

      const loginState = new UserRepository(db).getLoginState(2, "netease");
      expect(loginState).toEqual(expect.objectContaining({ status: "expired", source: "cookie" }));
      expect(importLibrary).not.toHaveBeenCalled();
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

  it("returns a safe unauthorized sync response when the request user's Cookie has expired", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    process.env.NETEASE_COOKIE = "MUSIC_U=expired-route-sync-cookie";
    resetAppServicesForTests();
    const profileMock = vi.spyOn(NeteaseCloudProvider.prototype, "getAccountProfile").mockRejectedValue(new Error("MUSIC_U=expired-route-sync-cookie is invalid"));
    const importMock = vi.spyOn(NeteaseCloudProvider.prototype, "importLibrary").mockResolvedValue({
      songs: longFixtureSongs.slice(0, 1),
      partialFailures: []
    });

    try {
      const repository = await getMusicRepositoryForApp();
      const db = (repository as unknown as { db: AppDatabase }).db;
      db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");
      new UserRepository(db).saveLoginState({
        userId: 2,
        provider: "netease",
        encryptedCookie: "local-dev:expired-route-sync-cookie",
        status: "active",
        source: "cookie"
      });

      const response = await syncPost(
        new Request("http://localhost/api/sync", {
          method: "POST",
          headers: { cookie: signedSessionCookie(2) }
        })
      );
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body).toEqual({ error: "NetEase login expired. Please scan the QR code again." });
      expect(JSON.stringify(body)).not.toContain("expired-route-sync-cookie");
      expect(new UserRepository(db).getLoginState(2, "netease")).toEqual(expect.objectContaining({ status: "expired" }));
      expect(importMock).not.toHaveBeenCalled();
    } finally {
      profileMock.mockRestore();
      importMock.mockRestore();
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

  it("expands the request user's private library without using another user's seed songs", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    delete process.env.NETEASE_COOKIE;
    resetAppServicesForTests();
    const expandCalls: unknown[] = [];

    try {
      const repository = await getMusicRepositoryForApp();
      const db = (repository as unknown as { db: AppDatabase }).db;
      db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");
      repository.upsertCandidateSongsForUser(1, [{ ...longFixtureSongs[0], neteaseSongId: "owner-expand-seed", sources: ["liked"] }]);
      repository.upsertCandidateSongsForUser(2, [{ ...longFixtureSongs[1], neteaseSongId: "friend-expand-seed", sources: ["liked"] }]);
      await saveNeteaseCookie("MUSIC_U=friend-expand-cookie", { userId: 2 });

      const result = await expandStoredLibrary({
        userId: 2,
        provider: {
          async expandLibrary(options, cookie) {
            expandCalls.push({ options, cookie });
            return {
              songs: cookie === "MUSIC_U=friend-expand-cookie" ? [{ ...longFixtureSongs[2], neteaseSongId: "friend-expanded-song", sources: ["exploration"] }] : [],
              partialFailures: []
            };
          }
        }
      });

      expect(result.songs.map((song) => song.neteaseSongId)).toEqual(["friend-expanded-song"]);
      expect(expandCalls).toEqual([{ options: { seedSongIds: ["friend-expand-seed"], limit: 120 }, cookie: "MUSIC_U=friend-expand-cookie" }]);
      expect(repository.listCandidateSongsForUser(2).map((song) => song.neteaseSongId)).toEqual(
        expect.arrayContaining(["friend-expand-seed", "friend-expanded-song"])
      );
      expect(repository.listCandidateSongsForUser(1).map((song) => song.neteaseSongId)).not.toContain("friend-expanded-song");
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

  it("refreshes a missing user profile before recommendations", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();
    const calls: string[] = [];

    try {
      const repository = await getMusicRepositoryForApp();
      repository.upsertCandidateSongsForUser(1, [
        { ...longFixtureSongs[0], neteaseSongId: "profile-before-recommendation-missing", sources: ["liked"], tags: ["ai:tagged", "ai:mood:calm", "ai:scene:focus"] }
      ]);

      const aiProvider: AiProvider = {
        async summarizePreference(profileData) {
          calls.push(`summarize:${JSON.stringify(profileData)}`);
          return "fresh profile summary";
        },
        async parseListeningContext(input: string, profileSummary: string) {
          calls.push(`parse:${profileSummary}`);
          return {
            scene: "work",
            mood: ["calm"],
            energy: "low" as const,
            vocal: "less_vocal" as const,
            novelty: "balanced" as const,
            avoid: [],
            targetTags: ["scene:focus"],
            excludeTags: []
          };
        },
        async generateReasons() {
          return [];
        },
        async rerankRecommendations(recommendations) {
          return recommendations;
        }
      };

      await createRecommendationResponse("quiet work", undefined, { aiProvider, userId: 1, limit: 1 });

      const savedProfile = (repository as unknown as { db: AppDatabase }).db.prepare("SELECT compact_summary FROM user_profiles WHERE user_id = 1").get() as {
        compact_summary: string;
      };
      expect(savedProfile.compact_summary).toContain("mood:calm");
      expect(calls[0]).toContain("mood:calm");
      expect(calls).toContain("parse:fresh profile summary");
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("refreshes a stale user profile before recommendations", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();
    const calls: string[] = [];

    try {
      const repository = await getMusicRepositoryForApp();
      const db = (repository as unknown as { db: AppDatabase }).db;
      repository.upsertCandidateSongsForUser(1, [
        { ...longFixtureSongs[0], neteaseSongId: "profile-before-recommendation-old", sources: ["liked"], tags: ["ai:tagged", "ai:mood:calm", "ai:scene:focus"] }
      ]);
      await refreshUserProfile(1);
      db.run(
        "UPDATE user_profiles SET profile_json = $json, compact_summary = $summary, last_refreshed_at = '2000-01-01 00:00:00' WHERE user_id = 1",
        {
          $json: JSON.stringify({ positiveTags: [{ key: "genre:metal", weight: 1 }], songCount: 1 }),
          $summary: "likes genre:metal"
        }
      );

      const aiProvider: AiProvider = {
        async summarizePreference(profileData) {
          calls.push(`summarize:${JSON.stringify(profileData)}`);
          return "refreshed profile summary";
        },
        async parseListeningContext(input: string, profileSummary: string) {
          calls.push(`parse:${profileSummary}`);
          return {
            scene: "work",
            mood: ["calm"],
            energy: "low" as const,
            vocal: "less_vocal" as const,
            novelty: "balanced" as const,
            avoid: [],
            targetTags: ["scene:focus"],
            excludeTags: []
          };
        },
        async generateReasons() {
          return [];
        },
        async rerankRecommendations(recommendations) {
          return recommendations;
        }
      };

      await createRecommendationResponse("quiet work", undefined, { aiProvider, userId: 1, limit: 1 });

      expect(calls[0]).toContain("mood:calm");
      expect(calls[0]).not.toContain("genre:metal");
      expect(calls).toContain("parse:refreshed profile summary");
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("exposes admin profile freshness without raw profile detail", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      repository.upsertCandidateSongsForUser(1, [
        { ...longFixtureSongs[0], neteaseSongId: "admin-profile-status-song", sources: ["liked"], tags: ["ai:tagged", "ai:mood:calm", "ai:scene:focus"] }
      ]);
      await refreshUserProfile(1);

      const response = await profileStatusGet(new Request("http://localhost/api/profiles/status"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.profile).toEqual(
        expect.objectContaining({
          exists: true,
          confidence: expect.any(Number),
          stale: false,
          summaryLength: expect.any(Number),
          lastRefreshedAt: expect.any(String)
        })
      );
      expect(JSON.stringify(body)).not.toContain("compactSummary");
      expect(JSON.stringify(body)).not.toContain("mood:calm");
      expect(JSON.stringify(body)).not.toContain("profileJson");
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("blocks non-owner browser sessions from profile diagnostics", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      const db = (repository as unknown as { db: AppDatabase }).db;
      db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");
      repository.upsertCandidateSongsForUser(2, [
        { ...longFixtureSongs[0], neteaseSongId: "friend-profile-diagnostics", sources: ["liked"], tags: ["ai:tagged", "ai:mood:calm"] }
      ]);
      await refreshUserProfile(2);

      const response = await profileStatusGet(
        new Request("http://localhost/api/profiles/status", {
          headers: { cookie: signedSessionCookie(2) }
        })
      );

      expect(response.status).toBe(404);
    } finally {
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
        createRecommendationResponse("鍐欎唬鐮侊紝瀹夐潤锛屽皯浜哄０", { songs: fixtureSongs, partialFailures: [] }, { requireAi: true })
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
        return "Prefers quiet, focused, low-vocal music.";
      },
      async parseListeningContext(input: string, profileSummary: string) {
        calls.push("parseListeningContext:" + input + ":" + profileSummary);
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
            reason: "AI rerank item " + (index + 1),
            breakdown: item.breakdown
          }));
      }
    };

    const response = await createRecommendationResponse("quiet coding focus", { songs: fixtureSongs, partialFailures: [] }, { requireAi: true, aiProvider });

    expect(calls).toEqual([
      "parseListeningContext:mode=balanced\nscene=general\ntext=quiet coding focus:",
      "rerankRecommendations"
    ]);
    expect(response.context.targetTags).toEqual(expect.arrayContaining(["scene:focus", "mood:calm", "vocal:less_vocal"]));
    expect(response.items[0].reason).toBe("AI rerank item 1");
    expect(response.items[0].id).toBe("fixture-8");
  });

  it("uses the AI companion endpoint with current song and lyric context", async () => {
    const calls: unknown[] = [];
    const aiProvider: AiProvider = {
      async parseListeningContext() {
        throw new Error("not used");
      },
      async summarizePreference() {
        throw new Error("not used");
      },
      async generateReasons() {
        throw new Error("not used");
      },
      async chatCompanion(input) {
        calls.push(input);
        return {
          message: "That line feels like walking home after midnight.",
          rawResponse: "{\"message\":\"That line feels like walking home after midnight.\"}"
        };
      }
    };

    const response = await handleChatRequest(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          message: "this lyric hits",
          song: {
            id: "fixture-1",
            name: "Test Song",
            artists: ["Test Artist"],
            album: "Test Album",
            tags: ["ai:mood:calm"]
          },
          currentLyricLine: { time: 42, text: "walking home after midnight" },
          playback: { currentTime: 43, duration: 180 },
          history: [{ role: "companion", text: "I am listening with you." }]
        })
      }),
      { aiProvider }
    );

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toBe("That line feels like walking home after midnight.");
    expect(calls).toEqual([
      expect.objectContaining({
        message: "this lyric hits",
        song: expect.objectContaining({ id: "fixture-1", name: "Test Song" }),
        currentLyricLine: expect.objectContaining({ text: "walking home after midnight" }),
        history: [{ role: "companion", text: "I am listening with you." }]
      })
    ]);
  });

  it("uses the selected user's profile summary for proactive companion prompts without returning profile detail", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();
    const calls: unknown[] = [];

    try {
      const repository = await getMusicRepositoryForApp();
      (repository as unknown as { db: AppDatabase }).db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");
      repository.upsertCandidateSongsForUser(2, [
        { ...longFixtureSongs[0], neteaseSongId: "proactive-profile-song", sources: ["liked"], tags: ["ai:tagged", "ai:mood:calm", "ai:scene:focus"] }
      ]);
      await refreshUserProfile(2);

      const aiProvider: AiProvider = {
        async parseListeningContext() {
          throw new Error("not used");
        },
        async summarizePreference() {
          throw new Error("not used");
        },
        async generateReasons() {
          throw new Error("not used");
        },
        async chatCompanion(input) {
          calls.push(input);
          return {
            message: "The calm focus in this section is doing the work quietly.",
            rawResponse: "{\"message\":\"The calm focus in this section is doing the work quietly.\"}"
          };
        }
      };

      const response = await handleProactiveCompanionRequest(
        new Request("http://localhost/api/companion/proactive", {
          method: "POST",
          headers: { cookie: signedSessionCookie(2) },
          body: JSON.stringify({
            song: {
              id: "proactive-profile-song",
              name: "Profile Song",
              artists: ["Friend Artist"],
              album: "Friend Album",
              tags: ["ai:mood:calm"]
            },
            currentLyricLine: { time: 42, text: "quietly into focus" },
            playback: { currentTime: 45, duration: 120 },
            history: [{ role: "companion", text: "Earlier line." }]
          })
        }),
        { aiProvider }
      );

      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        message: "The calm focus in this section is doing the work quietly.",
        rawResponse: "{\"message\":\"The calm focus in this section is doing the work quietly.\"}"
      });
      expect(JSON.stringify(body)).not.toContain("compactSummary");
      expect(JSON.stringify(body)).not.toContain("positiveTags");
      expect(calls).toEqual([
        expect.objectContaining({
          message: expect.stringContaining("one short, contextual line"),
          song: expect.objectContaining({ id: "proactive-profile-song", name: "Profile Song" }),
          currentLyricLine: expect.objectContaining({ text: "quietly into focus" }),
          playback: { currentTime: 45, duration: 120 },
          history: [{ role: "companion", text: "Earlier line." }]
        })
      ]);
      expect(String((calls[0] as { message: string }).message)).toContain("mood:calm");
      expect(String((calls[0] as { message: string }).message)).not.toContain("friend-profile-rock");
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("allows only the owner browser session to access admin surfaces", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      (repository as unknown as { db: AppDatabase }).db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");

      await expect(canAccessAdmin(new Request("http://localhost/admin"))).resolves.toBe(true);
      await expect(canAccessAdmin(new Request("http://localhost/admin", { headers: { cookie: "ai_music_user=1" } }))).resolves.toBe(false);
      await expect(canAccessAdmin(new Request("http://localhost/admin", { headers: { cookie: "ai_music_user=2" } }))).resolves.toBe(false);
      await expect(canAccessAdmin(new Request("http://localhost/admin", { headers: { cookie: "ai_music_user=999" } }))).resolves.toBe(false);
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("blocks anonymous admin access when invite sessions are configured for deployment", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    const originalInviteCodes = process.env.AI_MUSIC_INVITE_CODES;
    process.env.MUSIC_DB_PATH = ":memory:";
    process.env.AI_MUSIC_INVITE_CODES = "friend-alpha";
    resetAppServicesForTests();

    try {
      expect(await canAccessAdmin(new Request("http://localhost/admin"))).toBe(false);
      expect(await canAccessAdmin(new Request("http://localhost/admin", { headers: { cookie: "ai_music_user=1" } }))).toBe(false);

      const diagnostics = await loginDiagnosticsGet(new Request("http://localhost/api/login/diagnostics"));
      const tagQueue = await tagsQueueGet(new Request("http://localhost/api/tags/queue?limit=1"));
      const profileStatus = await profileStatusGet(new Request("http://localhost/api/profiles/status"));

      expect(diagnostics.status).toBe(404);
      expect(tagQueue.status).toBe(404);
      expect(profileStatus.status).toBe(404);
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      if (originalInviteCodes === undefined) {
        delete process.env.AI_MUSIC_INVITE_CODES;
      } else {
        process.env.AI_MUSIC_INVITE_CODES = originalInviteCodes;
      }
      resetAppServicesForTests();
    }
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
            title: "AI preference summary skipped",
            rawResponse: "",
            parsed: { skipped: true, reason: "Missing user profile; AI preference summary was not called." }
          }
        ];
      },
      async summarizePreference() {
        calls.push("summarizePreference");
        return "should not be called";
      },
      async parseListeningContext(input: string, profileSummary: string) {
        calls.push("parseListeningContext:" + input + ":" + profileSummary);
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

    const response = await createRecommendationResponse("鍐欎唬鐮侊紝瀹夐潤锛屽皯浜哄０", { songs: fixtureSongs, partialFailures: [] }, { requireAi: true, aiProvider });

    expect(calls).toEqual(["parseListeningContext:mode=balanced\nscene=general\ntext=鍐欎唬鐮侊紝瀹夐潤锛屽皯浜哄０:"]);
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
            title: "AI 鎰忓浘瑙ｆ瀽",
            model: "deepseek-chat",
            rawResponse: "{\"scene\":\"work\",\"targetTags\":[\"scene:focus\"]}",
            parsed: { scene: "work", targetTags: ["scene:focus"] }
          },
          {
            id: "rerank-1",
            stage: "rerank",
            title: "AI 鎺ㄨ崘閲嶆帓",
            model: "deepseek-chat",
            rawResponse: "{\"items\":[{\"id\":\"fixture-8\",\"reason\":\"AI 鍘熷鎺ㄨ崘鐞嗙敱\",\"score\":99}]}",
            parsed: { items: [{ id: "fixture-8", reason: "AI 鍘熷鎺ㄨ崘鐞嗙敱", score: 99 }] }
          }
        ];
      },
      async summarizePreference() {
        return "Prefers quiet, focused, low-vocal music.";
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
          reason: "AI raw recommendation reason " + (index + 1)
        }));
      }
    };

    const response = await createRecommendationResponse("鍐欎唬鐮侊紝瀹夐潤锛屽皯浜哄０", { songs: fixtureSongs, partialFailures: [] }, { requireAi: true, aiProvider });
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
        return "Prefers quiet, focused, low-vocal music.";
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
            reason: "AI returned only this item"
          }
        ];
      }
    };

    const response = await createRecommendationResponse("鍐欎唬鐮侊紝瀹夐潤锛屽皯浜哄０", { songs: fixtureSongs, partialFailures: [] }, { requireAi: true, aiProvider, limit: 4 });

    expect(response.items).toHaveLength(4);
    expect(response.flow.ranking.aiSelectedCount).toBe(1);
    expect(response.flow.ranking.localFillCount).toBe(3);
    expect(response.flow.ranking.final[0].selectionSource).toBe("ai");
    expect(response.flow.ranking.final.slice(1).every((song) => song.selectionSource === "local_fill")).toBe(true);
  });

  it("passes mode, scene, and text through the recommendation flow and sends a Top 200 pool to AI", async () => {
    const calls: Array<{ input?: string; recommendations?: RankedRecommendation[] }> = [];
    const aiProvider: AiProvider = {
      async summarizePreference() {
        return "";
      },
      async parseListeningContext(input: string) {
        calls.push({ input });
        return {
          scene: "work_focus",
          mode: "explore",
          mood: ["calm", "focused"],
          energy: "low_to_medium" as const,
          vocal: "less_vocal" as const,
          rhythm: "steady" as const,
          distraction: "low" as const,
          novelty: "explore" as const,
          avoid: ["too_sleepy"],
          targetTags: ["scene:focus", "mood:calm", "vocal:less_vocal"],
          excludeTags: ["distraction:high"],
          familiarRatio: 0.2,
          exploreRatio: 0.5
        };
      },
      async generateReasons() {
        return [];
      },
      async rerankRecommendations(recommendations: RankedRecommendation[]) {
        calls.push({ recommendations });
        return recommendations.slice(0, 50).map((item, index) => ({
          ...item,
          score: 100 - index,
          reason: "AI Top50 item " + (index + 1)
        }));
      }
    };

    const response = await createRecommendationResponse("not too heavy, a little rhythmic", { songs: twoHundredFixtureSongs, partialFailures: [] }, {
      requireAi: true,
      aiProvider,
      limit: 12,
      mode: "explore",
      scene: "work_focus"
    });

    expect(calls[0].input).toContain("mode=explore");
    expect(calls[0].input).toContain("scene=work_focus");
    expect(calls[0].input).toContain("not too heavy, a little rhythmic");
    expect(calls[1].recommendations).toHaveLength(200);
    expect(response.items).toHaveLength(12);
    expect(response.page).toEqual(expect.objectContaining({ requested: 12, returned: 12, aiPoolSize: 50 }));
    expect(response.flow.input).toEqual(expect.objectContaining({ mode: "explore", scene: "work_focus", text: "not too heavy, a little rhythmic" }));
    expect(response.flow.recall?.modeMix).toEqual(
      expect.objectContaining({
        mode: "explore",
        familiarLibraryRatio: 0.2,
        librarySimilarRatio: 0.3,
        neteaseExtensionRatio: 0.5
      })
    );
    expect(response.flow.ranking.localCandidateLimit).toBe(200);
    expect(response.flow.ranking.aiTargetCount).toBe(50);
    expect(response.flow.ranking.aiRerankedCount).toBe(50);
    expect(response.flow.ranking.final).toHaveLength(12);
  });

  it("hard-filters songs that match AI excludeTags and exposes the recommendation flow", async () => {
    const rerankInputIds: string[] = [];
    const songs: CandidateSong[] = [
      {
        ...fixtureSongs[0],
        neteaseSongId: "keep-calm",
        name: "瀹夐潤淇濈暀姝屾洸",
        tags: ["scene:focus", "mood:calm", "energy:low", "vocal:less_vocal", "ai_tagged"]
      },
      {
        ...fixtureSongs[1],
        neteaseSongId: "exclude-high",
        name: "High energy excluded song",
        tags: ["scene:workout", "energy:high", "mood:focused", "ai_tagged"]
      },
      {
        ...fixtureSongs[2],
        neteaseSongId: "keep-soft",
        name: "Soft kept song",
        tags: ["scene:focus", "mood:calm", "energy:medium", "vocal:vocal_ok", "ai_tagged"]
      }
    ];
    const aiProvider: AiProvider = {
      async summarizePreference() {
        return "Prefers quiet focus, avoids high energy songs.";
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
          reason: "AI kept item " + (index + 1)
        }));
      }
    };

    const response = await createRecommendationResponse("quiet coding, remove high energy", { songs, partialFailures: [] }, { requireAi: true, aiProvider, limit: 2 });

    expect(rerankInputIds).not.toContain("exclude-high");
    expect(response.items.map((item) => item.id)).toEqual(["keep-calm", "keep-soft"]);
    expect(response.flow.context.excludeTags).toEqual(["energy:high"]);
    expect(response.flow.filters.excludedByTags).toEqual([
      expect.objectContaining({
        id: "exclude-high",
        name: "High energy excluded song",
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
      neteaseSongId: "batch-" + (index + 1),
      tags: index === 0 ? ["ai:tagged", "ai:scene:focus"] : ["liked", "playable"]
    }));

    expect(selectSongsForAiTagging(songs, 2).map((song) => song.neteaseSongId)).toEqual(["batch-2", "batch-3"]);
  });

  it("uses a larger default AI tagging batch for library backfill", () => {
    const songs = Array.from({ length: 120 }, (_, index) => ({
      ...fixtureSongs[index % fixtureSongs.length],
      neteaseSongId: "default-batch-" + (index + 1),
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

  it("processes pending tagging jobs and writes public AI tags", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      const songId = repository.upsertCandidateSong({
        ...fixtureSongs[0],
        neteaseSongId: "queued-tagging-song",
        tags: ["liked", "playable"]
      });
      const queue = new TaggingQueueRepository((repository as unknown as { db: AppDatabase }).db);
      queue.enqueueMissingTags([songId], "sync");

      const result = await processTaggingQueueBatch({
        limit: 5,
        aiProvider: {
          async summarizePreference() {
            return "";
          },
          async parseListeningContext() {
            throw new Error("not used");
          },
          async generateReasons() {
            return [];
          },
          async rerankRecommendations(recommendations) {
            return recommendations;
          },
          async tagSongs(songs) {
            return songs.map((song) => ({
              ...song,
              tags: [...song.tags, "ai:tagged", "ai:scene:focus"]
            }));
          }
        }
      });

      expect(result).toEqual(expect.objectContaining({ processed: 1, succeeded: 1, failed: 0 }));
      expect(queue.listByStatus("done")).toHaveLength(1);
      expect(repository.listCandidateSongs().find((song) => song.neteaseSongId === "queued-tagging-song")?.tags).toEqual(
        expect.arrayContaining(["ai:tagged", "ai:scene:focus"])
      );
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("caps tag queue processing to the configured batch limit", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    const originalBatchLimit = process.env.TAGGING_QUEUE_BATCH_LIMIT;
    process.env.MUSIC_DB_PATH = ":memory:";
    process.env.TAGGING_QUEUE_BATCH_LIMIT = "2";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      const songIds = Array.from({ length: 5 }, (_, index) =>
        repository.upsertCandidateSong({
          ...fixtureSongs[index % fixtureSongs.length],
          neteaseSongId: "queued-tagging-cap-" + (index + 1),
          tags: ["liked", "playable"]
        })
      );
      const queue = new TaggingQueueRepository((repository as unknown as { db: AppDatabase }).db);
      queue.enqueueMissingTags(songIds, "sync");

      const result = await processTaggingQueueBatch({
        limit: 5,
        aiProvider: {
          async summarizePreference() {
            return "";
          },
          async parseListeningContext() {
            throw new Error("not used");
          },
          async generateReasons() {
            return [];
          },
          async rerankRecommendations(recommendations) {
            return recommendations;
          },
          async tagSongs(songs) {
            return songs.map((song) => ({
              ...song,
              tags: [...song.tags, "ai:tagged", "ai:scene:focus"]
            }));
          }
        }
      });

      expect(result).toEqual(expect.objectContaining({ processed: 2, succeeded: 2, failed: 0 }));
      expect(queue.listByStatus("done")).toHaveLength(2);
      expect(queue.listByStatus("pending")).toHaveLength(3);
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      if (originalBatchLimit === undefined) {
        delete process.env.TAGGING_QUEUE_BATCH_LIMIT;
      } else {
        process.env.TAGGING_QUEUE_BATCH_LIMIT = originalBatchLimit;
      }
      resetAppServicesForTests();
    }
  });

  it("requeues failed tag jobs until the configured max attempts", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    const originalMaxAttempts = process.env.TAGGING_QUEUE_MAX_ATTEMPTS;
    const originalRetryDelay = process.env.TAGGING_QUEUE_RETRY_DELAY_SECONDS;
    process.env.MUSIC_DB_PATH = ":memory:";
    process.env.TAGGING_QUEUE_MAX_ATTEMPTS = "2";
    process.env.TAGGING_QUEUE_RETRY_DELAY_SECONDS = "60";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      const songId = repository.upsertCandidateSong({
        ...fixtureSongs[0],
        neteaseSongId: "queued-tagging-retry-service",
        tags: ["liked", "playable"]
      });
      const queue = new TaggingQueueRepository((repository as unknown as { db: AppDatabase }).db);
      queue.enqueueMissingTags([songId], "sync");

      const result = await processTaggingQueueBatch({
        limit: 1,
        aiProvider: {
          async summarizePreference() {
            return "";
          },
          async parseListeningContext() {
            throw new Error("not used");
          },
          async generateReasons() {
            return [];
          },
          async rerankRecommendations(recommendations) {
            return recommendations;
          },
          async tagSongs(songs) {
            return songs;
          }
        }
      });

      expect(result).toEqual(expect.objectContaining({ processed: 1, succeeded: 0, failed: 1 }));
      expect(queue.listByStatus("failed")).toEqual([]);
      expect(queue.listPending()).toEqual([]);
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      if (originalMaxAttempts === undefined) {
        delete process.env.TAGGING_QUEUE_MAX_ATTEMPTS;
      } else {
        process.env.TAGGING_QUEUE_MAX_ATTEMPTS = originalMaxAttempts;
      }
      if (originalRetryDelay === undefined) {
        delete process.env.TAGGING_QUEUE_RETRY_DELAY_SECONDS;
      } else {
        process.env.TAGGING_QUEUE_RETRY_DELAY_SECONDS = originalRetryDelay;
      }
      resetAppServicesForTests();
    }
  });

  it("exposes a tag queue processing endpoint for admin operations", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const response = await tagsQueueProcessPost(
        new Request("http://localhost/api/tags/queue/process", {
          method: "POST",
          body: JSON.stringify({ limit: 5 })
        })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.counts).toEqual(expect.objectContaining({ processed: 0, succeeded: 0, failed: 0 }));
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("exposes tag queue status for admin operations", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      const doneSongId = repository.upsertCandidateSong({
        ...fixtureSongs[0],
        neteaseSongId: "queue-status-done",
        tags: ["liked", "playable"]
      });
      const pendingSongId = repository.upsertCandidateSong({
        ...fixtureSongs[1],
        neteaseSongId: "queue-status-pending",
        tags: ["liked", "playable"]
      });
      const queue = new TaggingQueueRepository((repository as unknown as { db: AppDatabase }).db);
      queue.enqueueMissingTags([pendingSongId, doneSongId], "sync");
      const [doneJob] = queue.claimPending(1);
      queue.markDone(doneJob.id);
      const stillPendingJob = queue.listPending()[0];

      const response = await tagsQueueGet(new Request("http://localhost/api/tags/queue?limit=10"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.counts).toEqual(expect.objectContaining({ pending: 1, done: 1, processing: 0, failed: 0 }));
      expect(body.jobs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ songId: stillPendingJob.songId, status: "pending" }),
          expect.objectContaining({ songId: doneJob.songId, status: "done" })
        ])
      );
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("blocks non-owner browser sessions from tag queue status", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      (repository as unknown as { db: AppDatabase }).db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");

      const response = await tagsQueueGet(
        new Request("http://localhost/api/tags/queue?limit=10", {
          headers: { cookie: signedSessionCookie(2) }
        })
      );

      expect(response.status).toBe(404);
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("blocks non-owner browser sessions from processing the tag queue", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      (repository as unknown as { db: AppDatabase }).db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");

      const response = await tagsQueueProcessPost(
        new Request("http://localhost/api/tags/queue/process", {
          method: "POST",
          headers: { cookie: signedSessionCookie(2) },
          body: JSON.stringify({ limit: 5 })
        })
      );

      expect(response.status).toBe(404);
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("requires a worker secret before background tag queue processing", async () => {
    const originalSecret = process.env.TAGGING_WORKER_SECRET;
    process.env.TAGGING_WORKER_SECRET = "unit-worker-secret";

    try {
      const missing = await tagWorkerPost(new Request("http://localhost/api/workers/tagging", { method: "POST" }));
      const wrong = await tagWorkerPost(
        new Request("http://localhost/api/workers/tagging", {
          method: "POST",
          headers: { authorization: "Bearer wrong-secret" }
        })
      );

      expect(missing.status).toBe(401);
      expect(wrong.status).toBe(401);
    } finally {
      if (originalSecret === undefined) {
        delete process.env.TAGGING_WORKER_SECRET;
      } else {
        process.env.TAGGING_WORKER_SECRET = originalSecret;
      }
    }
  });

  it("allows a scheduled worker secret to process the tag queue without an admin browser session", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    const originalSecret = process.env.TAGGING_WORKER_SECRET;
    process.env.MUSIC_DB_PATH = ":memory:";
    process.env.TAGGING_WORKER_SECRET = "unit-worker-secret";
    resetAppServicesForTests();

    try {
      const response = await tagWorkerPost(
        new Request("http://localhost/api/workers/tagging", {
          method: "POST",
          headers: { authorization: "Bearer unit-worker-secret" },
          body: JSON.stringify({ limit: 5 })
        })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.counts).toEqual(expect.objectContaining({ processed: 0, succeeded: 0, failed: 0, songs: 0 }));
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      if (originalSecret === undefined) {
        delete process.env.TAGGING_WORKER_SECRET;
      } else {
        process.env.TAGGING_WORKER_SECRET = originalSecret;
      }
      resetAppServicesForTests();
    }
  });

  it("blocks non-owner browser sessions from manual library tagging", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      (repository as unknown as { db: AppDatabase }).db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");

      const response = await tagsPost(
        new Request("http://localhost/api/tags", {
          method: "POST",
          headers: { cookie: signedSessionCookie(2) },
          body: JSON.stringify({ limit: 5 })
        })
      );

      expect(response.status).toBe(404);
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("blocks non-owner browser sessions from login diagnostics", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      (repository as unknown as { db: AppDatabase }).db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");

      const response = await loginDiagnosticsGet(
        new Request("http://localhost/api/login/diagnostics", {
          headers: { cookie: signedSessionCookie(2) }
        })
      );

      expect(response.status).toBe(404);
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("blocks non-owner browser sessions from manually saving cookies", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      const db = (repository as unknown as { db: AppDatabase }).db;
      db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");

      const response = await loginCookiePost(
        new Request("http://localhost/api/login/cookie", {
          method: "POST",
          headers: { cookie: signedSessionCookie(2) },
          body: JSON.stringify({ cookie: "unit_test_friend_manual_cookie_000000000000000000" })
        })
      );

      expect(response.status).toBe(404);
      expect(new UserRepository(db).getLoginState(2, "netease")).toBeNull();
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("blocks non-owner browser sessions from manually expanding the library", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      const db = (repository as unknown as { db: AppDatabase }).db;
      db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");

      const response = await expandPost(
        new Request("http://localhost/api/expand", {
          method: "POST",
          headers: { cookie: signedSessionCookie(2) }
        })
      );

      expect(response.status).toBe(404);
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
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
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    delete process.env.NETEASE_COOKIE;
    delete process.env.NETEASE_USE_REAL_LOGIN;
    resetAppServicesForTests();
    try {
      await expect(getLoginQrPreview()).resolves.toEqual({
        key: "login-unavailable",
        qrUrl: ""
      });
      await expect(getLoginStatusPreview("login-unavailable")).resolves.toEqual({
        status: "waiting"
      });
    } finally {
      if (originalCookie === undefined) {
        delete process.env.NETEASE_COOKIE;
      } else {
        process.env.NETEASE_COOKIE = originalCookie;
      }
      if (originalRealLogin === undefined) {
        delete process.env.NETEASE_USE_REAL_LOGIN;
      } else {
        process.env.NETEASE_USE_REAL_LOGIN = originalRealLogin;
      }
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("marks the login preview as cookie-authorized when a backend Cookie exists", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    process.env.NETEASE_COOKIE = "MUSIC_U=test-cookie";

    await expect(getLoginQrPreview()).resolves.toEqual({
      key: "cookie-login",
      qrUrl: "",
      source: "cookie"
    });
    await expect(getLoginStatusPreview("cookie-login")).resolves.toEqual({
      status: "authorized",
      source: "cookie"
    });

    process.env.NETEASE_COOKIE = originalCookie;
  });

  it("marks QR preview as cookie-authorized for a non-owner user's stored login state", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    delete process.env.NETEASE_COOKIE;
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      const db = (repository as unknown as { db: AppDatabase }).db;
      db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");
      await saveNeteaseCookie("unit_test_friend_qr_preview_cookie_000000000000000000", { userId: 2 });

      const response = await loginQrGet(
        new Request("http://localhost/api/login/qr", {
          headers: { cookie: signedSessionCookie(2) }
        })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        key: "cookie-login",
        qrUrl: "",
        source: "cookie"
      });
      expect(JSON.stringify(body)).not.toContain("unit_test_friend_qr_preview_cookie");
      expect(JSON.stringify(body)).not.toContain("encryptedCookie");
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

  it("does not use the owner backend Cookie for an anonymous QR login preview", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalRealLogin = process.env.NETEASE_USE_REAL_LOGIN;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    process.env.NETEASE_COOKIE = "MUSIC_U=owner-bootstrap-cookie";
    process.env.NETEASE_USE_REAL_LOGIN = "1";
    resetAppServicesForTests();
    const qrMock = vi.spyOn(NeteaseCloudProvider.prototype, "getLoginQr").mockResolvedValue({
      key: "anonymous-qr",
      qrUrl: "data:image/png;base64,anonymous"
    });

    try {
      const response = await loginQrGet(new Request("http://localhost/api/login/qr"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        key: "anonymous-qr",
        qrUrl: "data:image/png;base64,anonymous"
      });
      expect(qrMock).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(body)).not.toContain("MUSIC_U=owner-bootstrap-cookie");
      expect(JSON.stringify(body)).not.toContain("encryptedCookie");
      expect(JSON.stringify(body)).not.toContain("rawCookie");
    } finally {
      qrMock.mockRestore();
      if (originalCookie === undefined) {
        delete process.env.NETEASE_COOKIE;
      } else {
        process.env.NETEASE_COOKIE = originalCookie;
      }
      if (originalRealLogin === undefined) {
        delete process.env.NETEASE_USE_REAL_LOGIN;
      } else {
        process.env.NETEASE_USE_REAL_LOGIN = originalRealLogin;
      }
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
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
      expect(normalizeNeteaseCookie(token)).toBe("MUSIC_U=" + token);
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

  it("persists manually saved NetEase cookies into the default owner's login state", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    const token = "unit_test_owner_login_state_token_000000000000000000000000";
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      await expect(saveNeteaseCookie(token)).resolves.toEqual({
        ok: true,
        status: "authorized",
        source: "cookie"
      });

      const repository = await getMusicRepositoryForApp();
      const users = new UserRepository((repository as unknown as { db: AppDatabase }).db);

      expect(users.getLoginState(1, "netease")).toEqual(
        expect.objectContaining({
          userId: 1,
          provider: "netease",
          encryptedCookie: expect.stringMatching(/^local-dev:/),
          status: "active",
          source: "cookie"
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

  it("persists manually saved NetEase cookies from an owner browser session", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      const db = (repository as unknown as { db: AppDatabase }).db;

      const response = await loginCookiePost(
        new Request("http://localhost/api/login/cookie", {
          method: "POST",
          headers: { cookie: signedSessionCookie(1) },
          body: JSON.stringify({ cookie: "unit_test_owner_browser_login_cookie_000000000000000000" })
        })
      );
      const body = await response.json();
      const users = new UserRepository(db);

      expect(response.status).toBe(200);
      expect(body).toEqual({ ok: true, status: "authorized", source: "cookie" });
      expect(users.getLoginState(1, "netease")).toEqual(
        expect.objectContaining({
          userId: 1,
          provider: "netease",
          encryptedCookie: expect.stringMatching(/^local-dev:/),
          status: "active",
          source: "cookie"
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

  it("persists non-owner NetEase cookies without replacing the global bootstrap Cookie", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    process.env.NETEASE_COOKIE = "MUSIC_U=owner-bootstrap-cookie";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      const db = (repository as unknown as { db: AppDatabase }).db;
      db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");

      const result = await saveNeteaseCookie("unit_test_friend_browser_login_cookie_000000000000000000", { userId: 2 });
      const users = new UserRepository(db);

      expect(result).toEqual({ ok: true, status: "authorized", source: "cookie" });
      expect(process.env.NETEASE_COOKIE).toBe("MUSIC_U=owner-bootstrap-cookie");
      expect(users.getLoginState(2, "netease")).toEqual(
        expect.objectContaining({
          userId: 2,
          provider: "netease",
          encryptedCookie: expect.stringMatching(/^local-dev:/),
          status: "active",
          source: "cookie"
        })
      );
      expect(users.getLoginState(1, "netease")).toBeNull();
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

  it("persists QR-authorized NetEase cookies into the default owner's login state", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    const originalRealLogin = process.env.NETEASE_USE_REAL_LOGIN;
    process.env.MUSIC_DB_PATH = ":memory:";
    process.env.NETEASE_USE_REAL_LOGIN = "1";
    delete process.env.NETEASE_COOKIE;
    resetAppServicesForTests();

    try {
      await expect(
        getLoginStatusPreview("qr-key", true, {
          async getLoginStatus() {
            return {
              status: "authorized",
              encryptedCookie: "provider-summary",
              rawCookie: "MUSIC_U=qr-owner-login-state-token",
              source: "qr"
            };
          }
        })
      ).resolves.toEqual({
        status: "authorized",
        source: "qr"
      });

      const repository = await getMusicRepositoryForApp();
      const users = new UserRepository((repository as unknown as { db: AppDatabase }).db);

      expect(users.getLoginState(1, "netease")).toEqual(
        expect.objectContaining({
          userId: 1,
          provider: "netease",
          encryptedCookie: expect.stringMatching(/^local-dev:/),
          status: "active",
          source: "qr"
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
      if (originalRealLogin === undefined) {
        delete process.env.NETEASE_USE_REAL_LOGIN;
      } else {
        process.env.NETEASE_USE_REAL_LOGIN = originalRealLogin;
      }
      resetAppServicesForTests();
    }
  });

  it("persists QR-authorized NetEase cookies into the request user's login state", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    const originalRealLogin = process.env.NETEASE_USE_REAL_LOGIN;
    process.env.MUSIC_DB_PATH = ":memory:";
    process.env.NETEASE_USE_REAL_LOGIN = "1";
    process.env.NETEASE_COOKIE = "MUSIC_U=owner-bootstrap-cookie";
    resetAppServicesForTests();
    const statusMock = vi.spyOn(NeteaseCloudProvider.prototype, "getLoginStatus").mockResolvedValue({
      status: "authorized",
      encryptedCookie: "provider-summary",
      rawCookie: "MUSIC_U=qr-friend-login-state-token",
      source: "qr"
    });

    try {
      const repository = await getMusicRepositoryForApp();
      const db = (repository as unknown as { db: AppDatabase }).db;
      db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");

      const response = await loginStatusGet(
        new Request("http://localhost/api/login/status?key=qr-key&force=1", {
          headers: { cookie: signedSessionCookie(2) }
        })
      );
      const body = await response.json();
      const users = new UserRepository(db);

      expect(response.status).toBe(200);
      expect(body).toEqual({
        status: "authorized",
        source: "qr"
      });
      expect(JSON.stringify(body)).not.toContain("encryptedCookie");
      expect(JSON.stringify(body)).not.toContain("rawCookie");
      expect(JSON.stringify(body)).not.toContain("qr-friend-login-state-token");
      expect(process.env.NETEASE_COOKIE).toBe("MUSIC_U=owner-bootstrap-cookie");
      expect(users.getLoginState(2, "netease")).toEqual(
        expect.objectContaining({
          userId: 2,
          provider: "netease",
          encryptedCookie: expect.stringMatching(/^local-dev:/),
          status: "active",
          source: "qr"
        })
      );
      expect(users.getLoginState(1, "netease")).toBeNull();
    } finally {
      statusMock.mockRestore();
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
      if (originalRealLogin === undefined) {
        delete process.env.NETEASE_USE_REAL_LOGIN;
      } else {
        process.env.NETEASE_USE_REAL_LOGIN = originalRealLogin;
      }
      resetAppServicesForTests();
    }
  });

  it("does not authorize a new user's QR polling from the owner backend Cookie", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    const originalRealLogin = process.env.NETEASE_USE_REAL_LOGIN;
    process.env.MUSIC_DB_PATH = ":memory:";
    process.env.NETEASE_USE_REAL_LOGIN = "1";
    process.env.NETEASE_COOKIE = "MUSIC_U=owner-bootstrap-cookie";
    resetAppServicesForTests();
    const statusMock = vi.spyOn(NeteaseCloudProvider.prototype, "getLoginStatus").mockResolvedValue({
      status: "waiting"
    });

    try {
      const repository = await getMusicRepositoryForApp();
      const db = (repository as unknown as { db: AppDatabase }).db;
      db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");

      const response = await loginStatusGet(
        new Request("http://localhost/api/login/status?key=qr-key", {
          headers: { cookie: signedSessionCookie(2) }
        })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ status: "waiting" });
      expect(statusMock).toHaveBeenCalledWith("qr-key");
      expect(process.env.NETEASE_COOKIE).toBe("MUSIC_U=owner-bootstrap-cookie");
    } finally {
      statusMock.mockRestore();
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
      if (originalRealLogin === undefined) {
        delete process.env.NETEASE_USE_REAL_LOGIN;
      } else {
        process.env.NETEASE_USE_REAL_LOGIN = originalRealLogin;
      }
      resetAppServicesForTests();
    }
  });

  it("does not authorize anonymous QR polling from the owner backend Cookie", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    const originalRealLogin = process.env.NETEASE_USE_REAL_LOGIN;
    process.env.MUSIC_DB_PATH = ":memory:";
    process.env.NETEASE_USE_REAL_LOGIN = "1";
    process.env.NETEASE_COOKIE = "MUSIC_U=owner-bootstrap-cookie";
    resetAppServicesForTests();
    const statusMock = vi.spyOn(NeteaseCloudProvider.prototype, "getLoginStatus").mockResolvedValue({
      status: "waiting"
    });

    try {
      const response = await loginStatusGet(new Request("http://localhost/api/login/status?key=anonymous-qr"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({ status: "waiting" });
      expect(statusMock).toHaveBeenCalledWith("anonymous-qr");
      expect(process.env.NETEASE_COOKIE).toBe("MUSIC_U=owner-bootstrap-cookie");
    } finally {
      statusMock.mockRestore();
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
      if (originalRealLogin === undefined) {
        delete process.env.NETEASE_USE_REAL_LOGIN;
      } else {
        process.env.NETEASE_USE_REAL_LOGIN = originalRealLogin;
      }
      resetAppServicesForTests();
    }
  });

  it("does not persist anonymous QR authorization into the owner login state", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    const originalRealLogin = process.env.NETEASE_USE_REAL_LOGIN;
    process.env.MUSIC_DB_PATH = ":memory:";
    process.env.NETEASE_USE_REAL_LOGIN = "1";
    process.env.NETEASE_COOKIE = "MUSIC_U=owner-bootstrap-cookie";
    resetAppServicesForTests();
    const statusMock = vi.spyOn(NeteaseCloudProvider.prototype, "getLoginStatus").mockResolvedValue({
      status: "authorized",
      encryptedCookie: "provider-summary",
      rawCookie: "MUSIC_U=anonymous-qr-cookie",
      source: "qr"
    });

    try {
      const response = await loginStatusGet(new Request("http://localhost/api/login/status?key=anonymous-qr"));
      const body = await response.json();
      const repository = await getMusicRepositoryForApp();
      const users = new UserRepository((repository as unknown as { db: AppDatabase }).db);

      expect(response.status).toBe(200);
      expect(body).toEqual({ status: "waiting" });
      expect(process.env.NETEASE_COOKIE).toBe("MUSIC_U=owner-bootstrap-cookie");
      expect(users.getLoginState(1, "netease")).toBeNull();
    } finally {
      statusMock.mockRestore();
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
      if (originalRealLogin === undefined) {
        delete process.env.NETEASE_USE_REAL_LOGIN;
      } else {
        process.env.NETEASE_USE_REAL_LOGIN = originalRealLogin;
      }
      resetAppServicesForTests();
    }
  });

  it("syncs a pure new user's library after QR authorization without using the owner Cookie", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    const originalRealLogin = process.env.NETEASE_USE_REAL_LOGIN;
    process.env.MUSIC_DB_PATH = ":memory:";
    process.env.NETEASE_USE_REAL_LOGIN = "1";
    process.env.NETEASE_COOKIE = "MUSIC_U=owner-bootstrap-cookie";
    resetAppServicesForTests();
    const statusMock = vi.spyOn(NeteaseCloudProvider.prototype, "getLoginStatus").mockResolvedValue({
      status: "authorized",
      encryptedCookie: "provider-summary",
      rawCookie: "MUSIC_U=qr-new-user-sync-cookie",
      source: "qr"
    });
    const profileMock = vi.spyOn(NeteaseCloudProvider.prototype, "getAccountProfile").mockImplementation(async (cookie?: string) => {
      if (cookie !== "MUSIC_U=qr-new-user-sync-cookie") throw new Error("wrong sync cookie");
      return { userId: 2, nickname: "Friend" };
    });
    const importMock = vi.spyOn(NeteaseCloudProvider.prototype, "importLibrary").mockImplementation(async (cookie?: string) => {
      if (cookie !== "MUSIC_U=qr-new-user-sync-cookie") {
        return { songs: [], partialFailures: ["wrong sync cookie"] };
      }
      return {
        songs: [{ ...longFixtureSongs[0], neteaseSongId: "qr-new-user-private-song", sources: ["liked"], tags: ["liked", "playback:playable"] }],
        partialFailures: []
      };
    });

    try {
      const repository = await getMusicRepositoryForApp();
      const db = (repository as unknown as { db: AppDatabase }).db;
      db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");

      const loginResponse = await loginStatusGet(
        new Request("http://localhost/api/login/status?key=qr-key&force=1", {
          headers: { cookie: signedSessionCookie(2) }
        })
      );
      const syncResponse = await syncPost(
        new Request("http://localhost/api/sync", {
          method: "POST",
          headers: { cookie: signedSessionCookie(2) }
        })
      );
      const syncBody = await syncResponse.json();

      expect(loginResponse.status).toBe(200);
      expect(await loginResponse.json()).toEqual({ status: "authorized", source: "qr" });
      expect(syncResponse.status).toBe(200);
      expect(syncBody.counts).toEqual(expect.objectContaining({ songs: 1, imported: 1, playableSongs: 1 }));
      expect(JSON.stringify(syncBody)).not.toContain("qr-new-user-sync-cookie");
      expect(profileMock).toHaveBeenCalledWith("MUSIC_U=qr-new-user-sync-cookie");
      expect(importMock).toHaveBeenCalledWith("MUSIC_U=qr-new-user-sync-cookie");
      expect(process.env.NETEASE_COOKIE).toBe("MUSIC_U=owner-bootstrap-cookie");
      expect(repository.listCandidateSongsForUser(2).map((song) => song.neteaseSongId)).toEqual(["qr-new-user-private-song"]);
      expect(repository.listCandidateSongsForUser(1).map((song) => song.neteaseSongId)).not.toContain("qr-new-user-private-song");
    } finally {
      statusMock.mockRestore();
      profileMock.mockRestore();
      importMock.mockRestore();
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
      if (originalRealLogin === undefined) {
        delete process.env.NETEASE_USE_REAL_LOGIN;
      } else {
        process.env.NETEASE_USE_REAL_LOGIN = originalRealLogin;
      }
      resetAppServicesForTests();
    }
  });

  it("marks the selected user's NetEase login state as expired without exposing stored credentials", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      await saveNeteaseCookie("unit_test_expiring_owner_cookie_000000000000000000");

      await expect(getCurrentUserLoginStatus(new Request("http://localhost/api/login/state"))).resolves.toEqual({
        provider: "netease",
        status: "active",
        source: "cookie",
        lastVerifiedAt: expect.any(String)
      });

      await expect(markUserLoginExpired(new Request("http://localhost/api/login/state"), "manual-expiry-test")).resolves.toEqual({
        provider: "netease",
        status: "expired",
        source: "cookie",
        reason: "manual-expiry-test"
      });

      const safeState = await getCurrentUserLoginStatus(new Request("http://localhost/api/login/state"));
      expect(safeState).toEqual({
        provider: "netease",
        status: "expired",
        source: "cookie",
        lastVerifiedAt: expect.any(String)
      });
      expect(JSON.stringify(safeState)).not.toContain("encryptedCookie");
      expect(JSON.stringify(safeState)).not.toContain("unit_test_expiring_owner_cookie");
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

  it("exposes the current user's safe login state through an API route", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      await saveNeteaseCookie("unit_test_login_state_route_cookie_000000000000000");
      await markUserLoginExpired(new Request("http://localhost/api/login/state"), "route-expiry-test");

      const response = await loginStateGet(new Request("http://localhost/api/login/state"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.login).toEqual({
        provider: "netease",
        status: "expired",
        source: "cookie",
        lastVerifiedAt: expect.any(String)
      });
      expect(JSON.stringify(body)).not.toContain("encryptedCookie");
      expect(JSON.stringify(body)).not.toContain("unit_test_login_state_route_cookie");
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

  it("does not expose another user's login state through the safe login route", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const repository = await getMusicRepositoryForApp();
      const db = (repository as unknown as { db: AppDatabase }).db;
      db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");
      new UserRepository(db).saveLoginState({
        userId: 1,
        provider: "netease",
        encryptedCookie: "local-dev:owner-secret-summary",
        status: "active",
        source: "qr"
      });

      const response = await loginStateGet(
        new Request("http://localhost/api/login/state", {
          headers: { cookie: signedSessionCookie(2) }
        })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.login).toEqual({
        provider: "netease",
        status: "missing",
        source: null,
        lastVerifiedAt: null
      });
      expect(JSON.stringify(body)).not.toContain("owner-secret-summary");
      expect(JSON.stringify(body)).not.toContain("encryptedCookie");
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

  it("creates or reuses a lightweight browser session from an invite code", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const first = await sessionPost(
        new Request("http://localhost/api/session", {
          method: "POST",
          body: JSON.stringify({ inviteCode: "friend-alpha", nickname: "Friend Alpha" })
        })
      );
      const firstBody = await first.json();

      expect(first.status).toBe(200);
      expect(firstBody.user).toEqual(expect.objectContaining({ handle: "invite_friend-alpha", nickname: "Friend Alpha" }));
      expect(first.headers.get("set-cookie")).toContain("ai_music_user=v1." + firstBody.user.id + ".");

      const second = await sessionPost(
        new Request("http://localhost/api/session", {
          method: "POST",
          body: JSON.stringify({ inviteCode: "friend-alpha", nickname: "Renamed" })
        })
      );
      const secondBody = await second.json();

      expect(second.status).toBe(200);
      expect(secondBody.user.id).toBe(firstBody.user.id);
      expect(second.headers.get("set-cookie")).toContain("ai_music_user=v1." + firstBody.user.id + ".");
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("creates distinct anonymous browser sessions for first-use consumers", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const first = await sessionPost(
        new Request("http://localhost/api/session", {
          method: "POST",
          body: JSON.stringify({})
        })
      );
      const second = await sessionPost(
        new Request("http://localhost/api/session", {
          method: "POST",
          body: JSON.stringify({})
        })
      );
      const firstBody = await first.json();
      const secondBody = await second.json();

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(firstBody.user.id).not.toBe(secondBody.user.id);
      expect(firstBody.user.handle).toMatch(/^anon_/);
      expect(first.headers.get("set-cookie")).toContain("ai_music_user=v1." + firstBody.user.id + ".");
      expect(second.headers.get("set-cookie")).toContain("ai_music_user=v1." + secondBody.user.id + ".");
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("reuses an existing signed anonymous browser session", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    resetAppServicesForTests();

    try {
      const first = await sessionPost(
        new Request("http://localhost/api/session", {
          method: "POST",
          body: JSON.stringify({})
        })
      );
      const firstBody = await first.json();
      const cookie = first.headers.get("set-cookie")?.split(";")[0] ?? "";
      const second = await sessionPost(
        new Request("http://localhost/api/session", {
          method: "POST",
          headers: { cookie },
          body: JSON.stringify({})
        })
      );
      const secondBody = await second.json();

      expect(second.status).toBe(200);
      expect(secondBody.user.id).toBe(firstBody.user.id);
      expect(second.headers.get("set-cookie")).toContain("ai_music_user=v1." + firstBody.user.id + ".");
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("sets Secure on browser session cookies in production", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    process.env.MUSIC_DB_PATH = ":memory:";
    vi.stubEnv("NODE_ENV", "production");
    resetAppServicesForTests();

    try {
      const response = await sessionPost(
        new Request("https://music.example/api/session", {
          method: "POST",
          body: JSON.stringify({ inviteCode: "friend-secure", nickname: "Friend Secure" })
        })
      );
      const setCookie = response.headers.get("set-cookie") ?? "";

      expect(response.status).toBe(200);
      expect(setCookie).toContain("ai_music_user=");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Lax");
      expect(setCookie).toContain("Secure");
    } finally {
      vi.unstubAllEnvs();
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      resetAppServicesForTests();
    }
  });

  it("accepts browser sessions only from configured invite codes when an allowlist is set", async () => {
    const originalDbPath = process.env.MUSIC_DB_PATH;
    const originalInviteCodes = process.env.AI_MUSIC_INVITE_CODES;
    process.env.MUSIC_DB_PATH = ":memory:";
    process.env.AI_MUSIC_INVITE_CODES = "friend-alpha, beta-user";
    resetAppServicesForTests();

    try {
      const accepted = await sessionPost(
        new Request("http://localhost/api/session", {
          method: "POST",
          body: JSON.stringify({ inviteCode: " friend-alpha ", nickname: "Friend Alpha" })
        })
      );
      const acceptedBody = await accepted.json();

      expect(accepted.status).toBe(200);
      expect(acceptedBody.user).toEqual(expect.objectContaining({ handle: "invite_friend-alpha", nickname: "Friend Alpha" }));
      expect(accepted.headers.get("set-cookie")).toContain("ai_music_user=v1." + acceptedBody.user.id + ".");

      const rejected = await sessionPost(
        new Request("http://localhost/api/session", {
          method: "POST",
          body: JSON.stringify({ inviteCode: "stranger", nickname: "Stranger" })
        })
      );
      const rejectedBody = await rejected.json();

      expect(rejected.status).toBe(403);
      expect(rejectedBody).toEqual({ error: "Invite code is not allowed." });
      expect(rejected.headers.get("set-cookie")).toBeNull();
    } finally {
      if (originalDbPath === undefined) {
        delete process.env.MUSIC_DB_PATH;
      } else {
        process.env.MUSIC_DB_PATH = originalDbPath;
      }
      if (originalInviteCodes === undefined) {
        delete process.env.AI_MUSIC_INVITE_CODES;
      } else {
        process.env.AI_MUSIC_INVITE_CODES = originalInviteCodes;
      }
      resetAppServicesForTests();
    }
  });

  it("uses Chinese app metadata", () => {
    expect(metadata.title).toBe("AI 私人歌单");
    expect(metadata.description).toContain("网易云");
  });

  it("does not expose Cookie token previews from login diagnostics", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    process.env.NETEASE_COOKIE = "MUSIC_U=owner-secret-token; __csrf=csrf-token; NMTID=nmtid-token";
    const profileMock = vi.spyOn(NeteaseCloudProvider.prototype, "getAccountProfile").mockResolvedValue({ userId: 1, nickname: "Owner" });

    try {
      const response = await loginDiagnosticsGet(new Request("http://localhost/api/login/diagnostics"));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(JSON.stringify(body)).not.toContain("MUSIC_U");
      expect(JSON.stringify(body)).not.toContain("__csrf");
      expect(JSON.stringify(body)).not.toContain("owner-secret-token");
      expect(JSON.stringify(body)).not.toContain("nmtid-token");
      expect(body).toMatchObject({ configured: true, valid: true, cookiePreview: "" });
    } finally {
      profileMock.mockRestore();
      if (originalCookie === undefined) {
        delete process.env.NETEASE_COOKIE;
      } else {
        process.env.NETEASE_COOKIE = originalCookie;
      }
    }
  });

  it("declares the QR code dependency used by real NetEase login", () => {
    expect(packageJson.dependencies).toHaveProperty("qrcode");
  });
});

const fixtureSongs: CandidateSong[] = Array.from({ length: 8 }, (_, index) => ({
  neteaseSongId: "fixture-" + (index + 1),
  name: "Test Song " + (index + 1),
  artistNames: ["Artist " + (index + 1)],
  albumName: "Test Album",
  coverUrl: null,
  streamUrl: "https://music.example/" + (index + 1) + ".mp3",
  durationMs: 180000,
  popularity: 70,
  sources: index % 2 === 0 ? ["liked"] : ["playlist"],
  tags: ["calm", "focused"],
  recentPlayCount: 0,
  daysSinceLastPlayed: 30,
  feedback: []
}));

const longFixtureSongs: CandidateSong[] = Array.from({ length: 24 }, (_, index) => ({
  neteaseSongId: "long-fixture-" + (index + 1),
  name: "Long Test Song " + (index + 1),
  artistNames: ["Long Artist " + (index + 1)],
  albumName: "Long Test Album",
  coverUrl: null,
  streamUrl: "https://music.example/long-" + (index + 1) + ".mp3",
  durationMs: 180000,
  popularity: 70,
  sources: index % 3 === 0 ? ["liked"] : index % 3 === 1 ? ["playlist"] : ["exploration"],
  tags: index % 2 === 0 ? ["scene:focus", "mood:calm", "vocal:less_vocal", "ai_tagged"] : ["scene:focus", "mood:focused", "vocal:vocal_ok", "ai_tagged"],
  recentPlayCount: 0,
  daysSinceLastPlayed: 30 + index,
  feedback: []
}));

const twoHundredFixtureSongs: CandidateSong[] = Array.from({ length: 240 }, (_, index) => {
  const source = index % 5 === 0 ? "exploration" : index % 5 === 1 ? "netease_similar_song" : index % 5 === 2 ? "playlist" : "liked";
  return {
    neteaseSongId: "pool-" + (index + 1),
    name: "Pool Song " + (index + 1),
    artistNames: ["Pool Artist " + (index + 1)],
    albumName: "Pool Album",
    coverUrl: null,
    streamUrl: "https://music.example/pool-" + (index + 1) + ".mp3",
    durationMs: 180000,
    popularity: 60 + (index % 30),
    sources: [source as CandidateSong["sources"][number]],
    tags: ["ai:tagged", "ai:scene:focus", "ai:mood:calm", "ai:vocal:less_vocal", "ai:rhythm:steady", "ai:distraction:low"],
    recentPlayCount: 0,
    daysSinceLastPlayed: 10 + index,
    feedback: []
  };
});

function signedSessionCookie(userId: number) {
  return `ai_music_user=${createSessionCookieValue(userId)}`;
}
