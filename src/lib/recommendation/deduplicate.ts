import type { CandidateSong } from "./types";

export function deduplicateCandidates(candidates: CandidateSong[]): CandidateSong[] {
  const bySongId = new Map<string, CandidateSong>();

  for (const candidate of candidates) {
    const existing = bySongId.get(candidate.neteaseSongId);
    if (!existing) {
      bySongId.set(candidate.neteaseSongId, { ...candidate, sources: [...candidate.sources] });
      continue;
    }

    bySongId.set(candidate.neteaseSongId, {
      ...existing,
      sources: Array.from(new Set([...existing.sources, ...candidate.sources])),
      tags: Array.from(new Set([...existing.tags, ...candidate.tags])),
      recentPlayCount: Math.max(existing.recentPlayCount, candidate.recentPlayCount),
      daysSinceLastPlayed: Math.min(existing.daysSinceLastPlayed ?? 9999, candidate.daysSinceLastPlayed ?? 9999),
      feedback: Array.from(new Set([...existing.feedback, ...candidate.feedback]))
    });
  }

  return Array.from(bySongId.values());
}
