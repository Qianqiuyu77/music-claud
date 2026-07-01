import { DeepSeekProvider } from "@/lib/ai/deepseekProvider";
import type { AiProvider, AiTraceCall, CompanionChatInput } from "@/lib/ai/types";
import { createDatabase, type AppDatabase } from "@/lib/db/client";
import { migrate } from "@/lib/db/schema";
import { NeteaseCloudProvider } from "@/lib/netease/cloudProvider";
import { normalizeNeteaseCookie } from "@/lib/netease/cookie";
import { playbackProxyUrl } from "@/lib/playback/url";
import { saveLocalEnvValue } from "@/lib/server/envFile";
import { recommendFromSources } from "@/lib/recommendation/engine";
import type { CandidateSource } from "@/lib/recommendation/engine";
import { ensureDistinctVisibleSongTags, matchingSongTags } from "@/lib/recommendation/songTags";
import type { CandidateSong, ListeningContext, RecommendationMode, RecommendationScene } from "@/lib/recommendation/types";
import type { LatestPlayback } from "@/lib/repositories/musicRepository";
import { MusicRepository } from "@/lib/repositories/musicRepository";
import { TaggingQueueRepository } from "@/lib/repositories/taggingQueueRepository";
import { UserProfileRepository } from "@/lib/repositories/userProfileRepository";
import { UserRepository } from "@/lib/repositories/userRepository";
import { buildUserProfile } from "@/lib/profile/userProfileBuilder";
import { resolveCurrentUser } from "@/lib/user/currentUser";

