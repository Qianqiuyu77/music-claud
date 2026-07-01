import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import { FallbackAiProvider } from "@/lib/ai/fallbackProvider";
import { NeteaseCloudProvider } from "@/lib/netease/cloudProvider";

describe("providers", () => {
  it("parses listening context without sending raw data", async () => {
    const provider = new FallbackAiProvider();
    const context = await provider.parseListeningContext("write code, calm, less vocal", "quiet work preference");

    expect(context.scene).toBe("work");
    expect(context.mood).toContain("calm");
    expect(context.vocal).toBe("less_vocal");
  });

  it("parses Chinese coding prompts into work context", async () => {
    const provider = new FallbackAiProvider();
    const context = await provider.parseListeningContext("写代码，安静，少人声，别太困", "本地偏好摘要");

    expect(context.scene).toBe("work");
    expect(context.mood).toEqual(expect.arrayContaining(["calm", "focused"]));
    expect(context.vocal).toBe("less_vocal");
    expect(context.energy).toBe("low");
  });

  it("maps NetEase QR login key, image, and status from API responses", async () => {
    const calls: Array<{ path: string; params: Record<string, unknown> | undefined }> = [];
    const provider = new NeteaseCloudProvider(async (path, params) => {
      calls.push({ path, params });
      if (path === "/login/qr/key") {
        return { body: { data: { unikey: "qr-key-1" } } };
      }
      if (path === "/login/qr/check") {
        return { body: { code: 803, cookie: "MUSIC_U=secret-cookie" } };
      }
      throw new Error(`Unexpected path ${path}`);
    });

    const qr = await provider.getLoginQr();
    expect(qr.key).toBe("qr-key-1");
    expect(qr.qrUrl).toMatch(/^data:image\/png;base64,/);
    expect(qr.qrUrl.length).toBeGreaterThan(1000);
    await expect(provider.getLoginStatus("qr-key-1")).resolves.toEqual({
      status: "authorized",
      encryptedCookie: expect.stringContaining("local-dev:"),
      rawCookie: "MUSIC_U=secret-cookie",
      source: "qr"
    });
    expect(Buffer.from(qr.qrUrl.split(",")[1] ?? "", "base64").length).toBeGreaterThan(500);
    expect(calls.map((call) => call.path)).toEqual(["/login/qr/key", "/login/qr/check"]);
    expect(calls[0]?.params?.cookie).toEqual(calls[1]?.params?.cookie);
    expect(String(calls[0]?.params?.cookie)).toContain("sDeviceId=");
  });

  it("imports real NetEase liked songs with playable URLs from API responses", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    process.env.NETEASE_COOKIE = "MUSIC_U=test-cookie";
    const provider = new NeteaseCloudProvider(async (path, params) => {
      if (path === "/user/account") {
        return { body: { code: 200, profile: { userId: 42 } } };
      }
      if (path === "/likelist") {
        return { body: { code: 200, ids: [101, 102] } };
      }
      if (path === "/song/detail") {
        return {
          body: {
            code: 200,
            songs: [
              {
                id: 101,
                name: "真实歌曲 A",
                ar: [{ name: "歌手 A" }],
                al: { name: "专辑 A", picUrl: "https://img.example/a.jpg" },
                dt: 210000,
                pop: 88
              },
              {
                id: 102,
                name: "真实歌曲 B",
                ar: [{ name: "歌手 B" }],
                al: { name: "专辑 B", picUrl: null },
                dt: 180000,
                pop: 66
              }
            ]
          }
        };
      }
      if (path === "/song/url") {
        return {
          body: {
            code: 200,
            data: [
              { id: 101, url: "https://music.example/101.mp3" },
              { id: 102, url: null }
            ]
          }
        };
      }
      if (path === "/user/playlist") {
        return { body: { code: 200, playlist: [] } };
      }
      if (path === "/record/recent/song") {
        return { body: { code: 200, data: [] } };
      }
      throw new Error(`Unexpected path ${path} ${JSON.stringify(params)}`);
    });

    const result = await provider.importLibrary();
    process.env.NETEASE_COOKIE = originalCookie;

    expect(result.partialFailures).toEqual([]);
    expect(result.songs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          neteaseSongId: "101",
          name: "真实歌曲 A",
          artistNames: ["歌手 A"],
          albumName: "专辑 A",
          coverUrl: "https://img.example/a.jpg",
          streamUrl: "https://music.example/101.mp3",
          sources: ["liked"]
        }),
        expect.objectContaining({
          neteaseSongId: "102",
          name: "真实歌曲 B",
          streamUrl: null,
          sources: ["liked"]
        })
      ])
    );
  });

  it("refreshes a single song playback URL from NetEase on demand", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    process.env.NETEASE_COOKIE = "MUSIC_U=test-cookie";
    const provider = new NeteaseCloudProvider(async (path, params) => {
      expect(path).toBe("/song/url");
      expect(params).toEqual(expect.objectContaining({ cookie: "MUSIC_U=test-cookie", id: "436514312", br: 320000 }));
      return {
        body: {
          code: 200,
          data: [{ id: 436514312, url: "https://fresh.music.126.net/436514312.mp3" }]
        }
      };
    });

    await expect(provider.getFreshPlaybackUrl("436514312")).resolves.toBe("https://fresh.music.126.net/436514312.mp3");

    process.env.NETEASE_COOKIE = originalCookie;
  });

  it("fetches and parses line-synced NetEase lyrics", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    process.env.NETEASE_COOKIE = "MUSIC_U=test-cookie";
    const provider = new NeteaseCloudProvider(async (path, params) => {
      expect(path).toBe("/song/lyric/v1");
      expect(params).toEqual(expect.objectContaining({ cookie: "MUSIC_U=test-cookie", id: "436514312" }));
      return {
        body: {
          code: 200,
          lrc: {
            lyric: "[00:01.20]Do we say what we mean\n[00:05.00]Why was everyone leaving"
          },
          tlyric: {
            lyric: "[00:01.20]我们说的是我们想说的吗\n[00:05.00]为什么每个人都要离去"
          }
        }
      };
    });

    await expect(provider.getLyrics("436514312")).resolves.toEqual([
      {
        time: 1.2,
        text: "Do we say what we mean",
        translation: "我们说的是我们想说的吗"
      },
      {
        time: 5,
        text: "Why was everyone leaving",
        translation: "为什么每个人都要离去"
      }
    ]);

    process.env.NETEASE_COOKIE = originalCookie;
  });

  it("imports every liked song returned by NetEase instead of truncating the library", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    process.env.NETEASE_COOKIE = "MUSIC_U=test-cookie";
    const likedIds = Array.from({ length: 365 }, (_, index) => 1000 + index);
    const provider = new NeteaseCloudProvider(async (path, params) => {
      if (path === "/user/account") {
        return { body: { code: 200, profile: { userId: 42 } } };
      }
      if (path === "/likelist") {
        return { body: { code: 200, ids: likedIds } };
      }
      if (path === "/user/playlist") {
        return { body: { code: 200, playlist: [] } };
      }
      if (path === "/record/recent/song") {
        return { body: { code: 200, data: [] } };
      }
      if (path === "/song/detail") {
        const ids = String(params?.ids)
          .split(",")
          .filter(Boolean)
          .map(Number);
        return {
          body: {
            code: 200,
            songs: ids.map((id) => ({
              id,
              name: `真实红心 ${id}`,
              ar: [{ name: "测试歌手" }],
              al: { name: "测试专辑", picUrl: null },
              dt: 200000,
              pop: 80
            }))
          }
        };
      }
      if (path === "/song/url") {
        const ids = String(params?.id)
          .split(",")
          .filter(Boolean)
          .map(Number);
        return {
          body: {
            code: 200,
            data: ids.map((id) => ({ id, url: `https://music.example/${id}.mp3` }))
          }
        };
      }
      throw new Error(`Unexpected path ${path}`);
    });

    const result = await provider.importLibrary();
    process.env.NETEASE_COOKIE = originalCookie;

    expect(result.songs).toHaveLength(365);
    expect(result.songs[0].neteaseSongId).toBe("1000");
    expect(result.songs.at(-1)?.neteaseSongId).toBe("1364");
  });

  it("imports a bounded quick library without walking every playlist", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    process.env.NETEASE_COOKIE = "MUSIC_U=test-cookie";
    const calls: string[] = [];
    const likedIds = Array.from({ length: 365 }, (_, index) => 2000 + index);
    const provider = new NeteaseCloudProvider(async (path, params) => {
      calls.push(path);
      if (path === "/user/account") {
        return { body: { code: 200, profile: { userId: 42 } } };
      }
      if (path === "/likelist") {
        return { body: { code: 200, ids: likedIds } };
      }
      if (path === "/record/recent/song") {
        return { body: { code: 200, data: [{ resourceId: 9001 }] } };
      }
      if (path === "/song/detail") {
        const ids = String(params?.ids)
          .split(",")
          .filter(Boolean)
          .map(Number);
        return {
          body: {
            code: 200,
            songs: ids.map((id) => ({
              id,
              name: `Quick ${id}`,
              ar: [{ name: "Quick Artist" }],
              al: { name: "Quick Album", picUrl: null },
              dt: 200000,
              pop: 80
            }))
          }
        };
      }
      if (path === "/song/url") {
        const ids = String(params?.id)
          .split(",")
          .filter(Boolean)
          .map(Number);
        return {
          body: {
            code: 200,
            data: ids.map((id) => ({ id, url: `https://music.example/${id}.mp3` }))
          }
        };
      }
      throw new Error(`Unexpected path ${path}`);
    });

    const result = await provider.importLibrary("MUSIC_U=test-cookie", { quick: true, limit: 120 });
    process.env.NETEASE_COOKIE = originalCookie;

    expect(result.songs).toHaveLength(120);
    expect(result.songs[0].neteaseSongId).toBe("2000");
    expect(result.songs.at(-1)?.neteaseSongId).toBe("2119");
    expect(calls).not.toContain("/user/playlist");
    expect(calls).toContain("/record/recent/song");
  });

  it("assigns distinct category tags from observable NetEase song metadata", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    process.env.NETEASE_COOKIE = "MUSIC_U=test-cookie";
    const provider = new NeteaseCloudProvider(async (path) => {
      if (path === "/user/account") {
        return { body: { code: 200, profile: { userId: 42 } } };
      }
      if (path === "/likelist") {
        return { body: { code: 200, ids: [201, 202] } };
      }
      if (path === "/user/playlist") {
        return { body: { code: 200, playlist: [{ id: 9001 }] } };
      }
      if (path === "/playlist/track/all") {
        return { body: { code: 200, songs: [{ id: 202 }] } };
      }
      if (path === "/record/recent/song") {
        return { body: { code: 200, data: [{ resourceId: 202 }] } };
      }
      if (path === "/song/detail") {
        return {
          body: {
            code: 200,
            songs: [
              {
                id: 201,
                name: "夜的钢琴曲 Instrumental",
                ar: [{ name: "石进" }],
                al: { name: "夜的钢琴曲", picUrl: null },
                dt: 168000,
                pop: 73,
                publishTime: Date.UTC(2024, 0, 1),
                mv: 0
              },
              {
                id: 202,
                name: "倔强 Live Remix",
                ar: [{ name: "五月天" }, { name: "合作歌手" }],
                al: { name: "摇滚现场精选", picUrl: null },
                dt: 255000,
                pop: 96,
                publishTime: Date.UTC(2005, 0, 1),
                mv: 12345
              }
            ]
          }
        };
      }
      if (path === "/song/url") {
        return {
          body: {
            code: 200,
            data: [
              { id: 201, url: "https://music.example/201.mp3" },
              { id: 202, url: "https://music.example/202.mp3" }
            ]
          }
        };
      }
      throw new Error(`Unexpected path ${path}`);
    });

    const result = await provider.importLibrary();
    process.env.NETEASE_COOKIE = originalCookie;

    const piano = result.songs.find((song) => song.neteaseSongId === "201");
    const liveRock = result.songs.find((song) => song.neteaseSongId === "202");

    expect(piano?.tags).toEqual(expect.arrayContaining(["liked", "playable", "instrumental", "calm", "chinese"]));
    expect(liveRock?.tags).toEqual(
      expect.arrayContaining(["liked", "playlist", "recent", "playable", "rock", "live", "remix", "popular", "classic_release", "collaboration", "mv_available"])
    );
    expect(piano?.tags.length).toBeGreaterThanOrEqual(5);
    expect(liveRock?.tags).not.toEqual(piano?.tags);
  });

  it("enriches recommended songs with NetEase wiki style and mood tags", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    process.env.NETEASE_COOKIE = "MUSIC_U=test-cookie";
    const provider = new NeteaseCloudProvider(async (path) => {
      if (path === "/song/wiki/summary") {
        return {
          body: {
            code: 200,
            data: {
              blocks: [
                {
                  code: "SONG_PLAY_ABOUT_SONG_BASIC",
                  uiElement: { mainTitle: { title: "音乐百科" } },
                  creatives: [
                    wikiCreative("曲风", ["流行-粤语流行"]),
                    wikiCreative("推荐标签", ["怀旧", "悲伤"]),
                    wikiCreative("语种", ["粤语"])
                  ]
                }
              ]
            }
          }
        };
      }
      throw new Error(`Unexpected path ${path}`);
    });

    const result = await provider.enrichSongsWithWikiTags([
      {
        neteaseSongId: "308353",
        name: "钟无艳",
        artistNames: ["谢安琪"],
        albumName: "Binary",
        coverUrl: null,
        streamUrl: "https://music.example/308353.mp3",
        durationMs: 278000,
        popularity: 92,
        sources: ["liked"],
        tags: ["liked", "playable", "popular", "standard_song"],
        recentPlayCount: 0,
        daysSinceLastPlayed: 30,
        feedback: []
      }
    ]);

    process.env.NETEASE_COOKIE = originalCookie;

    expect(result.partialFailures).toEqual([]);
    expect(result.songs[0].tags).toEqual(expect.arrayContaining(["style:粤语流行", "mood:怀旧", "mood:悲伤", "chinese", "melancholy"]));
  });

  it("expands the local library from NetEase discovery sources without fabricated songs", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    process.env.NETEASE_COOKIE = "MUSIC_U=test-cookie";
    const calls: string[] = [];
    const provider = new NeteaseCloudProvider(async (path, params) => {
      calls.push(path);
      if (path === "/recommend/songs") {
        return {
          body: {
            code: 200,
            data: {
              dailySongs: [{ id: 301 }]
            }
          }
        };
      }
      if (path === "/personal/fm") {
        return {
          body: {
            code: 200,
            data: [{ id: 302 }]
          }
        };
      }
      if (path === "/simi/song") {
        expect(params?.id).toBe("101");
        return {
          body: {
            code: 200,
            songs: [{ id: 303 }]
          }
        };
      }
      if (path === "/simi/playlist") {
        return {
          body: {
            code: 200,
            playlists: [{ id: 901 }]
          }
        };
      }
      if (path === "/playlist/track/all") {
        return {
          body: {
            code: 200,
            songs: [{ id: 304 }]
          }
        };
      }
      if (path === "/song/detail") {
        return {
          body: {
            code: 200,
            songs: [301, 302, 303, 304].map((id) => ({
              id,
              name: `扩展歌曲 ${id}`,
              ar: [{ name: `扩展歌手 ${id}` }],
              al: { name: `扩展专辑 ${id}`, picUrl: null },
              dt: 200000,
              pop: 70
            }))
          }
        };
      }
      if (path === "/song/url") {
        return {
          body: {
            code: 200,
            data: [301, 302, 303, 304].map((id) => ({ id, url: `https://music.example/${id}.mp3` }))
          }
        };
      }
      throw new Error(`Unexpected path ${path}`);
    });

    const result = await provider.expandLibrary({
      seedSongIds: ["101"],
      limit: 8
    });
    process.env.NETEASE_COOKIE = originalCookie;

    expect(result.partialFailures).toEqual([]);
    expect(result.songs.map((song) => song.neteaseSongId).sort()).toEqual(["301", "302", "303", "304"]);
    expect(result.songs.find((song) => song.neteaseSongId === "301")?.sources).toContain("exploration");
    expect(result.songs.find((song) => song.neteaseSongId === "303")?.sources).toContain("netease_similar_song");
    expect(result.songs.find((song) => song.neteaseSongId === "304")?.sources).toContain("netease_similar_playlist");
    expect(calls).toEqual(
      expect.arrayContaining(["/recommend/songs", "/personal/fm", "/simi/song", "/simi/playlist", "/playlist/track/all", "/song/detail", "/song/url"])
    );
  });

  it("balances expansion results across discovery channels by quota", async () => {
    const originalCookie = process.env.NETEASE_COOKIE;
    process.env.NETEASE_COOKIE = "MUSIC_U=test-cookie";
    const provider = new NeteaseCloudProvider(async (path, params) => {
      if (path === "/recommend/songs") {
        return { body: { code: 200, data: { dailySongs: idSongs(1, 20) } } };
      }
      if (path === "/personal/fm") {
        return { body: { code: 200, data: idSongs(101, 20) } };
      }
      if (path === "/simi/song") {
        return { body: { code: 200, songs: idSongs(Number(params?.id) * 1000, 20) } };
      }
      if (path === "/simi/playlist") {
        return { body: { code: 200, playlists: [{ id: `p-${params?.id}-1` }, { id: `p-${params?.id}-2` }] } };
      }
      if (path === "/playlist/track/all") {
        const base = String(params?.id).includes("-2") ? 8000 : 7000;
        return { body: { code: 200, songs: idSongs(base + Number(String(params?.id).match(/\d+/)?.[0] ?? 0), 20) } };
      }
      if (path === "/song/detail") {
        const ids = String(params?.ids)
          .split(",")
          .filter(Boolean)
          .map(Number);
        return {
          body: {
            code: 200,
            songs: ids.map((id) => ({
              id,
              name: `扩充歌曲 ${id}`,
              ar: [{ name: `歌手 ${id}` }],
              al: { name: `专辑 ${id}`, picUrl: null },
              dt: 200000,
              pop: 75
            }))
          }
        };
      }
      if (path === "/song/url") {
        const ids = String(params?.id)
          .split(",")
          .filter(Boolean)
          .map(Number);
        return {
          body: {
            code: 200,
            data: ids.map((id) => ({ id, url: `https://music.example/${id}.mp3` }))
          }
        };
      }
      throw new Error(`Unexpected path ${path}`);
    });

    const result = await provider.expandLibrary({
      seedSongIds: ["11", "12", "13", "14", "15", "16"],
      limit: 40
    });
    process.env.NETEASE_COOKIE = originalCookie;

    const counts = result.songs.reduce<Record<string, number>>((acc, song) => {
      const source = song.sources.includes("exploration")
        ? "exploration"
        : song.sources.includes("netease_similar_song")
          ? "similarSong"
          : song.sources.includes("netease_similar_playlist")
            ? "similarPlaylist"
            : "other";
      acc[source] = (acc[source] ?? 0) + 1;
      return acc;
    }, {});
    expect(result.songs).toHaveLength(40);
    expect(counts.exploration).toBeGreaterThanOrEqual(16);
    expect(counts.similarSong).toBeGreaterThanOrEqual(8);
    expect(counts.similarPlaylist).toBeGreaterThanOrEqual(6);
  });
});

function wikiCreative(title: string, resourceTitles: string[]) {
  return {
    uiElement: { mainTitle: { title } },
    resources: resourceTitles.map((resourceTitle) => ({
      uiElement: { mainTitle: { title: resourceTitle } }
    }))
  };
}

function idSongs(start: number, count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: start + index }));
}
