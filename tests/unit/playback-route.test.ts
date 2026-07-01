import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/playback/route";
import { POST as playEventsPost } from "@/app/api/play-events/route";
import { getMusicRepositoryForApp, resetAppServicesForTests, saveNeteaseCookie } from "@/lib/appServices";
import { resetPlaybackServicesForTests, setPlaybackServicesForTests } from "@/lib/playback/playbackService";
import { createSessionCookieValue } from "@/lib/user/sessionCookie";
import type { CandidateSong } from "@/lib/recommendation/types";

const originalDbPath = process.env.MUSIC_DB_PATH;

afterEach(() => {
  resetPlaybackServicesForTests();
  if (originalDbPath === undefined) {
    delete process.env.MUSIC_DB_PATH;
  } else {
    process.env.MUSIC_DB_PATH = originalDbPath;
  }
  resetAppServicesForTests();
  vi.restoreAllMocks();
});

describe("playback API", () => {
  it("records significant playback events", async () => {
    await seedOwnerSong("436514312");

    const response = await playEventsPost(
      new Request("http://localhost/api/play-events", {
        method: "POST",
        body: JSON.stringify({
          itemId: "436514312",
          playedSeconds: 45,
          durationSeconds: 180,
          completed: false
        })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      saved: expect.objectContaining({
        itemId: "436514312",
        saved: true
      })
    });
  });

  it("refreshes the NetEase media URL and proxies a ranged audio response", async () => {
    const resolveFreshPlaybackUrl = vi.fn(async () => "https://fresh.music.126.net/song.mp3?token=fresh");
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://fresh.music.126.net/song.mp3?token=fresh");
      expect(init?.headers).toEqual(
        expect.objectContaining({
          range: "bytes=0-1023"
        })
      );
      return new Response("mp3-bytes", {
        status: 206,
        headers: {
          "content-type": "audio/mpeg",
          "content-range": "bytes 0-8/900",
          "content-length": "9"
        }
      });
    });
    setPlaybackServicesForTests({ resolveFreshPlaybackUrl, fetchMedia: fetchMock });
    await seedOwnerSong("436514312");

    const response = await GET(
      new Request("http://localhost/api/playback?id=436514312", {
        headers: { range: "bytes=0-1023" }
      })
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("content-range")).toBe("bytes 0-8/900");
    await expect(response.text()).resolves.toBe("mp3-bytes");
    expect(resolveFreshPlaybackUrl).toHaveBeenCalledWith("436514312", null);
  });

  it("resolves playback with the request user's stored NetEase Cookie", async () => {
    const resolveFreshPlaybackUrl = vi.fn(async (_songId: string, cookie?: string | null) =>
      cookie === "MUSIC_U=friend-playback-cookie" ? "https://fresh.music.126.net/friend.mp3" : null
    );
    const fetchMock = vi.fn(async () => new Response("friend-mp3", { status: 200, headers: { "content-type": "audio/mpeg" } }));
    setPlaybackServicesForTests({ resolveFreshPlaybackUrl, fetchMedia: fetchMock });
    await seedUserSong(2, "friend-playback-song");
    await saveNeteaseCookie("MUSIC_U=friend-playback-cookie", { userId: 2 });

    const response = await GET(
      new Request("http://localhost/api/playback?id=friend-playback-song", {
        headers: { cookie: signedSessionCookie(2) }
      })
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("friend-mp3");
    expect(resolveFreshPlaybackUrl).toHaveBeenCalledWith("friend-playback-song", "MUSIC_U=friend-playback-cookie");
  });

  it("returns a clear error when NetEase has no playable URL for the song", async () => {
    setPlaybackServicesForTests({
      resolveFreshPlaybackUrl: vi.fn(async () => null)
    });
    await seedOwnerSong("unavailable");

    const response = await GET(new Request("http://localhost/api/playback?id=unavailable"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "这首歌暂时没有可播放地址，可能受版权限制。"
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
