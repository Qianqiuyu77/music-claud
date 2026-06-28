import type { CandidateSong, CandidateSourceName } from "@/lib/recommendation/types";
import { parseSyncedLyrics } from "@/lib/lyrics/lyrics";
import { classifySongTags, extractNeteaseWikiTags } from "@/lib/recommendation/songTags";
import type { NeteaseImportResult, NeteaseProvider } from "./types";

type NeteaseApiCaller = (path: string, params?: Record<string, unknown>) => Promise<unknown>;
type QrCodeModule = {
  toDataURL(text: string): Promise<string>;
};

type NeteaseResponse = {
  body?: Record<string, unknown>;
};

type RawSong = {
  id: number | string;
  name?: string;
  ar?: Array<{ name?: string }>;
  artists?: Array<{ name?: string }>;
  al?: { name?: string; picUrl?: string | null };
  album?: { name?: string; picUrl?: string | null };
  dt?: number | null;
  duration?: number | null;
  pop?: number | null;
  publishTime?: number | null;
  mv?: number | string | null;
};

type RawSongUrl = {
  id: number | string;
  url?: string | null;
};

type RawLyricBlock = {
  lyric?: string | null;
};

export class NeteaseCloudProvider implements NeteaseProvider {
  private readonly deviceId = process.env.NETEASE_DEVICE_ID || makeDeviceId();
  private readonly loginCookie = buildLoginDeviceCookie(this.deviceId);

  constructor(private readonly callApi: NeteaseApiCaller = defaultApiCaller) {}

  async getLoginQr() {
    const keyResponse = normalizeResponse(
      await this.callApi("/login/qr/key", {
        cookie: this.loginCookie,
        timestamp: Date.now()
      })
    );
    const key = readNested<string>(keyResponse.body, ["data", "unikey"]);
    if (!key) throw new Error("NetEase QR key response did not include unikey");

    const qrUrl = await createWebLoginQrImage(key, this.deviceId);
    return { key, qrUrl };
  }

  async getLoginStatus(key: string) {
    const response = normalizeResponse(
      await this.callApi("/login/qr/check", {
        cookie: this.loginCookie,
        key,
        timestamp: Date.now()
      })
    );
    const code = readNumber(response.body?.code);

    if (code === 800) return { status: "expired" as const };
    if (code === 801) return { status: "waiting" as const };
    if (code === 802) return { status: "scanned" as const };
    if (code === 803) {
      return {
        status: "authorized" as const,
        encryptedCookie: encryptCookieForLocalUse(String(response.body?.cookie ?? "")),
        source: "qr" as const
      };
    }

    return { status: "waiting" as const };
  }

  async importLibrary(): Promise<NeteaseImportResult> {
    const cookie = process.env.NETEASE_COOKIE?.trim();
    if (!cookie) {
      return {
        songs: [],
        partialFailures: ["缺少 NETEASE_COOKIE，无法拉取真实网易云数据。"]
      };
    }

    const partialFailures: string[] = [];
    const account = normalizeResponse(await this.callApi("/user/account", { cookie }));
    const uid = readNumber(readNested(account.body, ["profile", "userId"]) ?? readNested(account.body, ["account", "id"]));
    if (!uid) {
      return {
        songs: [],
        partialFailures: ["网易云 Cookie 没有返回账号 ID，请重新复制 MUSIC_U。"]
      };
    }

    const likedIds = await this.getLikedIds(cookie, uid, partialFailures);
    const playlistIds = await this.getPlaylistTrackIds(cookie, uid, partialFailures);
    const recentIds = await this.getRecentSongIds(cookie, partialFailures);

    const sourceById = new Map<string, Set<CandidateSourceName>>();
    for (const id of likedIds) addSource(sourceById, id, "liked");
    for (const id of playlistIds) addSource(sourceById, id, "playlist");
    for (const id of recentIds) addSource(sourceById, id, "recent");

    const ids = Array.from(sourceById.keys());
    if (ids.length === 0) {
      return {
        songs: [],
        partialFailures: [...partialFailures, "网易云没有返回可用于推荐的歌曲。"]
      };
    }

    const songs = await this.getSongs(cookie, ids, sourceById, partialFailures);
    return { songs, partialFailures };
  }

