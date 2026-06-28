import { describe, expect, it } from "vitest";
import { deduplicateCandidates } from "@/lib/recommendation/deduplicate";
import { rankCandidates } from "@/lib/recommendation/ranker";
import type { CandidateSong, ListeningContext } from "@/lib/recommendation/types";

const context: ListeningContext = {
  scene: "work",
  mood: ["calm", "focused"],
  energy: "low_to_medium",
  vocal: "less_vocal",
  novelty: "balanced",
  avoid: ["noisy"],
  targetTags: ["scene:focus", "mood:calm"]
};

function candidate(overrides: Partial<CandidateSong>): CandidateSong {
  return {
    neteaseSongId: "song-1",
    name: "Quiet Signal",
    artistNames: ["Echo Unit"],
    albumName: "Night Work",
    coverUrl: null,
    durationMs: 200000,
    popularity: 70,
    sources: ["liked"],
    tags: ["calm", "focused"],
    recentPlayCount: 0,
    daysSinceLastPlayed: 30,
    feedback: [],
    ...overrides
  };
}

describe("recommendation logic", () => {
  it("deduplicates by netease song id and merges sources", () => {
    const result = deduplicateCandidates([
      candidate({ neteaseSongId: "a", sources: ["liked"] }),
      candidate({ neteaseSongId: "a", sources: ["playlist"] }),
      candidate({ neteaseSongId: "b", sources: ["exploration"] })
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].sources).toEqual(["liked", "playlist"]);
  });

  it("penalizes fatigue and negative feedback while rewarding context matches", () => {
    const ranked = rankCandidates(
      [
        candidate({ neteaseSongId: "fresh", tags: ["calm", "focused"], daysSinceLastPlayed: 60 }),
        candidate({ neteaseSongId: "tired", tags: ["calm"], recentPlayCount: 18, daysSinceLastPlayed: 1 }),
        candidate({ neteaseSongId: "bad", tags: ["focused"], feedback: ["dislike"] })
      ],
      context
    );

    expect(ranked[0].song.neteaseSongId).toBe("fresh");
    expect(ranked.find((item) => item.song.neteaseSongId === "tired")?.breakdown.fatiguePenalty).toBeLessThan(0);
    expect(ranked.find((item) => item.song.neteaseSongId === "bad")?.breakdown.negativeFeedbackPenalty).toBeLessThan(0);
  });

  it("generates Chinese recommendation reasons", () => {
    const [ranked] = rankCandidates([candidate({ neteaseSongId: "fresh" })], context);

    expect(ranked.reason).toContain("来自");
    expect(ranked.reason).not.toMatch(/Fits|Included|context|signals/i);
  });

  it("treats ai-prefixed tags as matches for normal recommendation tags", () => {
    const ranked = rankCandidates(
      [
        candidate({ neteaseSongId: "ai-tagged", tags: ["ai:scene:focus", "ai:mood:calm", "ai:tagged"], daysSinceLastPlayed: 30 }),
        candidate({ neteaseSongId: "plain", tags: ["popular"], sources: ["playlist"], daysSinceLastPlayed: 30 })
      ],
      context
    );

    expect(ranked[0].song.neteaseSongId).toBe("ai-tagged");
    expect(ranked[0].breakdown.contextMatchScore).toBeGreaterThan(0);
  });

  it("lets unprofiled songs participate with lower profile confidence", () => {
    const ranked = rankCandidates(
      [
        candidate({
          neteaseSongId: "profiled",
          sources: ["playlist"],
          tags: ["ai:tagged", "ai:scene:focus", "ai:mood:calm", "ai:vocal:less_vocal", "ai:rhythm:steady", "ai:distraction:low"]
        }),
        candidate({
          neteaseSongId: "rule-only",
          sources: ["liked"],
          tags: ["scene:focus", "mood:calm", "vocal:less_vocal", "rhythm:steady", "distraction:low"]
        })
      ],
      context
    );

    expect(ranked.map((item) => item.song.neteaseSongId)).toContain("rule-only");
    expect(ranked[0].song.neteaseSongId).toBe("profiled");
    expect(ranked[0].breakdown.profileConfidenceScore).toBeGreaterThan(ranked[1].breakdown.profileConfidenceScore);
  });

  it("prioritizes work-focus scene fit and low-distraction sound experience over generic source strength", () => {
    const ranked = rankCandidates(
      [
        candidate({
          neteaseSongId: "quiet-work",
          sources: ["playlist"],
          tags: ["ai:tagged", "ai:scene:focus", "ai:mood:calm", "ai:energy:low_to_medium", "ai:vocal:less_vocal", "ai:rhythm:steady", "ai:distraction:low"]
        }),
        candidate({
          neteaseSongId: "liked-but-loud",
          sources: ["liked"],
          tags: ["ai:tagged", "ai:scene:workout", "ai:energy:high", "ai:vocal:strong_vocal", "ai:rhythm:strong", "ai:distraction:high"]
        })
      ],
      context
    );

    expect(ranked[0].song.neteaseSongId).toBe("quiet-work");
    expect(ranked[0].breakdown.sceneFitScore).toBeGreaterThan(0);
    expect(ranked[0].breakdown.soundExperienceScore).toBeGreaterThan(ranked[1].breakdown.soundExperienceScore);
  });
});