type ImportResult = Awaited<ReturnType<NeteaseCloudProvider["importLibrary"]>>;
type LibraryResult = ImportResult & {
  stats?: ReturnType<MusicRepository["getLibraryStats"]>;
};
type RecommendationOptions = {
  limit?: number;
  excludeIds?: string[];
  requireAi?: boolean;
  aiProvider?: AiProvider;
  mode?: RecommendationMode;
  scene?: RecommendationScene;
  userId?: number;
};
type StorageTaggingOptions = {
  limit?: number;
  aiProvider?: AiProvider;
};
type SyncPreviewOptions = {
  userId?: number;
  provider?: Pick<NeteaseCloudProvider, "getAccountProfile" | "importLibrary">;
  quick?: boolean;
};
type ExpandLibraryOptions = {
  userId?: number;
  provider?: Pick<NeteaseCloudProvider, "expandLibrary">;
};
type RefreshUserProfileOptions = {
  aiProvider?: Pick<AiProvider, "summarizePreference">;
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
const QUICK_SYNC_IMPORT_LIMIT = 120;
const DEFAULT_TAGGING_QUEUE_BATCH_LIMIT = 20;
const DEFAULT_TAGGING_QUEUE_MAX_ATTEMPTS = 3;
const DEFAULT_TAGGING_QUEUE_RETRY_DELAY_SECONDS = 5 * 60;
const LOCAL_RERANK_CANDIDATE_LIMIT = 200;
const AI_RERANK_TARGET_COUNT = 50;
const DEFAULT_OWNER_USER_ID = 1;
const USER_PROFILE_STALE_MS = 24 * 60 * 60 * 1000;
export class NeteaseLoginExpiredError extends Error {
  constructor() {
    super("NetEase login expired. Please scan the QR code again.");
    this.name = "NeteaseLoginExpiredError";
  }
}
export class UserSongAccessError extends Error {
  constructor() {
    super("Song is not in the current user's library.");
    this.name = "UserSongAccessError";
  }
}

export async function assertUserCanAccessSong(userId: number, itemId: string) {
  const repository = await getMusicRepositoryForApp();
  if (!repository.listCandidateSongsForUser(userId).some((song) => song.neteaseSongId === itemId)) {
    throw new UserSongAccessError();
  }
}

const realNetease = new NeteaseCloudProvider();
let musicRepositoryPromise: Promise<MusicRepository> | null = null;
let activeRepository: MusicRepository | null = null;
const repositoryByFilename = new Map<string, Promise<MusicRepository>>();

export async function getSyncPreview(options: SyncPreviewOptions = {}) {
  const userId = options.userId ?? DEFAULT_OWNER_USER_ID;
  const provider = options.provider ?? realNetease;
  const cookie = await getNeteaseCookieForUser(userId);
  if (cookie) {
    try {
      await provider.getAccountProfile(cookie);
    } catch {
      await expireLoginStateForUser(userId);
      throw new NeteaseLoginExpiredError();
    }
    const result = options.quick ? await provider.importLibrary(cookie, { quick: true, limit: QUICK_SYNC_IMPORT_LIMIT }) : await provider.importLibrary(cookie);
    const repository = await getMusicRepositoryForApp();
    result.songs = mergeStoredAiTagsForImport(result.songs, repository.listCandidateSongs());
    const taggedForStorage = await tagImportedSongsForStorage(result.songs, { limit: options.quick ? 0 : DEFAULT_SYNC_AI_TAG_LIMIT });
    result.songs = taggedForStorage.songs;
    result.partialFailures = [...result.partialFailures, ...taggedForStorage.partialFailures];
    repository.upsertCandidateSongsForUser(userId, result.songs);
    enqueueMissingTagJobs(repository, result.songs, "sync");
    repository.recordSync("netease_import", result.songs.length, result.partialFailures);
    await refreshUserProfile(userId);
    return {
      ...result,
      stats: repository.getLibraryStats()
    };
  }
  return {
    songs: [],
    partialFailures: ["Missing NetEase Cookie; cannot sync library."]
  };
}

export async function expandStoredLibrary(options: ExpandLibraryOptions = {}) {
  const userId = options.userId ?? DEFAULT_OWNER_USER_ID;
  const provider = options.provider ?? realNetease;
  const repository = await getMusicRepositoryForApp();
  const cookie = await getNeteaseCookieForUser(userId);
  if (!cookie) {
    return {
      songs: [],
      partialFailures: ["Missing NetEase Cookie; cannot expand library."],
      stats: repository.getLibraryStats()
    };
  }

  const seedSongIds = repository
    .listCandidateSongsForUser(userId)
    .filter((song) => song.sources.includes("liked") || song.sources.includes("playlist"))
    .slice(0, 12)
    .map((song) => song.neteaseSongId);
  const expanded = await provider.expandLibrary?.({ seedSongIds, limit: 120 }, cookie);
  const result = expanded ?? { songs: [], partialFailures: ["网易云扩充接口不可用。"] };
  result.songs = mergeStoredAiTagsForImport(result.songs, repository.listCandidateSongs());
  const taggedForStorage = await tagImportedSongsForStorage(result.songs, { limit: DEFAULT_SYNC_AI_TAG_LIMIT });
  result.songs = taggedForStorage.songs;
  result.partialFailures = [...result.partialFailures, ...taggedForStorage.partialFailures];
  repository.upsertCandidateSongsForUser(userId, result.songs);
  enqueueMissingTagJobs(repository, result.songs, "expand");
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

export async function processTaggingQueueBatch(options: { limit?: number; aiProvider?: AiProvider } = {}) {
  const repository = await getMusicRepositoryForApp();
  const queue = new TaggingQueueRepository((repository as unknown as { db: AppDatabase }).db);
  const jobs = queue.claimPending(taggingQueueBatchLimit(options.limit));
  if (!jobs.length) return { processed: 0, succeeded: 0, failed: 0, songs: [] as CandidateSong[] };
  const retryPolicy = taggingQueueRetryPolicy();

  const songsById = new Map(repository.listCandidateSongs().map((song) => [song.neteaseSongId, song]));
  const songRowsById = repository.listSongs();
  const neteaseIdBySongId = new Map(songRowsById.map((row) => [row.id, row.netease_song_id]));
  let succeeded = 0;
  let failed = 0;
  const updatedSongs: CandidateSong[] = [];

  for (const job of jobs) {
    const neteaseSongId = neteaseIdBySongId.get(job.songId);
    const song = neteaseSongId ? songsById.get(neteaseSongId) : null;
    if (!song) {
      queue.markFailed(job.id, retryPolicy);
      failed += 1;
      continue;
    }
    const result = await tagImportedSongsForStorage([song], { aiProvider: options.aiProvider, limit: 1 });
    const taggedSong = result.songs[0];
    if (result.partialFailures.length || !taggedSong || !hasAiTaggedMarker(taggedSong)) {
      queue.markFailed(job.id, retryPolicy);
      failed += 1;
      continue;
    }
    repository.replaceCandidateSongTags(taggedSong);
    queue.markDone(job.id);
    updatedSongs.push(taggedSong);
    succeeded += 1;
  }

  return { processed: jobs.length, succeeded, failed, songs: updatedSongs };
}

export async function refreshUserProfile(userId = DEFAULT_OWNER_USER_ID, options: RefreshUserProfileOptions = {}) {
  const repository = await getMusicRepositoryForApp();
  const db = (repository as unknown as { db: AppDatabase }).db;
  const profileRepository = new UserProfileRepository(db);
  const profile = await compactUserProfileWithAi(buildUserProfile(userId, repository.listCandidateSongsForUser(userId)), options.aiProvider);
  profileRepository.save(profile);
  return profileRepository.getByUserId(userId) ?? profile;
}

export async function getUserProfileDiagnostics(userId = DEFAULT_OWNER_USER_ID) {
  const repository = await getMusicRepositoryForApp();
  const db = (repository as unknown as { db: AppDatabase }).db;
  const profile = new UserProfileRepository(db).getByUserId(userId);
  if (!profile) {
    return {
      exists: false,
      confidence: null,
      stale: true,
      lastRefreshedAt: null,
      summaryLength: 0
    };
  }
  return {
    exists: true,
    confidence: profile.confidence,
    stale: isUserProfileStale(profile.lastRefreshedAt),
    lastRefreshedAt: profile.lastRefreshedAt ?? null,
    summaryLength: profile.compactSummary.length
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
      partialFailures: ["AI tagging is unavailable: provider does not support tagSongs."]
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
      partialFailures: [`AI tagging failed: ${errorMessage(error)}`]
    };
  }
}

export async function getStoredLibraryStatus(userId = DEFAULT_OWNER_USER_ID) {
  const repository = await getMusicRepositoryForApp();
  const stats = repository.getLibraryStats();
  const songs = repository.listCandidateSongsForUser(userId);
  const hasPrivateLibrary = songs.length > 0;
  return {
    counts: {
      songs: songs.length,
      playableSongs: songs.filter((song) => song.streamUrl).length,
      lastSyncAt: hasPrivateLibrary ? stats.lastSyncAt : null,
      partialFailures: 0,
      aiTagged: songs.filter(hasAiTaggedMarker).length
    }
  };
}

export async function getLoginQrPreview(forceRealLogin = false, options: { userId?: number } = {}) {
  const userId = options.userId ?? DEFAULT_OWNER_USER_ID;
  if (!forceRealLogin && (await getNeteaseCookieForUser(userId))) {
    return { key: "cookie-login", qrUrl: "", source: "cookie" as const };
  }
  if (forceRealLogin || process.env.NETEASE_USE_REAL_LOGIN === "1") {
    try {
      return await realNetease.getLoginQr();
    } catch {
      return { key: "login-unavailable", qrUrl: "" };
    }
  }
  return { key: "login-unavailable", qrUrl: "" };
}

type LoginStatusProvider = Pick<NeteaseCloudProvider, "getLoginStatus">;

export async function getLoginStatusPreview(
  key: string,
  forceRealLogin = false,
  provider: LoginStatusProvider = realNetease,
  options: { userId?: number; persist?: boolean } = {}
) {
  const userId = options.userId ?? DEFAULT_OWNER_USER_ID;
  if (!forceRealLogin && (await getNeteaseCookieForUser(userId))) {
    return {
      status: "authorized" as const,
      source: "cookie" as const
    };
  }
  if ((forceRealLogin || process.env.NETEASE_USE_REAL_LOGIN === "1") && key !== "login-unavailable") {
    try {
      const status = await provider.getLoginStatus(key);
      if (status.status === "authorized" && status.rawCookie) {
        if (options.persist === false) return { status: "waiting" as const };
        const saved = await persistNeteaseCookie(status.rawCookie, "qr", true, options);
        if (!saved.ok) return { status: "waiting" as const };
        return {
          status: "authorized" as const,
          source: "qr" as const
        };
      }
      return stripRawCookie(status);
    } catch {
      return { status: "waiting" as const };
    }
  }
  return { status: "waiting" as const };
}

export async function getNeteaseCookieDiagnostics() {
  const cookie = process.env.NETEASE_COOKIE?.trim() ?? "";
  const configured = hasNeteaseCookie();
  if (!configured) {
    return {
      configured: false,
      valid: false,
      cookiePreview: "",
      account: null
    };
  }

  try {
    const result = await realNetease.getAccountProfile(cookie);
    return {
      configured: true,
      valid: true,
      cookiePreview: "",
      account: result
    };
  } catch (error) {
    return {
      configured: true,
      valid: false,
      cookiePreview: "",
      account: null,
      error: errorMessage(error)
    };
  }
}

export async function saveNeteaseCookie(cookie: string, options: { userId?: number } = {}) {
  return persistNeteaseCookie(cookie, "cookie", false, options);
}

async function persistNeteaseCookie(cookie: string, source: "cookie" | "qr", includeEncryptedCookie: true): Promise<
  | {
      ok: true;
      status: "authorized";
      source: "cookie" | "qr";
    }
  | {
      ok: false;
      error: string;
    }
>;
async function persistNeteaseCookie(cookie: string, source: "cookie" | "qr", includeEncryptedCookie: true, options: { userId?: number }): Promise<
  | {
      ok: true;
      status: "authorized";
      source: "cookie" | "qr";
    }
  | {
      ok: false;
      error: string;
    }
>;
async function persistNeteaseCookie(cookie: string, source: "cookie" | "qr", includeEncryptedCookie: false, options?: { userId?: number }): Promise<
  | {
      ok: true;
      status: "authorized";
      source: "cookie" | "qr";
    }
  | {
      ok: false;
      error: string;
    }
>;
async function persistNeteaseCookie(cookie: string, source: "cookie" | "qr", includeEncryptedCookie: boolean, options: { userId?: number } = {}) {
  const normalizedCookie = normalizeNeteaseCookie(cookie);
  if (!normalizedCookie.includes("MUSIC_U=") && !normalizedCookie.includes("MUSIC_A=")) {
    return {
      ok: false,
      error: "Cookie must include MUSIC_U or MUSIC_A."
    };
  }

  const userId = options.userId ?? DEFAULT_OWNER_USER_ID;
  if (userId === DEFAULT_OWNER_USER_ID) {
    process.env.NETEASE_COOKIE = normalizedCookie;
    await saveLocalEnvValue("NETEASE_COOKIE", normalizedCookie);
  }
  await persistLoginState(userId, normalizedCookie, source);
  return {
    ok: true,
    status: "authorized" as const,
    source
  };
}

async function persistLoginState(userId: number, cookie: string, source: "cookie" | "qr") {
  const repository = await getMusicRepositoryForApp();
  const db = (repository as unknown as { db: AppDatabase }).db;
  const users = new UserRepository(db);
  users.saveLoginState({
    userId,
    provider: "netease",
    encryptedCookie: encryptCookieForLocalUse(cookie),
    status: "active",
    source
  });
}

export async function getNeteaseCookieForUser(userId: number) {
  const repository = await getMusicRepositoryForApp();
  const db = (repository as unknown as { db: AppDatabase }).db;
  const state = new UserRepository(db).getLoginState(userId, "netease");
  if (state?.status === "active") {
    return decryptCookieForLocalUse(state.encryptedCookie);
  }
  if (userId === DEFAULT_OWNER_USER_ID) {
    return process.env.NETEASE_COOKIE?.trim() || null;
  }
  return null;
}

export function hasConfiguredNeteaseCookie() {
  return hasNeteaseCookie();
}

export async function getCurrentUserLoginStatus(request: Request) {
  const repository = await getMusicRepositoryForApp();
  const db = (repository as unknown as { db: AppDatabase }).db;
  const user = resolveCurrentUser(db, request);
  const state = new UserRepository(db).getLoginState(user.id, "netease");
  if (!state) {
    return {
      provider: "netease" as const,
      status: "missing" as const,
      source: null,
      lastVerifiedAt: null
    };
  }
  return safeLoginState(state);
}

export async function markUserLoginExpired(request: Request, reason = "expired") {
  const repository = await getMusicRepositoryForApp();
  const db = (repository as unknown as { db: AppDatabase }).db;
  const user = resolveCurrentUser(db, request);
  const users = new UserRepository(db);
  const state = users.getLoginState(user.id, "netease");
  if (!state) {
    return {
      provider: "netease" as const,
      status: "missing" as const,
      source: null,
      reason
    };
  }
  users.updateLoginStateStatus(user.id, "netease", "expired");
  return {
    provider: "netease" as const,
    status: "expired" as const,
    source: state.source,
    reason
  };
}

async function expireLoginStateForUser(userId: number) {
  const repository = await getMusicRepositoryForApp();
  const db = (repository as unknown as { db: AppDatabase }).db;
  const users = new UserRepository(db);
  const state = users.getLoginState(userId, "netease");
  if (state) {
    users.updateLoginStateStatus(userId, "netease", "expired");
  }
}

export async function recordRecommendationFeedback(itemId: string, feedback: CandidateSong["feedback"][number], options: { userId?: number } = {}) {
  const userId = options.userId ?? DEFAULT_OWNER_USER_ID;
  await assertUserCanAccessSong(userId, itemId);
  const repository = await getMusicRepositoryForApp();
  repository.recordFeedbackByNeteaseSongIdForUser(userId, itemId, feedback);
  await refreshUserProfile(userId);
  return {
    itemId,
    feedback
  };
}

export async function recordSongPlayback(input: PlaybackEventInput, options: { userId?: number } = {}) {
  const userId = options.userId ?? DEFAULT_OWNER_USER_ID;
  const playedSeconds = Math.max(0, Math.floor(input.playedSeconds));
  const durationSeconds = input.durationSeconds === null || input.durationSeconds === undefined ? null : Math.max(0, Math.floor(input.durationSeconds));
  const completed = Boolean(input.completed) || Boolean(durationSeconds && durationSeconds > 0 && playedSeconds / durationSeconds >= 0.8);
  const significant = completed || playedSeconds >= 30 || Boolean(durationSeconds && durationSeconds > 0 && playedSeconds / durationSeconds >= 0.4);
  if (!significant) {
    return { itemId: input.itemId, saved: false, reason: "Playback duration is too short for cooldown." };
  }
  await assertUserCanAccessSong(userId, input.itemId);
  const repository = await getMusicRepositoryForApp();
  repository.recordPlaybackByNeteaseSongIdForUser(userId, input.itemId, {
    playedSeconds,
    durationSeconds,
    completed
  });
  await refreshUserProfile(userId);
  return { itemId: input.itemId, saved: true, completed };
}

export async function createRecommendationResponse(
  prompt: string,
  importedLibrary?: ImportResult,
  options: RecommendationOptions = {}
) {
  const limit = clampRecommendationLimit(options.limit ?? 12);
  const excludeIds = new Set((options.excludeIds ?? []).filter(Boolean));
  const mode = normalizeRecommendationMode(options.mode);
  const scene = normalizeRecommendationScene(options.scene);
  const userId = options.userId ?? DEFAULT_OWNER_USER_ID;
  const recommendationInput = buildRecommendationInput({ mode, scene, text: prompt });
  const library: LibraryResult = importedLibrary ?? (await getStoredLibrary(userId));
  const feedbackSongs = library.songs;
  const latestPlayback = importedLibrary ? new Map<string, LatestPlayback>() : await getLatestPlaybackForSongs(feedbackSongs, userId);
  const cooldownExcluded = collectCooldownExcluded(feedbackSongs, latestPlayback);
  const cooldownExcludedIds = new Set(cooldownExcluded.map((song) => song.id));
  const songs = feedbackSongs.filter((song) => !excludeIds.has(song.neteaseSongId) && !cooldownExcludedIds.has(song.neteaseSongId));
  if (!songs.length) {
    throw new Error(hasNeteaseCookie() ? "Local library is empty. Please sync NetEase songs first." : "Missing NetEase Cookie or local library; cannot generate recommendations.");
  }

  const hasInjectedAiProvider = Boolean(options.aiProvider);
  const recommendationAi = options.aiProvider ?? getAiProvider(options.requireAi ?? false);
  recommendationAi.clearTrace?.();
  if (!importedLibrary) {
    await ensureFreshUserProfile(userId);
  }
  const profileData = importedLibrary ? {} : await getUserProfileData(userId);
  const preferenceTrace: AiTraceCall[] = [];
  const profileSummary = hasProfileData(profileData)
    ? await recommendationAi.summarizePreference(profileData)
    : "";
  if (!profileSummary) {
    preferenceTrace.push({
      id: "preference-skipped-1",
      stage: "preference",
      title: "AI preference summary skipped",
      request: { profileData },
      rawResponse: "",
      parsed: { skipped: true, reason: "Missing user profile; AI preference summary was not called." },
      createdAt: new Date().toISOString()
    });
  }
  const context = {
    ...(await recommendationAi.parseListeningContext(recommendationInput, profileSummary)),
    mode
  };
  const sources = buildCandidateSources(songs);
  const ranked = await recommendFromSources(sources, context, LOCAL_RERANK_CANDIDATE_LIMIT);
  const enriched = await enrichRankedRecommendations(ranked);
  const excludedByTags = collectExcludedByTags(enriched.ranked.map((item) => item.song), context.excludeTags ?? []);
  const filteredRanked = enriched.ranked.filter((item) => !excludedByTags.some((excluded) => excluded.id === item.song.neteaseSongId));
  const aiPool = await rerankWithAi(recommendationAi, filteredRanked, context, Math.max(limit, AI_RERANK_TARGET_COUNT), options.requireAi ?? false, hasInjectedAiProvider);
  const aiRanked = aiPool.slice(0, limit);
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
      aiPoolSize: aiPool.length,
      hasMore: songs.length > aiRanked.length
    },
    flow: {
      input: {
        prompt,
        mode,
        scene,
        text: prompt,
        requested: limit,
        excludedPlayedIds: Array.from(excludeIds)
      },
      context,
      library: {
        totalSongs: library.songs.length,
        afterPlayedExclusion: songs.length,
        sourceNames: sources.map((source) => source.name)
      },
      recall: {
        modeMix: modeMixFor(mode),
        candidateSourceCounts: countSongsBySource(songs)
      },
      tags: buildTagAudit(library.songs),
      filters: {
        excludeTags: context.excludeTags ?? [],
        excludedByTags,
        cooldownExcluded
      },
      ranking: {
        localCandidateLimit: LOCAL_RERANK_CANDIDATE_LIMIT,
        aiTargetCount: Math.min(AI_RERANK_TARGET_COUNT, filteredRanked.length),
        localRankedCount: ranked.length,
        afterTagFilterCount: filteredRanked.length,
        aiRerankedCount: aiPool.length,
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

export async function createCompanionChatResponse(input: CompanionChatInput, options: { aiProvider?: AiProvider } = {}) {
  const message = input.message.trim();
  if (!message) throw new Error("Please enter a companion chat message.");
  if (!input.song.id.trim() || !input.song.name.trim()) throw new Error("Missing current song information for companion chat.");

  const provider = options.aiProvider ?? getAiProvider(true);
  if (!provider.chatCompanion) throw new Error("The current AI provider does not support companion chat.");
  return provider.chatCompanion({
    ...input,
    message,
    history: (input.history ?? []).slice(-12)
  });
}

export async function createProactiveCompanionResponse(input: Omit<CompanionChatInput, "message">, options: { aiProvider?: AiProvider; userId?: number } = {}) {
  if (!input.song.id.trim() || !input.song.name.trim()) throw new Error("Missing current song information for proactive companion.");
  const userId = options.userId ?? DEFAULT_OWNER_USER_ID;
  const profileData = await getUserProfileData(userId);
  const promptParts = [
    "Say one short, contextual line about this moment in the song.",
    "Do not ask a question. Do not interrupt the listener. Do not invent facts.",
    hasProfileData(profileData) ? `Private user preference context: ${compactProfilePrompt(profileData)}` : "Private user preference context: unavailable."
  ];

  return createCompanionChatResponse(
    {
      ...input,
      message: promptParts.join("\n"),
      history: (input.history ?? []).slice(-12)
    },
    { aiProvider: options.aiProvider }
  );
}

function buildRecommendationInput(input: { mode: RecommendationMode; scene: RecommendationScene; text: string }) {
  return [`mode=${input.mode}`, `scene=${input.scene}`, `text=${input.text}`].join("\n");
}

function normalizeRecommendationMode(mode?: RecommendationMode): RecommendationMode {
  return mode === "familiar" || mode === "explore" || mode === "balanced" ? mode : "balanced";
}

function normalizeRecommendationScene(scene?: RecommendationScene): RecommendationScene {
  const allowed = new Set<RecommendationScene>(["work_focus", "commute", "night", "sleep", "workout", "relax", "general"]);
  return scene && allowed.has(scene) ? scene : "general";
}

function modeMixFor(mode: RecommendationMode) {
  if (mode === "familiar") {
    return {
      mode,
      familiarLibraryRatio: 0.8,
      librarySimilarRatio: 0.2,
      neteaseExtensionRatio: 0
    };
  }
  if (mode === "explore") {
    return {
      mode,
      familiarLibraryRatio: 0.2,
      librarySimilarRatio: 0.3,
      neteaseExtensionRatio: 0.5
    };
  }
  return {
    mode,
    familiarLibraryRatio: 0.45,
    librarySimilarRatio: 0.35,
    neteaseExtensionRatio: 0.2
  };
}

function countSongsBySource(songs: CandidateSong[]) {
  const counts: Record<string, number> = {};
  for (const song of songs) {
    for (const source of song.sources) counts[source] = (counts[source] ?? 0) + 1;
  }
  return counts;
}

export async function createDefaultLikedQueueResponse(options: { limit?: number; userId?: number } = {}) {
  const limit = clampRecommendationLimit(options.limit ?? 12);
  const userId = options.userId ?? DEFAULT_OWNER_USER_ID;
  const library = await getStoredLibrary(userId);
  const latestPlayback = await getLatestPlaybackForSongs(library.songs, userId);
  const cooldownExcluded = collectCooldownExcluded(library.songs, latestPlayback);
  const cooldownExcludedIds = new Set(cooldownExcluded.map((song) => song.id));
  const candidates = library.songs.filter(
    (song) =>
      Boolean(song.streamUrl) &&
      !cooldownExcludedIds.has(song.neteaseSongId) &&
      (song.sources.includes("liked") || song.tags.includes("liked") || song.tags.includes("source:liked"))
  );

  if (!candidates.length) {
    throw new Error("No playable liked songs are available in the local library.");
  }

  const ranked = shuffleSongs(candidates)
    .slice(0, limit)
    .map((song, index) => ({
      song,
      score: 100 - index,
      reason: "Random playback from your liked songs, not an AI recommendation.",
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
        prompt: "Default liked shuffle",
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
    title: call.title ?? `AI 璋冪敤 ${index + 1}`,
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

export async function resolveCurrentUserForRequest(request: Request) {
  const repository = await getMusicRepositoryForApp();
  return resolveCurrentUser((repository as unknown as { db: AppDatabase }).db, request);
}

export function resetAppServicesForTests() {
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

function enqueueMissingTagJobs(repository: MusicRepository, songs: CandidateSong[], reason: string) {
  const songIdsByNeteaseId = repository.listSongIdsByNeteaseIds(songs.map((song) => song.neteaseSongId));
  const songIds = songs
    .filter((song) => !hasAiTaggedMarker(song))
    .map((song) => songIdsByNeteaseId.get(song.neteaseSongId))
    .filter((songId): songId is number => typeof songId === "number");
  if (!songIds.length) return { inserted: 0, skipped: 0 };
  return new TaggingQueueRepository((repository as unknown as { db: AppDatabase }).db).enqueueMissingTags(songIds, reason);
}

async function getStoredLibrary(userId = DEFAULT_OWNER_USER_ID): Promise<LibraryResult> {
  const repository = await getMusicRepositoryForApp();
  return {
    songs: repository.listCandidateSongsForUser(userId),
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

async function getUserProfileData(userId: number) {
  const repository = await getMusicRepositoryForApp();
  const db = (repository as unknown as { db: AppDatabase }).db;
  const profile = new UserProfileRepository(db).getByUserId(userId);
  if (!profile) return {};
  return {
    compactSummary: profile.compactSummary,
    confidence: profile.confidence,
    profile: profile.profileJson
  };
}

async function ensureFreshUserProfile(userId: number) {
  const repository = await getMusicRepositoryForApp();
  const db = (repository as unknown as { db: AppDatabase }).db;
  const profile = new UserProfileRepository(db).getByUserId(userId);
  if (!profile || isUserProfileStale(profile.lastRefreshedAt)) {
    await refreshUserProfile(userId);
  }
}

async function compactUserProfileWithAi<T extends { compactSummary: string; profileJson: Record<string, unknown> }>(
  profile: T,
  aiProvider?: Pick<AiProvider, "summarizePreference">
) {
  if (!aiProvider) return profile;
  try {
    const summary = (await aiProvider.summarizePreference(profile.profileJson)).trim();
    if (!summary) return profile;
    return { ...profile, compactSummary: summary.slice(0, 600) };
  } catch {
    return profile;
  }
}

function isUserProfileStale(lastRefreshedAt?: string | null) {
  if (!lastRefreshedAt) return true;
  const timestamp = Date.parse(lastRefreshedAt);
  if (!Number.isFinite(timestamp)) return true;
  return Date.now() - timestamp > USER_PROFILE_STALE_MS;
}

function hasProfileData(profileData: unknown) {
  if (profileData === null || profileData === undefined) return false;
  if (typeof profileData === "string") return profileData.trim().length > 0;
  if (Array.isArray(profileData)) return profileData.length > 0;
  if (typeof profileData === "object") return Object.keys(profileData).length > 0;
  return true;
}

function compactProfilePrompt(profileData: unknown) {
  if (!hasProfileData(profileData)) return "";
  if (typeof profileData === "string") return profileData.slice(0, 600);
  if (typeof profileData === "object" && profileData && "compactSummary" in profileData) {
    const summary = (profileData as { compactSummary?: unknown }).compactSummary;
    if (typeof summary === "string" && summary.trim()) return summary.trim().slice(0, 600);
  }
  return JSON.stringify(profileData).slice(0, 600);
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

function taggingQueueBatchLimit(requestedLimit?: number) {
  const configured = Number(process.env.TAGGING_QUEUE_BATCH_LIMIT ?? DEFAULT_TAGGING_QUEUE_BATCH_LIMIT);
  const maxBatch = Number.isFinite(configured) ? Math.max(1, Math.floor(configured)) : DEFAULT_TAGGING_QUEUE_BATCH_LIMIT;
  const requested = Number(requestedLimit ?? maxBatch);
  const safeRequested = Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : maxBatch;
  return Math.min(safeRequested, maxBatch);
}

function taggingQueueRetryPolicy() {
  const maxAttemptsValue = Number(process.env.TAGGING_QUEUE_MAX_ATTEMPTS ?? DEFAULT_TAGGING_QUEUE_MAX_ATTEMPTS);
  const retryDelayValue = Number(process.env.TAGGING_QUEUE_RETRY_DELAY_SECONDS ?? DEFAULT_TAGGING_QUEUE_RETRY_DELAY_SECONDS);
  return {
    maxAttempts: Number.isFinite(maxAttemptsValue) ? Math.max(1, Math.floor(maxAttemptsValue)) : DEFAULT_TAGGING_QUEUE_MAX_ATTEMPTS,
    retryDelaySeconds: Number.isFinite(retryDelayValue) ? Math.max(0, Math.floor(retryDelayValue)) : DEFAULT_TAGGING_QUEUE_RETRY_DELAY_SECONDS
  };
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
    throw new Error("DeepSeek API key is not configured; AI reranking cannot be skipped.");
  }
  if (provider.rerankRecommendations && (hasDeepSeekKey || hasInjectedAiProvider)) {
    return provider.rerankRecommendations(ranked, context).then((items) => fillRecommendations(items, ranked, limit));
  }
  if (requireAi) {
    throw new Error("DeepSeek reranking is unavailable and local fallback is disabled.");
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

async function getLatestPlaybackForSongs(songs: CandidateSong[], userId = DEFAULT_OWNER_USER_ID) {
  const repository = await getMusicRepositoryForApp();
  return repository.listLatestPlaybackByNeteaseSongIdsForUser(userId, songs.map((song) => song.neteaseSongId));
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
      reason: playback.completed ? "Completed playback cooldown" : "Recently played cooldown",
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
    sceneFitScore: 0,
    soundExperienceScore: 0,
    moodScore: 0,
    energyScore: 0,
    modeFreshnessScore: 0,
    behaviorFeedbackScore: 0,
    playableAvoidScore: 0,
    profileConfidenceScore: 0,
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

function decryptCookieForLocalUse(encryptedCookie: string) {
  if (!encryptedCookie.startsWith("local-dev:")) return null;
  const encoded = encryptedCookie.slice("local-dev:".length);
  try {
    const cookie = Buffer.from(encoded, "base64").toString("utf8").trim();
    return cookie || null;
  } catch {
    return null;
  }
}

function previewCookie(cookie: string) {
  const token = cookie.match(/(?:MUSIC_U|MUSIC_A)=([^;\s]+)/)?.[1] ?? cookie;
  const prefix = cookie.includes("MUSIC_A=") ? "MUSIC_A" : "MUSIC_U";
  if (token.length <= 8) return `${prefix}=***`;
  return `${prefix}=${token.slice(0, 4)}...${token.slice(-4)}`;
}

function stripRawCookie<T extends { rawCookie?: string }>(value: T) {
  const { rawCookie: _rawCookie, ...safeValue } = value;
  return safeValue;
}

function safeLoginState(state: NonNullable<ReturnType<UserRepository["getLoginState"]>>) {
  return {
    provider: state.provider,
    status: state.status,
    source: state.source,
    lastVerifiedAt: state.lastVerifiedAt
  };
}