  async expandLibrary(options: { seedSongIds?: string[]; limit?: number } = {}): Promise<NeteaseImportResult> {
    const cookie = process.env.NETEASE_COOKIE?.trim();
    if (!cookie) {
      return {
        songs: [],
        partialFailures: ["缺少 NETEASE_COOKIE，无法扩充真实网易云数据。"]
      };
    }

    const partialFailures: string[] = [];
    const sourceById = new Map<string, Set<CandidateSourceName>>();
    const limit = Math.max(1, options.limit ?? 120);
    const seedSongIds = unique((options.seedSongIds ?? []).filter(Boolean)).slice(0, 12);
    const channelIds = {
      daily: await this.getDailyRecommendIds(cookie, partialFailures),
      fm: await this.getPersonalFmIds(cookie, partialFailures),
      similarSong: [] as string[],
      similarPlaylist: [] as string[]
    };

    const seedResults = await mapWithConcurrency(seedSongIds, 3, async (seedSongId) => ({
      similarSong: await this.getSimilarSongIds(cookie, seedSongId, partialFailures),
      similarPlaylist: await this.getSimilarPlaylistTrackIds(cookie, seedSongId, partialFailures)
    }));
    for (const result of seedResults) {
      channelIds.similarSong.push(...result.similarSong);
      channelIds.similarPlaylist.push(...result.similarPlaylist);
    }

    for (const id of pickByQuota(channelIds.daily, Math.ceil(limit * 0.3))) addSource(sourceById, id, "exploration");
    for (const id of pickByQuota(channelIds.fm, Math.ceil(limit * 0.2))) addSource(sourceById, id, "exploration");
    for (const id of pickByQuota(channelIds.similarSong, Math.ceil(limit * 0.25))) addSource(sourceById, id, "netease_similar_song");
    for (const id of pickByQuota(channelIds.similarPlaylist, Math.ceil(limit * 0.25))) addSource(sourceById, id, "netease_similar_playlist");

    const spillover = [
      ...channelIds.daily.map((id) => ({ id, source: "exploration" as CandidateSourceName })),
      ...channelIds.fm.map((id) => ({ id, source: "exploration" as CandidateSourceName })),
      ...channelIds.similarSong.map((id) => ({ id, source: "netease_similar_song" as CandidateSourceName })),
      ...channelIds.similarPlaylist.map((id) => ({ id, source: "netease_similar_playlist" as CandidateSourceName }))
    ];
    for (const item of spillover) {
      if (sourceById.size >= limit) break;
      addSource(sourceById, item.id, item.source);
    }

    const ids = Array.from(sourceById.keys()).slice(0, limit);
    if (ids.length === 0) {
      return {
        songs: [],
        partialFailures: [...partialFailures, "网易云没有返回可扩充的真实歌曲。"]
      };
    }

    const songs = await this.getSongs(cookie, ids, sourceById, partialFailures);
    return { songs, partialFailures };
  }

  async getFreshPlaybackUrl(songId: string) {
    const cookie = process.env.NETEASE_COOKIE?.trim();
    if (!cookie || !songId.trim()) return null;

    const response = normalizeResponse(await this.callApi("/song/url", { cookie, id: songId, br: 320000 }));
    const item = toUrlList(response.body?.data).find((entry) => String(entry.id) === songId) ?? toUrlList(response.body?.data)[0];
    return item?.url ?? null;
  }

