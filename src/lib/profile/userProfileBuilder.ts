import type { CandidateSong } from "@/lib/recommendation/types";

type WeightedSignal = {
  key: string;
  weight: number;
};

export function buildUserProfile(userId: number, songs: CandidateSong[]) {
  const positiveTags = new Map<string, number>();
  const negativeSignals = new Map<string, number>();
  const sources = new Map<string, number>();

  for (const song of songs) {
    const positiveWeight = song.feedback.includes("more_like_this") ? 2 : song.feedback.includes("like") ? 1.5 : 1;
    const negativeWeight = song.feedback.includes("dislike") ? 2 : song.feedback.includes("too_familiar") ? 1 : 0;

    for (const source of song.sources) addWeight(sources, source, 1);
    for (const tag of song.tags.map(normalizeTag).filter(isProfileTag)) {
      if (negativeWeight > 0) addWeight(negativeSignals, tag, negativeWeight);
      else addWeight(positiveTags, tag, positiveWeight);
    }
    for (const feedback of song.feedback) {
      if (feedback === "dislike" || feedback === "too_familiar") addWeight(negativeSignals, `negative: ${feedback}`, 1);
    }
  }

  const topPositiveTags = topSignals(positiveTags, 5);
  const topNegativeSignals = topSignals(negativeSignals, 4);
  const topSources = topSignals(sources, 4);
  const confidence = Math.min(1, Math.max(0.1, songs.length / 20 + topPositiveTags.length * 0.08));
  const compactSummary = buildSummary(topPositiveTags, topNegativeSignals, topSources);

  return {
    userId,
    profileJson: {
      positiveTags: topPositiveTags,
      negativeSignals: topNegativeSignals,
      sources: topSources,
      songCount: songs.length
    },
    compactSummary,
    confidence: Number(confidence.toFixed(2))
  };
}

function buildSummary(positiveTags: WeightedSignal[], negativeSignals: WeightedSignal[], sources: WeightedSignal[]) {
  const parts = [];
  if (positiveTags.length) parts.push(`likes ${positiveTags.map((signal) => signal.key).join(", ")}`);
  if (negativeSignals.length) parts.push(`avoids ${negativeSignals.map((signal) => signal.key).join(", ")}`);
  if (sources.length) parts.push(`sources ${sources.map((signal) => signal.key).join(", ")}`);
  return parts.join("; ") || "not enough profile signals";
}

function normalizeTag(tag: string) {
  return tag.startsWith("ai:") ? tag.slice(3) : tag;
}

function isProfileTag(tag: string) {
  return tag !== "tagged" && !tag.startsWith("playback:") && !tag.startsWith("source:");
}

function addWeight(target: Map<string, number>, key: string, weight: number) {
  target.set(key, (target.get(key) ?? 0) + weight);
}

function topSignals(signals: Map<string, number>, limit: number): WeightedSignal[] {
  return Array.from(signals.entries())
    .map(([key, weight]) => ({ key, weight: Number(weight.toFixed(2)) }))
    .sort((left, right) => right.weight - left.weight || left.key.localeCompare(right.key))
    .slice(0, limit);
}
