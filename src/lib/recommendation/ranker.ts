import type { CandidateSong, ListeningContext, RankedRecommendation, ScoreBreakdown } from "./types";
import { matchingSongTags, reasonTags, tagLabel } from "./songTags";
import { energyScore, playableAvoidScore, profileConfidence, sceneFitScore, soundExperienceScore, moodScore } from "./songProfile";

const sourceWeights: Record<string, number> = {
  liked: 2.4,
  playlist: 1.8,
  recent: 1.2,
  frequent_artist: 1.2,
  netease_similar_song: 1.6,
  netease_similar_playlist: 1.3,
  dormant: 1.7,
  exploration: 0.7
};

export function rankCandidates(candidates: CandidateSong[], context: ListeningContext): RankedRecommendation[] {
  return candidates
    .map((song) => {
      const breakdown = scoreSong(song, context);
      const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
      return {
        song,
        score,
        reason: buildTemplateReason(song, breakdown),
        breakdown
      };
    })
    .sort((a, b) => b.score - a.score);
}

function scoreSong(song: CandidateSong, context: ListeningContext): ScoreBreakdown {
  const targetTags = context.targetTags ?? [];
  const excludeTags = context.excludeTags ?? [];
  const tagMatches = [
    ...matchingSongTags(song.tags, context.mood),
    ...matchingSongTags(song.tags, targetTags)
  ].length;
  const excludedMatches = matchingSongTags(song.tags, excludeTags).length;
  const sourceConfidenceScore = song.sources.reduce((sum, source) => sum + (sourceWeights[source] ?? 0.5), 0);
  const hasNegative = song.feedback.includes("dislike") || song.feedback.includes("too_familiar");
  const asksForNovelty = context.novelty === "explore";
  const days = song.daysSinceLastPlayed ?? 999;
  const confidence = profileConfidence(song);
  const sceneScore = sceneFitScore(song, context) * confidence;
  const soundScore = soundExperienceScore(song, context) * confidence;
  const moodMatchScore = moodScore(song, context) * confidence;
  const energyMatchScore = energyScore(song, context) * confidence;
  const modeFreshnessScore = modeFreshness(song, context);
  const behaviorScore = song.feedback.includes("more_like_this") ? 8 : song.feedback.includes("like") ? 5 : 0;
  const playableScore = playableAvoidScore(song, context);

  return {
    sceneFitScore: sceneScore,
    soundExperienceScore: soundScore,
    moodScore: moodMatchScore,
    energyScore: energyMatchScore,
    modeFreshnessScore,
    behaviorFeedbackScore: behaviorScore,
    playableAvoidScore: playableScore,
    profileConfidenceScore: confidence,
    longTermPreferenceScore: song.sources.includes("liked") || song.sources.includes("playlist") ? 2 : 0.5,
    contextMatchScore: tagMatches * 1.7,
    sourceConfidenceScore,
    noveltyScore: asksForNovelty ? Math.min(days / 20, 2) : Math.min(days / 60, 1.2),
    feedbackAdjustmentScore: song.feedback.includes("more_like_this") ? 2 : song.feedback.includes("like") ? 1 : 0,
    implicitBehaviorScore: song.sources.includes("recent") && context.novelty === "familiar" ? 0.8 : 0,
    repetitionPenalty: repeatedArtistPenalty(song),
    fatiguePenalty: song.recentPlayCount > 10 ? -2.5 : song.recentPlayCount > 4 ? -1 : 0,
    negativeFeedbackPenalty: hasNegative ? -4 : excludedMatches ? -3 * excludedMatches : 0
  };
}

function modeFreshness(song: CandidateSong, context: ListeningContext) {
  if (context.novelty === "explore") {
    if (song.sources.includes("exploration") || song.sources.includes("netease_similar_song") || song.sources.includes("netease_similar_playlist")) return 10;
    if (song.sources.includes("liked")) return 3;
    return 6;
  }
  if (context.novelty === "familiar") {
    if (song.sources.includes("liked") || song.sources.includes("recent")) return 10;
    if (song.sources.includes("exploration")) return 2;
    return 6;
  }
  if (song.sources.includes("liked")) return 7;
  if (song.sources.includes("exploration") || song.sources.includes("netease_similar_song")) return 6;
  return 5;
}

function repeatedArtistPenalty(song: CandidateSong) {
  return song.artistNames.length > 3 ? -0.5 : 0;
}

function buildTemplateReason(song: CandidateSong, breakdown: ScoreBreakdown) {
  const strongestSource = sourceLabel(song.sources[0]);
  const tagText = reasonTags(song.tags).map(tagLabel).join("、");
  if (breakdown.contextMatchScore > 0) {
    return `来自${strongestSource}，和本轮的${tagText}需求比较贴近。`;
  }
  return `来自${strongestSource}，最近重复度不高，适合放进这一轮试听。`;
}

function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    liked: "红心歌曲",
    playlist: "歌单收藏",
    recent: "最近播放",
    frequent_artist: "常听歌手",
    netease_similar_song: "网易云相似歌曲",
    netease_similar_playlist: "网易云相似歌单",
    dormant: "沉睡老歌",
    exploration: "探索候选"
  };
  return labels[source] ?? "真实曲库";
}