  async getLyrics(songId: string) {
    const cookie = process.env.NETEASE_COOKIE?.trim();
    if (!cookie || !songId.trim()) return [];

    const response = normalizeResponse(
      await this.callApi("/song/lyric/v1", {
        cookie,
        id: songId
      })
    );
    return parseSyncedLyrics({
      lyric: readNested<RawLyricBlock>(response.body, ["lrc"])?.lyric,
      translatedLyric: readNested<RawLyricBlock>(response.body, ["tlyric"])?.lyric
    });
  }

  async enrichSongsWithWikiTags(songs: CandidateSong[]): Promise<{ songs: CandidateSong[]; partialFailures: string[] }> {
    const cookie = process.env.NETEASE_COOKIE?.trim();
    if (!cookie || songs.length === 0) return { songs, partialFailures: [] };

    const partialFailures: string[] = [];
    const enriched: CandidateSong[] = [];
    for (const song of songs) {
      try {
        const response = normalizeResponse(await this.callApi("/song/wiki/summary", { cookie, id: song.neteaseSongId }));
        const wikiTags = extractNeteaseWikiTags(response.body);
        enriched.push({ ...song, tags: Array.from(new Set([...song.tags, ...wikiTags])) });
      } catch (error) {
        partialFailures.push(`歌曲 ${song.neteaseSongId} 分类标签拉取失败：${errorMessage(error)}`);
        enriched.push(song);
      }
    }
    return { songs: enriched, partialFailures };
  }

  private async getLikedIds(cookie: string, uid: number, partialFailures: string[]) {
    try {
      const response = normalizeResponse(await this.callApi("/likelist", { cookie, uid }));
      return toIdList(response.body?.ids);
    } catch (error) {
      partialFailures.push(`红心歌拉取失败：${errorMessage(error)}`);
      return [];
    }
  }

  private async getPlaylistTrackIds(cookie: string, uid: number, partialFailures: string[]) {
    try {
      const response = normalizeResponse(await this.callApi("/user/playlist", { cookie, uid, limit: 1000 }));
      const playlists = Array.isArray(response.body?.playlist) ? (response.body.playlist as Array<{ id?: number | string }>) : [];
      const trackIds: string[] = [];
      for (const playlist of playlists) {
        if (!playlist.id) continue;
        try {
          const tracks = normalizeResponse(await this.callApi("/playlist/track/all", { cookie, id: playlist.id, limit: 1000 }));
          trackIds.push(...toSongList(tracks.body?.songs).map((song) => String(song.id)));
        } catch (error) {
          partialFailures.push(`歌单 ${playlist.id} 拉取失败：${errorMessage(error)}`);
        }
      }
      return unique(trackIds);
    } catch (error) {
      partialFailures.push(`歌单列表拉取失败：${errorMessage(error)}`);
      return [];
    }
  }

  private async getRecentSongIds(cookie: string, partialFailures: string[]) {
    try {
      const response = normalizeResponse(await this.callApi("/record/recent/song", { cookie, limit: 60 }));
      const data = Array.isArray(response.body?.data) ? (response.body.data as Array<{ song?: RawSong; resourceId?: number | string }>) : [];
      return unique(data.map((item) => String(item.song?.id ?? item.resourceId ?? "")).filter(Boolean)).slice(0, 60);
    } catch (error) {
      partialFailures.push(`最近播放拉取失败：${errorMessage(error)}`);
      return [];
    }
  }

  private async getDailyRecommendIds(cookie: string, partialFailures: string[]) {
    try {
      const response = normalizeResponse(await this.callApi("/recommend/songs", { cookie }));
      const data = readNested<unknown>(response.body, ["data", "dailySongs"]) ?? response.body?.recommend;
      return toSongList(data).map((song) => String(song.id));
    } catch (error) {
      partialFailures.push(`每日推荐歌曲拉取失败：${errorMessage(error)}`);
      return [];
    }
  }

  private async getPersonalFmIds(cookie: string, partialFailures: string[]) {
    try {
      const response = normalizeResponse(await this.callApi("/personal/fm", { cookie }));
      return toSongList(response.body?.data).map((song) => String(song.id));
    } catch (error) {
      partialFailures.push(`私人 FM 拉取失败：${errorMessage(error)}`);
      return [];
    }
  }

