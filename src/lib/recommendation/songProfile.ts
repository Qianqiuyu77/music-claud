import type { CandidateSong, ListeningContext } from "./types";
import { hasSongTag, matchingSongTags } from "./songTags";

export type SongProfile = {
  sceneFit: string[];
  mood: string[];
  energy: ListeningContext["energy"];
  vocal: ListeningContext["vocal"];
  rhythm: NonNullable<ListeningContext["rhythm"]>;
  distraction: NonNullable<ListeningContext["distraction"]>;
  freshness: ListeningContext["novelty"];
  avoidFlags: string[];
  confidence: number;
  aiVersion: string;
};

const sceneTagMap: Record<string, string[]> = {
  work: ["scene:focus", "scene:background"],
  work_focus: ["scene:focus", "scene:background"],
  commute: ["scene:commute", "scene:travel", "scene:walk"],
  night: ["scene:alone", "scene:walk", "scene:background"],
  sleep: ["scene:sleep"],
  workout: ["scene:workout"],
  relax: ["mood:healing", "mood:calm", "scene:background"],
  general: []
};

export function buildSongProfile(song: CandidateSong): SongProfile {
  return {
    sceneFit: collectProfileValues(song.tags, "scene"),
    mood: collectProfileValues(song.tags, "mood"),
    energy: pickEnergy(song.tags),
    vocal: pickVocal(song.tags),
    rhythm: pickRhythm(song.tags),
    distraction: pickDistraction(song.tags),
    freshness: pickFreshness(song),
    avoidFlags: collectAvoidFlags(song.tags),
    confidence: profileConfidence(song),
    aiVersion: hasAiProfile(song) ? "song-profile-v1" : "rule-inferred"
  };
}

export function profileConfidence(song: CandidateSong) {
  if (hasAiProfile(song)) return 1;
  if (song.tags.length > 0 || song.sources.length > 0) return 0.45;
  return 0.3;
}

export function sceneFitScore(song: CandidateSong, context: ListeningContext) {
  const expected = new Set([...(context.targetTags ?? []), ...(sceneTagMap[context.scene] ?? [])]);
  const directMatches = matchingSongTags(song.tags, Array.from(expected)).length;
  return directMatches > 0 ? Math.min(25, directMatches * 8) : 0;
}

export function soundExperienceScore(song: CandidateSong, context: ListeningContext) {
  const profile = buildSongProfile(song);
  let score = 0;
  if (context.vocal !== "unknown") {
    if (profile.vocal === context.vocal) score += 9;
    else if (context.vocal === "less_vocal" && profile.vocal === "instrumental") score += 8;
    else if (context.vocal === "less_vocal" && profile.vocal === "strong_vocal") score -= 8;
  }
  if (context.rhythm && context.rhythm !== "unknown") {
    if (profile.rhythm === context.rhythm) score += 8;
    else if (context.rhythm === "steady" && profile.rhythm === "strong") score -= 5;
  } else if (hasSongTag(song.tags, "rhythm:steady")) {
    score += 4;
  }
  if (context.distraction && context.distraction !== "unknown") {
    if (profile.distraction === context.distraction) score += 8;
    else if (context.distraction === "low" && profile.distraction === "high") score -= 8;
  } else if (hasSongTag(song.tags, "distraction:low")) {
    score += 5;
  }
  return Math.max(-12, Math.min(25, score));
}

export function moodScore(song: CandidateSong, context: ListeningContext) {
  const matches = matchingSongTags(song.tags, [...context.mood, ...(context.targetTags ?? []).filter((tag) => tag.startsWith("mood:"))]).length;
  return Math.min(15, matches * 5);
}

export function energyScore(song: CandidateSong, context: ListeningContext) {
  if (context.energy === "unknown") return 0;
  const profileEnergy = buildSongProfile(song).energy;
  if (profileEnergy === context.energy) return 12;
  if (context.energy === "low_to_medium" && (profileEnergy === "low" || profileEnergy === "medium")) return 8;
  if (context.energy === "medium" && profileEnergy === "low_to_medium") return 8;
  if (context.energy === "low" && profileEnergy === "high") return -8;
  return 0;
}

