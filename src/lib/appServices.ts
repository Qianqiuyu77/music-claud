import { DeepSeekProvider } from "@/lib/ai/deepseekProvider";
import type { AiProvider, AiTraceCall } from "@/lib/ai/types";
import { createDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/schema";
import { NeteaseCloudProvider } from "@/lib/netease/cloudProvider";
import { normalizeNeteaseCookie } from "@/lib/netease/cookie";
import { playbackProxyUrl } from "@/lib/playback/url";
import { saveLocalEnvValue } from "@/lib/server/envFile";
import { recommendFromSources } from "@/lib/recommendation/engine";
import type { CandidateSource } from "@/lib/recommendation/engine";
import { ensureDistinctVisibleSongTags, matchingSongTags } from "@/lib/recommendation/songTags";
import type { CandidateSong, ListeningContext } from "@/lib/recommendation/types";
import type { LatestPlayback } from "@/lib/repositories/musicRepository";
import { MusicRepository } from "@/lib/repositories/musicRepository";

type ImportResult = Awaited<ReturnType<NeteaseCloudProvider["importLibrary"]>>;
type LibraryResult = ImportResult & {
  stats?: ReturnType<MusicRepository["getLibraryStats"]>;
};
type RecommendationOptions = {
  limit?: number;
  excludeIds?: string[];
  requireAi?: boolean;
  aiProvider?: AiProvider;
};
type StorageTaggingOptions = {
  limit?: number;
  aiProvider?: AiProvider;
};
type RecommendationFlowExcludedSong = {
  id: string;
  name: string;
  artistNames: string[];
  matchedTags: string[];
};
type RecommendationFlowCooldownSong = {
  id: string;
  name: string;
  artistNames: string[];
  reason: string;
  cooldownDays: number;
};
type PlaybackEventInput = {
  itemId: string;
  playedSeconds: number;
  durationSeconds?: number | null;
  completed?: boolean;
};
const DEFAULT_SYNC_AI_TAG_LIMIT = 100;

const realNetease = new NeteaseCloudProvider();
const feedbackBySongId = new Map<string, CandidateSong["feedback"][number]>();
let musicRepositoryPromise: Promise<MusicRepository> | null = null;
let activeRepository: MusicRepository | null = null;
const repositoryByFilename = new Map<string, Promise<MusicRepository>>();

export async function getSyncPreview() {
  if (hasNeteaseCookie()) {
    const result = await realNetease.importLibrary();
    const repository = await getMusicRepositoryForApp();
    result.songs = mergeStoredAiTagsForImport(result.songs, repository.listCandidateSongs());
    const taggedForStorage = await tagImportedSongsForStorage(result.songs, { limit: DEFAULT_SYNC_AI_TAG_LIMIT });
    result.songs = taggedForStorage.songs;
    result.partialFailures = [...result.partialFailures, ...taggedForStorage.partialFailures];
    repository.upsertCandidateSongs(result.songs);
    repository.recordSync("netease_import", result.songs.length, result.partialFailures);
    return {
      ...result,
      stats: repository.getLibraryStats()
    };
  }
  return {
    songs: [],
    partialFailures: ["缺少网易云 Cookie，不能同步真实音乐数据。"]
  };
}

export async function expandStoredLibrary() {
  const repository = await getMusicRepositoryForApp();
  if (!hasNeteaseCookie()) {
    return {
      songs: [],
      partialFailures: ["缺少网易云 Cookie，不能扩充真实音乐数据。"],
      stats: repository.getLibraryStats()
    };
  }

  const seedSongIds = repository
    .listCandidateSongs()
    .filter((song) => song.sources.includes("liked") || song.sources.includes("playlist"))
    .slice(0, 12)
    .map((song) => song.neteaseSongId);
  const result = await realNetease.expandLibrary({ seedSongIds, limit: 120 });
  result.songs = mergeStoredAiTagsForImport(result.songs, repository.listCandidateSongs());
  const taggedForStorage = await tagImportedSongsForStorage(result.songs, { limit: DEFAULT_SYNC_AI_TAG_LIMIT });
  result.songs = taggedForStorage.songs;
  result.partialFailures = [...result.partialFailures, ...taggedForStorage.partialFailures];
  repository.upsertCandidateSongs(result.songs);
  repository.recordSync("netease_expand", result.songs.length, result.partialFailures);
  return {
    ...result,
    stats: repository.getLibraryStats()
  };
}

export async function tagStoredLibraryBatch(limit = DEFAULT_SYNC_AI_TAG_LIMIT) {
  const repository = await getMusicRepositoryForApp();
  const songs = repository.listCandidateSongs();
  const needsTagging = selectSongsForAiTagging(songs, limit);
  if (!needsTagging.length) {
    return {
      songs: [],
      partialFailures: [],
      stats: repository.getLibraryStats()
    };
  }
  const taggedSongs = await tagSongsForStorage(needsTagging, limit);
  repository.upsertCandidateSongs(taggedSongs);
  repository.recordSync("ai_tag_batch", taggedSongs.length, []);
  return {
    songs: taggedSongs,
    partialFailures: [],
    stats: repository.getLibraryStats()
  };
}

export async function tagImportedSongsForStorage(songs: CandidateSong[], options: StorageTaggingOptions = {}) {
  const limit = options.limit ?? syncAiTagLimit();
  const needsTagging = selectSongsForAiTagging(songs, limit);
  if (!needsTagging.length) {
    return {
      songs,
      partialFailures: []
    };
  }

  const provider = options.aiProvider ?? getAiProvider(true);
  if (!provider.tagSongs) {
    return {
      songs,
      partialFailures: ["AI 打标不可用：当前 provider 不支持 tagSongs。"]
    };
  }

  try {
    const taggedSongs = await provider.tagSongs(needsTagging);
    const taggedById = new Map(taggedSongs.map((song) => [song.neteaseSongId, song]));
    return {
      songs: songs.map((song) => taggedById.get(song.neteaseSongId) ?? song),
      partialFailures: []
    };
  } catch (error) {
    return {
      songs,
      partialFailures: [`AI 打标失败：${errorMessage(error)}`]
    };
  }
}

export async function getStoredLibraryStatus() {
  const repository = await getMusicRepositoryForApp();
  const stats = repository.getLibraryStats();
  const songs = repository.listCandidateSongs();
  return {
    counts: {
      songs: stats.songs,
      playableSongs: stats.playableSongs,
      lastSyncAt: stats.lastSyncAt,
      partialFailures: 0,
      aiTagged: songs.filter(hasAiTaggedMarker).length
    }
  };
}

export async function getLoginQrPreview() {
  if (hasNeteaseCookie()) {
    return { key: "cookie-login", qrUrl: "", source: "cookie" as const };
  }
  if (process.env.NETEASE_USE_REAL_LOGIN === "1") {
    try {
      return await realNetease.getLoginQr();
    } catch {
      return { key: "login-unavailable", qrUrl: "" };
    }
  }
  return { key: "login-unavailable", qrUrl: "" };
}

export async function getLoginStatusPreview(key: string) {
  if (hasNeteaseCookie()) {
    return {
      status: "authorized" as const,
      encryptedCookie: encryptCookieForLocalUse(process.env.NETEASE_COOKIE ?? ""),
      source: "cookie" as const
    };
  }
  if (process.env.NETEASE_USE_REAL_LOGIN === "1" && key !== "login-unavailable") {
    try {
      return await realNetease.getLoginStatus(key);
    } catch {
      return { status: "waiting" as const };
    }
  }
  return { status: "waiting" as const };
}

export async function saveNeteaseCookie(cookie: string) {
  const normalizedCookie = normalizeNeteaseCookie(cookie);
  if (!normalizedCookie.includes("MUSIC_U=") && !normalizedCookie.includes("MUSIC_A=")) {
    return {
      ok: false,
      error: "Cookie 里没有 MUSIC_U 或 MUSIC_A，像是复制错了。"
    };
  }

  process.env.NETEASE_COOKIE = normalizedCookie;
  await saveLocalEnvValue("NETEASE_COOKIE", normalizedCookie);
  return {
    ok: true,
    status: "authorized" as const,
    source: "cookie" as const
  };
}

export function hasConfiguredNeteaseCookie() {
  return hasNeteaseCookie();
}

export function recordRecommendationFeedback(itemId: string, feedback: CandidateSong["feedback"][number]) {
  feedbackBySongId.set(itemId, feedback);
  void getMusicRepositoryForApp().then((repository) => repository.recordFeedbackByNeteaseSongId(itemId, feedback));
  return {
    itemId,
    feedback
  };
}

export async function recordSongPlayback(input: PlaybackEventInput) {
  const playedSeconds = Math.max(0, Math.floor(input.playedSeconds));
  const durationSeconds = input.durationSeconds === null || input.durationSeconds === undefined ? null : Math.max(0, Math.floor(input.durationSeconds));
  const completed = Boolean(input.completed) || Boolean(durationSeconds && durationSeconds > 0 && playedSeconds / durationSeconds >= 0.8);
  const significant = completed || playedSeconds >= 30 || Boolean(durationSeconds && durationSeconds > 0 && playedSeconds / durationSeconds >= 0.4);
  if (!significant) {
    return { itemId: input.itemId, saved: false, reason: "播放时长不足，未进入冷却。" };
  }
  const repository = await getMusicRepositoryForApp();
  repository.recordPlaybackByNeteaseSongId(input.itemId, {
    playedSeconds,
    durationSeconds,
    completed
  });
  return { itemId: input.itemId, saved: true, completed };
}

export async function createRecommendationResponse(
  prompt: string,
  importedLibrary?: ImportResult,
  options: RecommendationOptions = {}
) {
  const limit = clampRecommendationLimit(options.limit ?? 12);
  const excludeIds = new Set((options.excludeIds ?? []).filter(Boolean));
  const library: LibraryResult = importedLibrary ?? (await getStoredLibrary());
  const feedbackSongs = applyStoredFeedback(library.songs);
  const latestPlayback = importedLibrary ? new Map<string, LatestPlayback>() : await getLatestPlaybackForSongs(feedbackSongs);
  const cooldownExcluded = collectCooldownExcluded(feedbackSongs, latestPlayback);
  const cooldownExcludedIds = new Set(cooldownExcluded.map((song) => song.id));
  const songs = feedbackSongs.filter((song) => !excludeIds.has(song.neteaseSongId) && !cooldownExcludedIds.has(song.neteaseSongId));
  if (!songs.length) {
    throw new Error(hasNeteaseCookie() ? "本地曲库为空，请先同步网易云歌曲。" : "缺少网易云 Cookie 或本地曲库，不能生成真实推荐。");
  }

  const hasInjectedAiProvider = Boolean(options.aiProvider);
  const recommendationAi = options.aiProvider ?? getAiProvider(options.requireAi ?? false);
  recommendationAi.clearTrace?.();
  const profileData = {};
  const preferenceTrace: AiTraceCall[] = [];
  const profileSummary = hasProfileData(profileData)
    ? await recommendationAi.summarizePreference(profileData)
    : "";
  if (!profileSummary) {
    preferenceTrace.push({
      id: "preference-skipped-1",
      stage: "preference",
      title: "AI 偏好摘要已跳过",
      request: { profileData },
      rawResponse: "",
      parsed: { skipped: true, reason: "缺少用户画像，未调用 AI 偏好摘要。" },
      createdAt: new Date().toISOString()
    });
  }
  const context = await recommendationAi.parseListeningContext(prompt, profileSummary);
  const sources = buildCandidateSources(songs);
  const ranked = await recommendFromSources(sources, context, Math.min(160, Math.max(limit * 8, limit)));
  const enriched = await enrichRankedRecommendations(ranked);
  const excludedByTags = collectExcludedByTags(enriched.ranked.map((item) => item.song), context.excludeTags ?? []);
  const filteredRanked = enriched.ranked.filter((item) => !excludedByTags.some((excluded) => excluded.id === item.song.neteaseSongId));
  const aiRanked = await rerankWithAi(recommendationAi, filteredRanked, context, limit, options.requireAi ?? false, hasInjectedAiProvider);
  const aiTrace = normalizeAiTrace([...preferenceTrace, ...(recommendationAi.getTrace?.() ?? [])]);

  return {
    context,
    strategy: {
      candidateSources: sources.map((source) => source.name),
      novelty: context.novelty,
      partialFailures: [...library.partialFailures, ...enriched.partialFailures]
    },
    libraryCounts: {
      songs: library.songs.length,
      playableSongs: library.songs.filter((song) => song.streamUrl).length,
      lastSyncAt: library.stats?.lastSyncAt ?? null,
      partialFailures: library.partialFailures.length + enriched.partialFailures.length
    },
    page: {
      requested: limit,
      returned: aiRanked.length,
      excluded: excludeIds.size,
      hasMore: songs.length > aiRanked.length
    },
    flow: {
      input: {
        prompt,
        requested: limit,
        excludedPlayedIds: Array.from(excludeIds)
      },
      context,
      library: {
        totalSongs: library.songs.length,
        afterPlayedExclusion: songs.length,
        sourceNames: sources.map((source) => source.name)
      },
      tags: buildTagAudit(library.songs),
      filters: {
        excludeTags: context.excludeTags ?? [],
        excludedByTags,
        cooldownExcluded
      },
      ranking: {
        localRankedCount: ranked.length,
        afterTagFilterCount: filteredRanked.length,
        aiRerankedCount: aiRanked.length,
        aiSelectedCount: aiRanked.filter((item) => item.selectionSource === "ai").length,
        localFillCount: aiRanked.filter((item) => item.selectionSource === "local_fill").length,
        finalCount: aiRanked.length,
        topLocal: summarizeRanked(enriched.ranked, 8),
        final: summarizeRanked(aiRanked, limit)
      },
      ai: {
        calls: aiTrace
      }
    },
    items: aiRanked.map((item, index) => ({
      id: item.song.neteaseSongId,
      rank: index + 1,
      song: item.song,
      score: item.score,
      reason: item.reason,
      scoreBreakdown: item.breakdown,
      selectionSource: item.selectionSource,
      streamUrl: playbackProxyUrl(item.song.neteaseSongId),
      embedUrl: `https://music.163.com/outchain/player?type=2&id=${item.song.neteaseSongId}&auto=0&height=66`,
      playbackUrl: `https://music.163.com/#/song?id=${item.song.neteaseSongId}`
    }))
  };
}

export async function createDefaultLikedQueueResponse(options: { limit?: number } = {}) {
  const limit = clampRecommendationLimit(options.limit ?? 12);
  const library = await getStoredLibrary();
  const latestPlayback = await getLatestPlaybackForSongs(library.songs);
  const cooldownExcluded = collectCooldownExcluded(library.songs, latestPlayback);
  const cooldownExcludedIds = new Set(cooldownExcluded.map((song) => song.id));
  const candidates = library.songs.filter(
    (song) =>
      Boolean(song.streamUrl) &&
      !cooldownExcludedIds.has(song.neteaseSongId) &&
      (song.sources.includes("liked") || song.tags.includes("liked") || song.tags.includes("source:liked"))
  );

  if (!candidates.length) {
    throw new Error("本地曲库里没有可播放的我喜欢歌曲。");
  }

  const ranked = shuffleSongs(candidates)
    .slice(0, limit)
    .map((song, index) => ({
      song,
      score: 100 - index,
      reason: "来自你的我喜欢随机播放，不是 AI 推荐。",
      breakdown: emptyScoreBreakdown(),
      selectionSource: "default_liked" as const
    }));
  const context = {
    scene: "default_liked",
    mood: [],
    energy: "unknown" as const,
    vocal: "unknown" as const,
    novelty: "balanced" as const,
    avoid: [],
    targetTags: [],
    excludeTags: []
  };

  return {
    context,
    strategy: {
      candidateSources: ["liked"],
      novelty: context.novelty,
      partialFailures: library.partialFailures
    },
    libraryCounts: {
      songs: library.songs.length,
      playableSongs: library.songs.filter((song) => song.streamUrl).length,
      lastSyncAt: library.stats?.lastSyncAt ?? null,
      partialFailures: library.partialFailures.length
    },
    page: {
      requested: limit,
      returned: ranked.length,
      excluded: 0,
      hasMore: candidates.length > ranked.length
    },
    flow: {
      input: {
        prompt: "默认我喜欢随机播放",
        requested: limit,
        excludedPlayedIds: []
      },
      context,
      library: {
        totalSongs: library.songs.length,
        afterPlayedExclusion: candidates.length,
        sourceNames: ["liked"]
      },
      tags: buildTagAudit(library.songs),
      filters: {
        excludeTags: [],
        excludedByTags: [],
        cooldownExcluded
      },
      ranking: {
        localRankedCount: candidates.length,
        afterTagFilterCount: candidates.length,
        aiRerankedCount: 0,
        aiSelectedCount: 0,
        localFillCount: 0,
        finalCount: ranked.length,
        topLocal: summarizeRanked(ranked, Math.min(8, ranked.length)),
        final: summarizeRanked(ranked, ranked.length)
      },
      ai: {
        calls: []
      }
    },
    items: ranked.map((item, index) => ({
      id: item.song.neteaseSongId,
      rank: index + 1,
      song: item.song,
      score: item.score,
      reason: item.reason,
      scoreBreakdown: item.breakdown,
      selectionSource: item.selectionSource,
      streamUrl: playbackProxyUrl(item.song.neteaseSongId),
      embedUrl: `https://music.163.com/outchain/player?type=2&id=${item.song.neteaseSongId}&auto=0&height=66`,
      playbackUrl: `https://music.163.com/#/song?id=${item.song.neteaseSongId}`
    }))
  };
}

function normalizeAiTrace(calls: AiTraceCall[]) {
  return calls.map((call, index) => ({
    id: call.id ?? `${call.stage || "ai"}-${index + 1}`,
    stage: call.stage ?? "ai",
    title: call.title ?? `AI 调用 ${index + 1}`,
    model: call.model,
    request: call.request,
    rawResponse: call.rawResponse ?? "",
    parsed: call.parsed,
    createdAt: call.createdAt ?? new Date().toISOString()
  }));
}

export async function getMusicRepositoryForApp() {
  const filename = process.env.MUSIC_DB_PATH ?? "data/music.sqlite";
  const cached = repositoryByFilename.get(filename);
  if (cached) {
    musicRepositoryPromise = cached;
    activeRepository = await cached;
    return activeRepository;
  }
  if (!musicRepositoryPromise) {
    musicRepositoryPromise = createDatabase(filename).then((db) => {
      migrate(db);
      activeRepository = new MusicRepository(db);
      return activeRepository;
    });
    repositoryByFilename.set(filename, musicRepositoryPromise);
  }
  return musicRepositoryPromise;
}

export function resetAppServicesForTests() {
  feedbackBySongId.clear();
  activeRepository = null;
  musicRepositoryPromise = null;
  repositoryByFilename.clear();
}

export function mergeStoredAiTagsForImport(importedSongs: CandidateSong[], storedSongs: CandidateSong[]) {
  const storedById = new Map(storedSongs.map((song) => [song.neteaseSongId, song]));
  return importedSongs.map((song) => {
    const stored = storedById.get(song.neteaseSongId);
    if (!stored || !hasAiTaggedMarker(stored)) return song;
    const preservedTags = stored.tags.filter((tag) => tag !== "playback:playable" && tag !== "playback:copyright_limited");
    const playbackTag = song.streamUrl ? "playback:playable" : "playback:copyright_limited";
    return {
      ...song,
      tags: Array.from(new Set([...song.tags, ...preservedTags, playbackTag]))
    };
  });
}

export function selectSongsForAiTagging(songs: CandidateSong[], limit = DEFAULT_SYNC_AI_TAG_LIMIT) {
  if (limit <= 0) return [];
  return songs.filter((song) => !hasAiTaggedMarker(song)).slice(0, Math.floor(limit));
}

async function getStoredLibrary(): Promise<LibraryResult> {
  const repository = await getMusicRepositoryForApp();
  return {
    songs: repository.listCandidateSongs(),
    partialFailures: [],
    stats: repository.getLibraryStats()
  };
}

async function enrichRankedRecommendations(ranked: Awaited<ReturnType<typeof recommendFromSources>>) {
  const distinctSongs = ensureDistinctVisibleSongTags(ranked.map((item) => item.song));
  const songById = new Map(distinctSongs.map((song) => [song.neteaseSongId, song]));

  return {
    partialFailures: [],
    ranked: ranked.map((item) => ({
      ...item,
      song: songById.get(item.song.neteaseSongId) ?? item.song
    }))
  };
}

function applyStoredFeedback(songs: CandidateSong[]) {
  return songs.map((song) => {
    const feedback = feedbackBySongId.get(song.neteaseSongId);
    if (!feedback) return song;
    return {
      ...song,
      feedback: Array.from(new Set([...song.feedback, feedback]))
    };
  });
}

function buildCandidateSources(songs: CandidateSong[]): CandidateSource[] {
  const names = Array.from(new Set(songs.flatMap((song) => song.sources)));
  return names.map((name) => ({
    name,
    async getCandidates(_context: ListeningContext) {
      return songs.filter((song) => song.sources.includes(name));
    }
  }));
}

function hasNeteaseCookie() {
  return Boolean(process.env.NETEASE_COOKIE?.trim());
}

function hasProfileData(profileData: unknown) {
  if (profileData === null || profileData === undefined) return false;
  if (typeof profileData === "string") return profileData.trim().length > 0;
  if (Array.isArray(profileData)) return profileData.length > 0;
  if (typeof profileData === "object") return Object.keys(profileData).length > 0;
  return true;
}

async function tagSongsForStorage(songs: CandidateSong[], limit = syncAiTagLimit()) {
  if (!songs.length) return songs;
  if (!process.env.DEEPSEEK_API_KEY?.trim() && process.env.NODE_ENV === "test") return songs;
  const result = await tagImportedSongsForStorage(songs, { limit });
  return result.songs;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function syncAiTagLimit() {
  const value = Number(process.env.SYNC_AI_TAG_LIMIT ?? DEFAULT_SYNC_AI_TAG_LIMIT);
  if (!Number.isFinite(value)) return DEFAULT_SYNC_AI_TAG_LIMIT;
  return Math.max(0, Math.floor(value));
}

async function rerankWithAi(
  provider: AiProvider,
  ranked: Awaited<ReturnType<typeof recommendFromSources>>,
  context: ListeningContext,
  limit: number,
  requireAi: boolean,
  hasInjectedAiProvider: boolean
) {
  const hasDeepSeekKey = Boolean(process.env.DEEPSEEK_API_KEY?.trim());
  if (requireAi && !hasDeepSeekKey && !hasInjectedAiProvider) {
    throw new Error("DeepSeek API Key 未配置，不能跳过 AI 推荐排序。");
  }
  if (provider.rerankRecommendations && (hasDeepSeekKey || hasInjectedAiProvider)) {
    return provider.rerankRecommendations(ranked, context).then((items) => fillRecommendations(items, ranked, limit));
  }
  if (requireAi) {
    throw new Error("DeepSeek 推荐排序不可用，不能使用本地兜底排序。");
  }
  return fillRecommendations(ranked, ranked, limit);
}

function getAiProvider(requireAi: boolean) {
  return new DeepSeekProvider({ allowFallback: !requireAi });
}

function fillRecommendations(primary: Awaited<ReturnType<typeof recommendFromSources>>, fallback: Awaited<ReturnType<typeof recommendFromSources>>, limit: number) {
  const used = new Set<string>();
  const result: Awaited<ReturnType<typeof recommendFromSources>> = [];
  for (const item of primary) {
    if (!item.song.streamUrl) continue;
    if (used.has(item.song.neteaseSongId)) continue;
    used.add(item.song.neteaseSongId);
    result.push({ ...item, selectionSource: item.selectionSource ?? "ai" });
    if (result.length >= limit) break;
  }
  if (result.length >= limit) return result;
  for (const item of fallback) {
    if (!item.song.streamUrl) continue;
    if (used.has(item.song.neteaseSongId)) continue;
    used.add(item.song.neteaseSongId);
    result.push({ ...item, selectionSource: item.selectionSource ?? "local_fill" });
    if (result.length >= limit) break;
  }
  return result;
}

function collectExcludedByTags(songs: CandidateSong[], excludeTags: string[]): RecommendationFlowExcludedSong[] {
  if (!excludeTags.length) return [];
  const excluded = [];
  const seen = new Set<string>();
  for (const song of songs) {
    if (seen.has(song.neteaseSongId)) continue;
    const matchedTags = matchingSongTags(song.tags, excludeTags);
    if (!matchedTags.length) continue;
    seen.add(song.neteaseSongId);
    excluded.push({
      id: song.neteaseSongId,
      name: song.name,
      artistNames: song.artistNames,
      matchedTags
    });
  }
  return excluded;
}

async function getLatestPlaybackForSongs(songs: CandidateSong[]) {
  const repository = await getMusicRepositoryForApp();
  return repository.listLatestPlaybackByNeteaseSongIds(songs.map((song) => song.neteaseSongId));
}

function collectCooldownExcluded(songs: CandidateSong[], latestPlayback: Map<string, LatestPlayback>): RecommendationFlowCooldownSong[] {
  const excluded: RecommendationFlowCooldownSong[] = [];
  const now = Date.now();
  for (const song of songs) {
    const playback = latestPlayback.get(song.neteaseSongId);
    if (!playback) continue;
    const ageDays = daysBetween(playback.createdAt, now);
    const cooldownDays = playback.completed ? 7 : 2;
    if (ageDays >= cooldownDays) continue;
    excluded.push({
      id: song.neteaseSongId,
      name: song.name,
      artistNames: song.artistNames,
      reason: playback.completed ? "完整播放 7 天冷却" : "已听过 2 天冷却",
      cooldownDays
    });
  }
  return excluded;
}

function daysBetween(isoDate: string, now: number) {
  const timestamp = new Date(isoDate).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, Math.floor((now - timestamp) / 86_400_000));
}

function hasAiTaggedMarker(song: CandidateSong) {
  return song.tags.includes("ai:tagged") || song.tags.includes("ai_tagged");
}

function buildTagAudit(songs: CandidateSong[]) {
  const aiTaggedSongs = songs.filter(hasAiTaggedMarker).length;
  const examples = Array.from(new Set(songs.flatMap((song) => song.tags).filter((tag) => tag.startsWith("ai:")))).slice(0, 12);
  return {
    totalSongs: songs.length,
    aiTaggedSongs,
    aiTagCoverage: songs.length ? aiTaggedSongs / songs.length : 0,
    examples
  };
}

function summarizeRanked(items: Awaited<ReturnType<typeof recommendFromSources>>, limit: number) {
  return items.slice(0, limit).map((item, index) => ({
    id: item.song.neteaseSongId,
    name: item.song.name,
    artistNames: item.song.artistNames,
    score: Number(item.score.toFixed(2)),
    tags: item.song.tags,
    reason: item.reason,
    rank: index + 1,
    selectionSource: item.selectionSource
  }));
}

function shuffleSongs(songs: CandidateSong[]) {
  return songs
    .map((song) => ({ song, sort: Math.random() }))
    .sort((left, right) => left.sort - right.sort)
    .map(({ song }) => song);
}

function emptyScoreBreakdown() {
  return {
    longTermPreferenceScore: 0,
    contextMatchScore: 0,
    sourceConfidenceScore: 0,
    noveltyScore: 0,
    feedbackAdjustmentScore: 0,
    implicitBehaviorScore: 0,
    repetitionPenalty: 0,
    fatiguePenalty: 0,
    negativeFeedbackPenalty: 0
  };
}

function clampRecommendationLimit(limit: number) {
  if (!Number.isFinite(limit)) return 12;
  return Math.min(30, Math.max(1, Math.floor(limit)));
}

function encryptCookieForLocalUse(cookie: string) {
  return `local-dev:${Buffer.from(cookie, "utf8").toString("base64")}`;
}
