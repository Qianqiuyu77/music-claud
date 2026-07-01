import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/lyrics/route";
import { getMusicRepositoryForApp, resetAppServicesForTests, saveNeteaseCookie } from "@/lib/appServices";
import { resetLyricsServicesForTests, setLyricsServicesForTests } from "@/lib/lyrics/lyricsService";
import { createSessionCookieValue } from "@/lib/user/sessionCookie";
import type { CandidateSong } from "@/lib/recommendation/types";

const originalDbPath = process.env.MUSIC_DB_PATH;

afterEach(() => {
  resetLyricsServicesForTests();
  if (originalDbPath === undefined) {
    delete process.env.MUSIC_DB_PATH;
  } else {
    process.env.MUSIC_DB_PATH = originalDbPath;
  }
  resetAppServicesForTests();
});

describe("lyrics API", () => {
  it("returns parsed lyric lines for a song", async () => {
    setLyricsServicesForTests({
      getLyrics: async (songId) => [
        {
          time: 1.2,
          text: `第一句 ${songId}`,
          translation: "First line"
        }
      ]
    });
    await seedOwnerSong("436514312");

    const response = await GET(new Request("http://localhost/api/lyrics?id=436514312"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      songId: "436514312",
      lines: [
        {
          time: 1.2,
          text: "第一句 436514312",
          translation: "First line"
        }
      ]
    });
  });

  it("fetches lyrics with the request user's stored NetEase Cookie", async () => {
    const getLyrics = vi.fn(async (_songId: string, cookie?: string | null) =>
      cookie === "MUSIC_U=friend-lyrics-cookie" ? [{ time: 2.4, text: "friend lyric" }] : []
    );
    setLyricsServicesForTests({ getLyrics });
    await seedUserSong(2, "friend-lyrics-song");
    await saveNeteaseCookie("MUSIC_U=friend-lyrics-cookie", { userId: 2 });

    const response = await GET(
      new Request("http://localhost/api/lyrics?id=friend-lyrics-song", {
        headers: { cookie: signedSessionCookie(2) }
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      songId: "friend-lyrics-song",
      lines: [{ time: 2.4, text: "friend lyric" }]
    });
    expect(getLyrics).toHaveBeenCalledWith("friend-lyrics-song", "MUSIC_U=friend-lyrics-cookie");
  });

  it("rejects requests without a song id", async () => {
    const response = await GET(new Request("http://localhost/api/lyrics"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "缺少歌曲 ID。"
    });
  });
});

async function seedOwnerSong(neteaseSongId: string) {
  await seedUserSong(1, neteaseSongId);
}

function signedSessionCookie(userId: number) {
  return `ai_music_user=${createSessionCookieValue(userId)}`;
}

async function seedUserSong(userId: number, neteaseSongId: string) {
  process.env.MUSIC_DB_PATH = ":memory:";
  resetAppServicesForTests();
  const repository = await getMusicRepositoryForApp();
  if (userId !== 1) {
    (repository as unknown as { db: { run: (sql: string) => void } }).db.run(`INSERT INTO users (id, handle, nickname) VALUES (${userId}, 'friend', 'Friend')`);
  }
  repository.upsertCandidateSongsForUser(userId, [songFixture(neteaseSongId)]);
}

function songFixture(neteaseSongId: string): CandidateSong {
  return {
    neteaseSongId,
    name: "Test Song",
    artistNames: ["Test Artist"],
    albumName: "Test Album",
    coverUrl: null,
    streamUrl: `https://music.example/${neteaseSongId}.mp3`,
    durationMs: 180000,
    popularity: 70,
    sources: ["liked"],
    tags: ["scene:focus"],
    recentPlayCount: 0,
    daysSinceLastPlayed: 30,
    feedback: []
  };
}
