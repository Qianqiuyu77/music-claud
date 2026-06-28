import { deduplicateCandidates } from "./deduplicate";
import { rankCandidates } from "./ranker";
import type { CandidateSong, ListeningContext, RankedRecommendation } from "./types";

export type CandidateSource = {
  name: string;
  getCandidates(context: ListeningContext): Promise<CandidateSong[]>;
};

export async function recommendFromSources(
  sources: CandidateSource[],
  context: ListeningContext,
  limit = 12
): Promise<RankedRecommendation[]> {
  const batches = await Promise.allSettled(sources.map((source) => source.getCandidates(context)));
  const candidates = batches.flatMap((batch) => (batch.status === "fulfilled" ? batch.value : []));
  const unique = deduplicateCandidates(candidates);
  return rankCandidates(unique, context).slice(0, limit);
}
