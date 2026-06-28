import type { CandidateSong, ListeningContext, RankedRecommendation } from "@/lib/recommendation/types";

export type AiTraceCall = {
  id: string;
  stage: "preference" | "intent" | "rerank" | "tagging" | "reason" | "chat" | string;
  title: string;
  model?: string;
  request?: unknown;
  rawResponse: string;
  parsed?: unknown;
  createdAt?: string;
};

export type CompanionChatMessage = {
  role: "user" | "companion";
  text: string;
};

export type CompanionChatInput = {
  message: string;
  song: {
    id: string;
    name: string;
    artists: string[];
    album?: string | null;
    tags?: string[];
  };
  currentLyricLine?: {
    time?: number | null;
    text: string;
    translation?: string | null;
  } | null;
  playback?: {
    currentTime?: number | null;
    duration?: number | null;
  };
  history?: CompanionChatMessage[];
};

export type CompanionChatResponse = {
  message: string;
  rawResponse?: string;
};

export type AiProvider = {
  parseListeningContext(input: string, profileSummary: string): Promise<ListeningContext>;
  summarizePreference(profileData: unknown): Promise<string>;
  generateReasons(recommendations: RankedRecommendation[], context: ListeningContext): Promise<string[]>;
  chatCompanion?(input: CompanionChatInput): Promise<CompanionChatResponse>;
  tagSongs?(songs: CandidateSong[]): Promise<CandidateSong[]>;
  rerankRecommendations?(recommendations: RankedRecommendation[], context: ListeningContext): Promise<RankedRecommendation[]>;
  clearTrace?(): void;
  getTrace?(): AiTraceCall[];
};
