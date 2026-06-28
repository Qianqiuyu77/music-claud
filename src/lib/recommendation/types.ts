import type { Feedback } from "@/lib/db/types";

export type ListeningContext = {
  scene: string;
  mode?: RecommendationMode;
  mood: string[];
  energy: "low" | "low_to_medium" | "medium" | "high" | "unknown";
  vocal: "less_vocal" | "vocal_ok" | "instrumental" | "strong_vocal" | "unknown";
  rhythm?: "steady" | "groovy" | "strong" | "loose" | "unknown";
  distraction?: "low" | "medium" | "high" | "unknown";
  novelty: "familiar" | "balanced" | "explore";
  avoid: string[];
  targetTags?: string[];
  excludeTags?: string[];
  familiarRatio?: number;
  exploreRatio?: number;
};

export type RecommendationMode = "familiar" | "balanced" | "explore";
export type RecommendationScene = "work_focus" | "commute" | "night" | "sleep" | "workout" | "relax" | "general";

export type CandidateSourceName =
  | "liked"
  | "playlist"
  | "recent"
  | "frequent_artist"
  | "netease_similar_song"
  | "netease_similar_playlist"
  | "dormant"
  | "exploration";

export type CandidateSong = {
  neteaseSongId: string;
  name: string;
  artistNames: string[];
  artistIds?: string[];
  albumName: string | null;
  coverUrl: string | null;
  streamUrl?: string | null;
  durationMs: number | null;
  popularity: number | null;
  sources: CandidateSourceName[];
  tags: string[];
  recentPlayCount: number;
  daysSinceLastPlayed: number | null;
  feedback: Feedback[];
};

export type ScoreBreakdown = {
  sceneFitScore: number;
  soundExperienceScore: number;
  moodScore: number;
  energyScore: number;
  modeFreshnessScore: number;
  behaviorFeedbackScore: number;
  playableAvoidScore: number;
  profileConfidenceScore: number;
  longTermPreferenceScore: number;
  contextMatchScore: number;
  sourceConfidenceScore: number;
  noveltyScore: number;
  feedbackAdjustmentScore: number;
  implicitBehaviorScore: number;
  repetitionPenalty: number;
  fatiguePenalty: number;
  negativeFeedbackPenalty: number;
};

export type RankedRecommendation = {
  song: CandidateSong;
  score: number;
  reason: string;
  breakdown: ScoreBreakdown;
  selectionSource?: "ai" | "local_fill" | "default_liked";
};
