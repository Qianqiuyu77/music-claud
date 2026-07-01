import { describe, expect, it } from "vitest";
import { createDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/schema";
import { MusicRepository } from "@/lib/repositories/musicRepository";
import { RecommendationRepository } from "@/lib/repositories/recommendationRepository";
import { TaggingQueueRepository } from "@/lib/repositories/taggingQueueRepository";
import { UserProfileRepository } from "@/lib/repositories/userProfileRepository";
import { UserRepository } from "@/lib/repositories/userRepository";
import { buildUserProfile } from "@/lib/profile/userProfileBuilder";
import { isOwnerUser, resolveCurrentUser } from "@/lib/user/currentUser";
import { createSessionCookieValue } from "@/lib/user/sessionCookie";
import type { CandidateSong } from "@/lib/recommendation/types";

describe("repositories", () => {
  it("creates a default owner user and user-private isolation tables", async () => {
    const db = await createDatabase(":memory:");
    migrate(db);

    const user = db.prepare("SELECT * FROM users WHERE id = 1").get() as { id: number; handle: string } | undefined;
    const privateTables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('user_login_states','user_song_sources','user_song_events','user_profiles')")
      .all() as Array<{ name: string }>;

    expect(user).toEqual(expect.objectContaining({ id: 1, handle: "owner" }));
    expect(privateTables.map((row) => row.name).sort()).toEqual(["user_login_states", "user_profiles", "user_song_events", "user_song_sources"]);
  });

  it("resolves the default owner user without exposing login credentials", async () => {
    const db = await createDatabase(":memory:");
    migrate(db);
    const users = new UserRepository(db);

    const owner = users.getDefaultOwner();
    users.saveLoginState({
      userId: owner.id,
      provider: "netease",
      encryptedCookie: "local-dev:secret",
      status: "active",
      source: "qr"
    });

    expect(owner).toEqual({ id: 1, handle: "owner", nickname: "Owner" });
    expect(users.getLoginState(owner.id, "netease")).toEqual(
      expect.objectContaining({
        userId: owner.id,
        provider: "netease",
        encryptedCookie: "local-dev:secret",
        status: "active",
        source: "qr"
      })
    );
  });

  it("resolves browser session cookies without falling back to owner for unknown users", async () => {
    const db = await createDatabase(":memory:");
    migrate(db);
    db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");

    expect(resolveCurrentUser(db)).toEqual(expect.objectContaining({ id: 1, handle: "owner" }));
    expect(resolveCurrentUser(db, new Request("http://localhost", { headers: { cookie: signedSessionCookie(2) } }))).toEqual(
      expect.objectContaining({ id: 2, handle: "friend" })
    );
    expect(resolveCurrentUser(db, new Request("http://localhost", { headers: { cookie: "ai_music_user=999" } }))).toEqual(
      expect.objectContaining({ id: 0, handle: "unknown" })
    );
  });

  it("binds and finds users by NetEase user id", async () => {
    const db = await createDatabase(":memory:");
    migrate(db);
    const users = new UserRepository(db);
    db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', null)");

    users.bindNeteaseAccount(2, "163001", "Friend From NetEase");

    expect(users.findByNeteaseUserId("163001")).toEqual({
      id: 2,
      handle: "friend",
      nickname: "Friend From NetEase"
    });
  });

  it("treats only the default owner as an admin user", async () => {
    const db = await createDatabase(":memory:");
    migrate(db);
    db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");

    expect(isOwnerUser(resolveCurrentUser(db))).toBe(true);
    expect(isOwnerUser(resolveCurrentUser(db, new Request("http://localhost", { headers: { cookie: signedSessionCookie(2) } })))).toBe(false);
  });

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

  it("shares public song rows while isolating sources, feedback, and playback by user", async () => {
    const db = await createDatabase(":memory:");
    migrate(db);
    const music = new MusicRepository(db);

    db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");

    const songId = music.upsertCandidateSong({
      neteaseSongId: "shared-song-1",
      name: "Shared Song",
      artistNames: ["Shared Artist"],
      artistIds: [],
      albumName: "Shared Album",
      coverUrl: null,
      streamUrl: "https://music.example/shared.mp3",
      durationMs: 180000,
      popularity: 80,
      sources: [],
      tags: ["ai:tagged", "ai:mood:calm"],
      recentPlayCount: 0,
      daysSinceLastPlayed: null,
      feedback: []
    });

    music.addUserSongSource({ userId: 1, songId, source: "liked" });
    music.addUserSongSource({ userId: 2, songId, source: "playlist" });
    music.recordFeedbackByNeteaseSongIdForUser(1, "shared-song-1", "like");
    music.recordPlaybackByNeteaseSongIdForUser(2, "shared-song-1", {
      playedSeconds: 90,
      durationSeconds: 180,
      completed: false
    });

    expect(music.listCandidateSongsForUser(1)[0]).toEqual(expect.objectContaining({ sources: ["liked"], feedback: ["like"] }));
    expect(music.listCandidateSongsForUser(2)[0]).toEqual(expect.objectContaining({ sources: ["playlist"], feedback: [] }));
    expect(music.listLatestPlaybackByNeteaseSongIdsForUser(1, ["shared-song-1"]).has("shared-song-1")).toBe(false);
    expect(music.listLatestPlaybackByNeteaseSongIdsForUser(2, ["shared-song-1"]).has("shared-song-1")).toBe(true);
    expect(music.listSongs()).toHaveLength(1);
  });

  it("stores user profiles separately and builds them from one user's private signals", async () => {
    const db = await createDatabase(":memory:");
    migrate(db);
    const music = new MusicRepository(db);
    const profiles = new UserProfileRepository(db);

    db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");

    const calmSongId = music.upsertCandidateSong({
      neteaseSongId: "profile-calm-song",
      name: "Profile Calm Song",
      artistNames: ["Quiet Artist"],
      artistIds: [],
      albumName: "Calm Album",
      coverUrl: null,
      streamUrl: "https://music.example/profile-calm.mp3",
      durationMs: 180000,
      popularity: 80,
      sources: [],
      tags: ["ai:tagged", "ai:mood:calm", "ai:scene:focus", "ai:genre:folk"],
      recentPlayCount: 0,
      daysSinceLastPlayed: null,
      feedback: []
    });
    const loudSongId = music.upsertCandidateSong({
      neteaseSongId: "profile-loud-song",
      name: "Profile Loud Song",
      artistNames: ["Loud Artist"],
      artistIds: [],
      albumName: "Loud Album",
      coverUrl: null,
      streamUrl: "https://music.example/profile-loud.mp3",
      durationMs: 180000,
      popularity: 80,
      sources: [],
      tags: ["ai:tagged", "ai:mood:bright", "ai:energy:high", "ai:genre:rock"],
      recentPlayCount: 0,
      daysSinceLastPlayed: null,
      feedback: []
    });

    music.addUserSongSource({ userId: 1, songId: calmSongId, source: "liked" });
    music.addUserSongSource({ userId: 2, songId: loudSongId, source: "liked" });
    music.recordFeedbackByNeteaseSongIdForUser(1, "profile-calm-song", "more_like_this");
    music.recordFeedbackByNeteaseSongIdForUser(2, "profile-loud-song", "dislike");

    const ownerProfile = buildUserProfile(1, music.listCandidateSongsForUser(1));
    const friendProfile = buildUserProfile(2, music.listCandidateSongsForUser(2));
    profiles.save(ownerProfile);
    profiles.save(friendProfile);

    expect(profiles.getByUserId(1)).toEqual(
      expect.objectContaining({
        userId: 1,
        compactSummary: expect.stringContaining("calm")
      })
    );
    expect(profiles.getByUserId(1)?.compactSummary).not.toContain("rock");
    expect(profiles.getByUserId(2)).toEqual(
      expect.objectContaining({
        userId: 2,
        compactSummary: expect.stringContaining("negative: dislike")
      })
    );
  });

  it("stores imported sources as user-private rows while keeping public song metadata reusable", async () => {
    const db = await createDatabase(":memory:");
    migrate(db);
    const music = new MusicRepository(db);

    db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");

    music.upsertCandidateSongsForUser(1, [
      {
        neteaseSongId: "owner-liked-1",
        name: "Owner Liked Song",
        artistNames: ["Artist"],
        artistIds: [],
        albumName: "Album",
        coverUrl: null,
        streamUrl: "https://music.example/owner-liked-1.mp3",
        durationMs: 180000,
        popularity: 80,
        sources: ["liked"],
        tags: ["ai:tagged", "ai:mood:calm"],
        recentPlayCount: 0,
        daysSinceLastPlayed: null,
        feedback: []
      }
    ]);

    expect(music.listCandidateSongsForUser(1)).toEqual([expect.objectContaining({ neteaseSongId: "owner-liked-1", sources: ["liked"] })]);
    expect(music.listCandidateSongsForUser(2)).toEqual([]);
    expect(music.listSongs()[0]).toEqual(
      expect.objectContaining({
        netease_song_id: "owner-liked-1",
        tags_json: expect.stringContaining("ai:mood:calm")
      })
    );
  });

  it("stores recommendation sessions per user", async () => {
    const db = await createDatabase(":memory:");
    migrate(db);
    const recs = new RecommendationRepository(db);

    db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");

    const ownerSession = recs.createSessionForUser(1, {
      prompt: "owner prompt",
      parsedContext: { scene: "work" },
      strategy: { novelty: "balanced" }
    });
    const friendSession = recs.createSessionForUser(2, {
      prompt: "friend prompt",
      parsedContext: { scene: "night" },
      strategy: { novelty: "explore" }
    });

    expect(recs.getSessionWithItemsForUser(1, ownerSession)).not.toBeNull();
    expect(recs.getSessionWithItemsForUser(1, friendSession)).toBeNull();
    expect(recs.getSessionWithItemsForUser(2, friendSession)).not.toBeNull();
  });

  it("queues public songs missing AI tags without duplicating jobs", async () => {
    const db = await createDatabase(":memory:");
    migrate(db);
    const music = new MusicRepository(db);
    const queue = new TaggingQueueRepository(db);

    const taggedSongId = music.upsertCandidateSong({
      neteaseSongId: "tagged-public-song",
      name: "Tagged Public Song",
      artistNames: ["Artist"],
      artistIds: [],
      albumName: "Album",
      coverUrl: null,
      streamUrl: "https://music.example/tagged.mp3",
      durationMs: 180000,
      popularity: 80,
      sources: [],
      tags: ["ai:tagged", "ai:mood:calm"],
      recentPlayCount: 0,
      daysSinceLastPlayed: null,
      feedback: []
    });
    const untaggedSongId = music.upsertCandidateSong({
      neteaseSongId: "untagged-public-song",
      name: "Untagged Public Song",
      artistNames: ["Artist"],
      artistIds: [],
      albumName: "Album",
      coverUrl: null,
      streamUrl: "https://music.example/untagged.mp3",
      durationMs: 180000,
      popularity: 80,
      sources: [],
      tags: ["liked", "playable"],
      recentPlayCount: 0,
      daysSinceLastPlayed: null,
      feedback: []
    });

    expect(queue.enqueueMissingTags([taggedSongId, untaggedSongId], "sync")).toEqual({ inserted: 1, skipped: 1 });
    expect(queue.enqueueMissingTags([untaggedSongId], "sync")).toEqual({ inserted: 0, skipped: 1 });
    expect(queue.listPending()).toEqual([expect.objectContaining({ songId: untaggedSongId, reason: "sync", status: "pending" })]);
  });

  it("looks up public song ids by NetEase ids for background tagging", async () => {
    const db = await createDatabase(":memory:");
    migrate(db);
    const music = new MusicRepository(db);
    const songId = music.upsertCandidateSong({
      neteaseSongId: "lookup-song-for-tagging",
      name: "Lookup Song",
      artistNames: ["Artist"],
      artistIds: [],
      albumName: "Album",
      coverUrl: null,
      streamUrl: "https://music.example/lookup.mp3",
      durationMs: 180000,
      popularity: 80,
      sources: [],
      tags: ["liked", "playable"],
      recentPlayCount: 0,
      daysSinceLastPlayed: null,
      feedback: []
    });

    expect(music.listSongIdsByNeteaseIds(["lookup-song-for-tagging", "missing-song"])).toEqual(new Map([["lookup-song-for-tagging", songId]]));
  });

  it("claims and completes pending tagging jobs", async () => {
    const db = await createDatabase(":memory:");
    migrate(db);
    const music = new MusicRepository(db);
    const queue = new TaggingQueueRepository(db);
    const songId = music.upsertCandidateSong({
      neteaseSongId: "claim-tagging-job",
      name: "Claim Tagging Job",
      artistNames: ["Artist"],
      artistIds: [],
      albumName: "Album",
      coverUrl: null,
      streamUrl: "https://music.example/claim.mp3",
      durationMs: 180000,
      popularity: 80,
      sources: [],
      tags: ["liked", "playable"],
      recentPlayCount: 0,
      daysSinceLastPlayed: null,
      feedback: []
    });

    queue.enqueueMissingTags([songId], "sync");
    const claimed = queue.claimPending(5);

    expect(claimed).toEqual([expect.objectContaining({ songId, status: "processing", attempts: 1 })]);
    expect(queue.listPending()).toEqual([]);

    queue.markDone(claimed[0].id);

    expect(queue.listByStatus("done")).toEqual([expect.objectContaining({ songId, status: "done", attempts: 1 })]);
  });

  it("retries failed tagging jobs after backoff until max attempts", async () => {
    const db = await createDatabase(":memory:");
    migrate(db);
    const music = new MusicRepository(db);
    const queue = new TaggingQueueRepository(db);
    const songId = music.upsertCandidateSong({
      neteaseSongId: "retry-tagging-job",
      name: "Retry Tagging Job",
      artistNames: ["Artist"],
      artistIds: [],
      albumName: "Album",
      coverUrl: null,
      streamUrl: "https://music.example/retry.mp3",
      durationMs: 180000,
      popularity: 80,
      sources: [],
      tags: ["liked", "playable"],
      recentPlayCount: 0,
      daysSinceLastPlayed: null,
      feedback: []
    });

    queue.enqueueMissingTags([songId], "sync");
    const [firstClaim] = queue.claimPending(5);

    queue.markFailed(firstClaim.id, { maxAttempts: 2, retryDelaySeconds: 60 });

    expect(queue.listByStatus("failed")).toEqual([]);
    expect(queue.listPending()).toEqual([]);
    expect(queue.claimPending(5)).toEqual([]);

    db.run("UPDATE tagging_jobs SET next_attempt_at = datetime('now', '-1 second') WHERE id = $jobId", { $jobId: firstClaim.id });
    const [secondClaim] = queue.claimPending(5);

    expect(secondClaim).toEqual(expect.objectContaining({ songId, status: "processing", attempts: 2 }));

    queue.markFailed(secondClaim.id, { maxAttempts: 2, retryDelaySeconds: 60 });

    expect(queue.listPending()).toEqual([]);
    expect(queue.listByStatus("failed")).toEqual([expect.objectContaining({ songId, status: "failed", attempts: 2 })]);
  });
});

function signedSessionCookie(userId: number) {
  return `ai_music_user=${createSessionCookieValue(userId)}`;
}
