import type { CandidateSong, ListeningContext, RankedRecommendation } from "@/lib/recommendation/types";

export type AiTraceCall = {
  id: string;
  stage: "preference" | "intent" | "rerank" | "tagging" | "reason" | string;
  title: string;
  model?: string;
  request?: unknown;
  rawResponse: string;
  parsed?: unknown;
  createdAt?: string;
};

export type AiProvider = {
  parseListeningContext(input: string, profileSummary: string): Promise<ListeningContext>;
  summarizePreference(profileData: unknown): Promise<string>;
  generateReasons(recommendations: RankedRecommendation[], context: ListeningContext): Promise<string[]>;
  tagSongs?(songs: CandidateSong[]): Promise<CandidateSong[]>;
  rerankRecommendations?(recommendations: RankedRecommendation[], context: ListeningContext): Promise<RankedRecommendation[]>;
  clearTrace?(): void;
  getTrace?(): AiTraceCall[];
};