export function playableAvoidScore(song: CandidateSong, context: ListeningContext) {
  let score = song.streamUrl ? 3 : -6;
  const excludeMatches = matchingSongTags(song.tags, context.excludeTags ?? []).length;
  score -= excludeMatches * 4;
  const avoidText = context.avoid.join(" ").toLowerCase();
  if (avoidText.includes("noisy") || avoidText.includes("吵")) {
    if (hasSongTag(song.tags, "distraction:high") || hasSongTag(song.tags, "energy:high")) score -= 5;
  }
  if (avoidText.includes("sleepy") || avoidText.includes("困")) {
    if (hasSongTag(song.tags, "energy:low")) score -= 3;
  }
  return Math.max(-12, Math.min(5, score));
}

function hasAiProfile(song: CandidateSong) {
  return song.tags.includes("ai:tagged") || song.tags.includes("ai_tagged");
}

function collectProfileValues(tags: string[], prefix: string) {
  const values = new Set<string>();
  for (const tag of tags) {
    const normalized = tag.startsWith("ai:") ? tag.slice(3) : tag;
    if (normalized.startsWith(`${prefix}:`)) values.add(normalized);
  }
  return Array.from(values);
}

function pickEnergy(tags: string[]): ListeningContext["energy"] {
  if (tagIncludes(tags, "energy:low_to_medium") || tagIncludes(tags, "energy:medium_low")) return "low_to_medium";
  if (tagIncludes(tags, "energy:low")) return "low";
  if (tagIncludes(tags, "energy:medium")) return "medium";
  if (tagIncludes(tags, "energy:high") || tagIncludes(tags, "high_energy")) return "high";
  return "unknown";
}

function pickVocal(tags: string[]): ListeningContext["vocal"] {
  if (tagIncludes(tags, "vocal:instrumental") || tagIncludes(tags, "instrumental")) return "instrumental";
  if (tagIncludes(tags, "vocal:less_vocal")) return "less_vocal";
  if (tagIncludes(tags, "vocal:strong_vocal")) return "strong_vocal";
  if (tagIncludes(tags, "vocal:vocal_ok")) return "vocal_ok";
  return "unknown";
}

function pickRhythm(tags: string[]): SongProfile["rhythm"] {
  if (tagIncludes(tags, "rhythm:steady")) return "steady";
  if (tagIncludes(tags, "rhythm:groovy")) return "groovy";
  if (tagIncludes(tags, "rhythm:strong")) return "strong";
  if (tagIncludes(tags, "rhythm:loose")) return "loose";
  return "unknown";
}

function pickDistraction(tags: string[]): SongProfile["distraction"] {
  if (tagIncludes(tags, "distraction:low")) return "low";
  if (tagIncludes(tags, "distraction:medium")) return "medium";
  if (tagIncludes(tags, "distraction:high")) return "high";
  if (tagIncludes(tags, "energy:high") || tagIncludes(tags, "high_energy")) return "high";
  return "unknown";
}

function pickFreshness(song: CandidateSong): ListeningContext["novelty"] {
  if (song.sources.includes("exploration") || song.sources.includes("netease_similar_song") || song.sources.includes("netease_similar_playlist")) return "explore";
  if (song.sources.includes("liked") || song.sources.includes("recent")) return "familiar";
  return "balanced";
}

function collectAvoidFlags(tags: string[]) {
  const flags = [];
  if (tagIncludes(tags, "energy:high") || tagIncludes(tags, "distraction:high")) flags.push("too_noisy");
  if (tagIncludes(tags, "energy:low")) flags.push("too_sleepy");
  return flags;
}

function tagIncludes(tags: string[], expected: string) {
  return tags.some((tag) => tag === expected || tag === `ai:${expected}`);
}