  private async getSimilarSongIds(cookie: string, songId: string, partialFailures: string[]) {
    try {
      const response = normalizeResponse(await this.callApi("/simi/song", { cookie, id: songId, limit: 50 }));
      return toSongList(response.body?.songs).map((song) => String(song.id));
    } catch (error) {
      partialFailures.push(`相似歌曲 ${songId} 拉取失败：${errorMessage(error)}`);
      return [];
    }
  }

  private async getSimilarPlaylistTrackIds(cookie: string, songId: string, partialFailures: string[]) {
    try {
      const response = normalizeResponse(await this.callApi("/simi/playlist", { cookie, id: songId, limit: 5 }));
      const playlists = Array.isArray(response.body?.playlists) ? (response.body.playlists as Array<{ id?: number | string }>) : [];
      const ids: string[] = [];
      for (const playlist of playlists.slice(0, 3)) {
        if (!playlist.id) continue;
        try {
          const tracks = normalizeResponse(await this.callApi("/playlist/track/all", { cookie, id: playlist.id, limit: 30 }));
          ids.push(...toSongList(tracks.body?.songs).map((song) => String(song.id)));
        } catch (error) {
          partialFailures.push(`相似歌单 ${playlist.id} 歌曲拉取失败：${errorMessage(error)}`);
        }
      }
      return unique(ids);
    } catch (error) {
      partialFailures.push(`相似歌单 ${songId} 拉取失败：${errorMessage(error)}`);
      return [];
    }
  }

  private async getSongs(
    cookie: string,
    ids: string[],
    sourceById: Map<string, Set<CandidateSourceName>>,
    partialFailures: string[]
  ): Promise<CandidateSong[]> {
    const songs: RawSong[] = [];
    const urls = new Map<string, string | null>();

    const batchResults = await mapWithConcurrency(chunks(ids, 80), 4, async (batch) => {
      const batchSongs: RawSong[] = [];
      const batchUrls = new Map<string, string | null>();
      try {
        const [detail, urlResponse] = await Promise.all([
          this.callApi("/song/detail", { cookie, ids: batch.join(",") }),
          this.callApi("/song/url", { cookie, id: batch.join(","), br: 320000 })
        ]);
        batchSongs.push(...toSongList(normalizeResponse(detail).body?.songs));
        for (const item of toUrlList(normalizeResponse(urlResponse).body?.data)) {
          batchUrls.set(String(item.id), item.url ?? null);
        }
      } catch (error) {
        partialFailures.push(`歌曲详情或播放地址拉取失败：${errorMessage(error)}`);
      }

      return { songs: batchSongs, urls: batchUrls };
    });

    for (const result of batchResults) {
      songs.push(...result.songs);
      for (const [id, url] of result.urls) urls.set(id, url);
    }

    return songs.map((song) => mapSong(song, Array.from(sourceById.get(String(song.id)) ?? ["exploration"]), urls.get(String(song.id)) ?? null));
  }
}

async function defaultApiCaller(path: string, params?: Record<string, unknown>) {
  const api = (await import("@NeteaseCloudMusicApiEnhanced/api")) as {
    default?: unknown;
  } & Record<string, unknown>;
  const mod = (api.default ?? api) as Record<string, (params?: Record<string, unknown>) => Promise<unknown>>;
  const methodByPath: Record<string, string> = {
    "/login/qr/key": "login_qr_key",
    "/login/qr/create": "login_qr_create",
    "/login/qr/check": "login_qr_check",
    "/user/account": "user_account",
    "/likelist": "likelist",
    "/user/playlist": "user_playlist",
    "/playlist/track/all": "playlist_track_all",
    "/record/recent/song": "record_recent_song",
    "/recommend/songs": "recommend_songs",
    "/personal/fm": "personal_fm",
    "/simi/song": "simi_song",
    "/simi/playlist": "simi_playlist",
    "/song/detail": "song_detail",
    "/song/url": "song_url",
    "/song/lyric/v1": "lyric_new",
    "/song/wiki/summary": "song_wiki_summary"
  };
  const methodName = methodByPath[path];
  const method = methodName ? mod[methodName] : undefined;
  if (!method) throw new Error(`NeteaseCloudMusicApiEnhanced method is unavailable for ${path}`);
  return method(params);
}

