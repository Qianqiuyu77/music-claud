export type RecommendationAiCall = {
  id: string;
  stage: string;
  title: string;
  model?: string;
  request?: unknown;
  rawResponse: string;
  parsed?: unknown;
  createdAt?: string;
};

export type RecommendationResponse = {
  context: { scene: string; mode?: string; mood: string[]; novelty: string };
  strategy: { candidateSources: string[]; partialFailures: string[]; novelty: string };
  libraryCounts: { songs: number; playableSongs?: number; lastSyncAt?: string | null; partialFailures: number };
  page?: { requested: number; returned: number; excluded: number; aiPoolSize?: number; hasMore: boolean };
  flow?: RecommendationFlow;
  items: Array<{
    id: string;
    rank: number;
    song: {
      neteaseSongId: string;
      name: string;
      artistNames: string[];
      albumName: string | null;
      coverUrl: string | null;
      sources: string[];
      tags: string[];
    };
    score: number;
    reason: string;
    selectionSource?: "ai" | "local_fill" | "default_liked";
    streamUrl: string | null;
    embedUrl: string;
    playbackUrl: string;
  }>;
};

export type RecommendationFlow = {
  input: { prompt: string; mode?: string; scene?: string; text?: string; requested: number; excludedPlayedIds: string[] };
  context: {
    scene: string;
    mode?: string;
    mood: string[];
    novelty: string;
    energy?: string;
    vocal?: string;
    rhythm?: string;
    distraction?: string;
    avoid?: string[];
    targetTags?: string[];
    excludeTags?: string[];
    familiarRatio?: number;
    exploreRatio?: number;
  };
  library: {
    totalSongs: number;
    afterPlayedExclusion: number;
    sourceNames: string[];
  };
  recall?: {
    modeMix?: {
      mode: string;
      familiarLibraryRatio: number;
      librarySimilarRatio: number;
      neteaseExtensionRatio: number;
    };
    candidateSourceCounts?: Record<string, number>;
  };
  tags?: {
    totalSongs: number;
    aiTaggedSongs: number;
    aiTagCoverage: number;
    examples?: string[];
  };
  filters: {
    excludeTags: string[];
    excludedByTags: Array<{ id: string; name: string; artistNames: string[]; matchedTags: string[] }>;
    cooldownExcluded?: Array<{ id: string; name: string; artistNames: string[]; reason: string; cooldownDays: number }>;
  };
  ranking: {
    localCandidateLimit?: number;
    aiTargetCount?: number;
    localRankedCount: number;
    afterTagFilterCount: number;
    aiRerankedCount: number;
    aiSelectedCount?: number;
    localFillCount?: number;
    finalCount: number;
    topLocal: FlowSongSummary[];
    final: FlowSongSummary[];
  };
  ai?: {
    calls: RecommendationAiCall[];
  };
};

export type FlowSongSummary = {
  id: string;
  name: string;
  artistNames: string[];
  score: number;
  tags: string[];
  reason: string;
  rank: number;
  selectionSource?: "ai" | "local_fill" | "default_liked";
};
