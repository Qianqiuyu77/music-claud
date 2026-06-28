import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/playback/route";
import { POST as playEventsPost } from "@/app/api/play-events/route";
import { resetPlaybackServicesForTests, setPlaybackServicesForTests } from "@/lib/playback/playbackService";

afterEach(() => {
  resetPlaybackServicesForTests();
  vi.restoreAllMocks();
});

describe("playback API", () => {
  it("records significant playback events", async () => {
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

    const response = await GET(
      new Request("http://localhost/api/playback?id=436514312", {
        headers: { range: "bytes=0-1023" }
      })
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("content-range")).toBe("bytes 0-8/900");
    await expect(response.text()).resolves.toBe("mp3-bytes");
    expect(resolveFreshPlaybackUrl).toHaveBeenCalledWith("436514312");
  });

  it("returns a clear error when NetEase has no playable URL for the song", async () => {
    setPlaybackServicesForTests({
      resolveFreshPlaybackUrl: vi.fn(async () => null)
    });

    const response = await GET(new Request("http://localhost/api/playback?id=unavailable"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "这首歌暂时没有可播放地址，可能受版权限制。"
    });
  });
});