function mapSong(song: RawSong, sources: CandidateSourceName[], streamUrl: string | null): CandidateSong {
  const artists = song.ar ?? song.artists ?? [];
  const album = song.al ?? song.album ?? {};
  const artistNames = artists.map((artist) => artist.name).filter(Boolean) as string[];
  const albumName = album.name ?? null;
  const durationMs = song.dt ?? song.duration ?? null;
  const popularity = song.pop ?? null;
  const publishTime = song.publishTime ?? null;
  const hasMv = Boolean(Number(song.mv ?? 0));
  return {
    neteaseSongId: String(song.id),
    name: song.name ?? `网易云歌曲 ${song.id}`,
    artistNames,
    albumName,
    coverUrl: album.picUrl ?? null,
    streamUrl,
    durationMs,
    popularity,
    sources,
    tags: classifySongTags({
      name: song.name,
      artistNames,
      albumName,
      durationMs,
      popularity,
      publishTime,
      sources,
      streamUrl,
      hasMv
    }),
    recentPlayCount: sources.includes("recent") ? 3 : 0,
    daysSinceLastPlayed: sources.includes("recent") ? 1 : 30,
    feedback: []
  };
}

function addSource(map: Map<string, Set<CandidateSourceName>>, id: string, source: CandidateSourceName) {
  const existing = map.get(id) ?? new Set<CandidateSourceName>();
  existing.add(source);
  map.set(id, existing);
}

function normalizeResponse(value: unknown): NeteaseResponse {
  if (value && typeof value === "object" && "body" in value) return value as NeteaseResponse;
  return { body: value as NeteaseResponse["body"] };
}

function readNested<T>(value: unknown, path: string[]) {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current as T | undefined;
}

function readNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function toIdList(value: unknown) {
  return Array.isArray(value) ? unique(value.map((id) => String(id)).filter(Boolean)) : [];
}

function toSongList(value: unknown): RawSong[] {
  return Array.isArray(value) ? (value as RawSong[]).filter((song) => song?.id) : [];
}

function toUrlList(value: unknown): RawSongUrl[] {
  return Array.isArray(value) ? (value as RawSongUrl[]).filter((item) => item?.id) : [];
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex]);
      }
    })
  );
  return results;
}

function pickByQuota(items: string[], quota: number) {
  return unique(items).slice(0, Math.max(0, quota));
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function encryptCookieForLocalUse(cookie: string) {
  return `local-dev:${Buffer.from(cookie, "utf8").toString("base64")}`;
}

function buildLoginDeviceCookie(deviceId: string) {
  const encodedDeviceId = encodeURIComponent(deviceId);
  return [
    `deviceId=${encodedDeviceId}`,
    `sDeviceId=${encodedDeviceId}`,
    "os=pc",
    "appver=3.1.17.204416",
    "channel=netease"
  ].join("; ");
}

async function createWebLoginQrImage(key: string, deviceId: string) {
  const qrCode = (await import("qrcode")) as QrCodeModule;
  const url = `https://music.163.com/login?codekey=${encodeURIComponent(key)}&chainId=${encodeURIComponent(
    createChainId(deviceId)
  )}`;
  return qrCode.toDataURL(url);
}

function createChainId(deviceId: string) {
  return `v1_${deviceId}_web_login_${Date.now()}`;
}

function makeDeviceId() {
  const chars = "0123456789ABCDEF";
  let id = "";
  for (let index = 0; index < 52; index += 1) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}
