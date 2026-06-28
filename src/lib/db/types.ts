export type Feedback = "like" | "dislike" | "too_familiar" | "more_like_this" | "later";
export type SongEventType = "liked" | "playlist_imported" | "played" | "ranked" | "recommended" | "feedback";
export type SongEventSource = "netease" | "manual" | "local";

export type SongInput = {
  neteaseSongId: string;
  name: string;
  artistNames: string[];
  artistIds: string[];
  albumName: string | null;
  albumId: string | null;
  coverUrl: string | null;
  streamUrl?: string | null;
  durationMs: number | null;
  popularity: number | null;
  sources?: string[];
  tags?: string[];
  recentPlayCount?: number;
  daysSinceLastPlayed?: number | null;
  raw: unknown;
};

export type SongRecord = SongInput & {
  id: number;
  createdAt: string;
  updatedAt: string;
};

export type SongEventInput = {
  songId: number;
  eventType: SongEventType;
  source: SongEventSource;
  contextText: string | null;
  weight: number;
};

export type RecommendationItemRecord = {
  id: number;
  sessionId: number;
  songId: number;
  rank: number;
  score: number;
  source: string;
  reason: string;
  scoreBreakdown: Record<string, number>;
  feedback: Feedback | null;
};
