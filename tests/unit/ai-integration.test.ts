import { describe, expect, it } from "vitest";
import { DeepSeekProvider } from "@/lib/ai/deepseekProvider";
import type { CandidateSong, RankedRecommendation } from "@/lib/recommendation/types";

function fakeClient(contents: string[]) {
  const calls: unknown[] = [];
  return {
    calls,
    chat: {
      completions: {
        create: async (input: unknown) => {
          calls.push(input);
          const content = contents.shift() ?? "{}";
          return {
            choices: [{ message: { content } }]
          };
        }
      }
    }
  };
}

describe("DeepSeek AI integration", () => {
  it("uses DeepSeek to tag songs with the controlled taxonomy", async () => {
    const client = fakeClient([
      JSON.stringify({
        items: [
          {
            id: "101",
            tags: ["scene:focus", "mood:calm", "energy:low", "vocal:less_vocal", "lang:zh", "genre:folk"],
            summary: "安静的人声民谣，适合专注工作。"
          }
        ]
      })
    ]);
    const provider = new DeepSeekProvider({ client });

    const tagged = await provider.tagSongs([
      song({ neteaseSongId: "101", name: "成都", artistNames: ["赵雷"], tags: ["liked", "playable"] })
    ]);

    expect(client.calls).toHaveLength(1);
    const request = client.calls[0] as { messages: Array<{ role: string; content: string }> };
    const payload = JSON.parse(request.messages.find((message) => message.role === "user")?.content ?? "{}");
    expect(payload.songsToTag[0]).toEqual({
      id: "101",
      name: "成都",
      artists: ["赵雷"],
      album: "测试专辑",
      durationMs: 200000,
      popularity: 80
    });
    expect(payload.songsToTag[0]).not.toHaveProperty("existingTags");
    expect(payload.songsToTag[0]).not.toHaveProperty("sources");
    expect(tagged[0]).toEqual(
      expect.objectContaining({
        neteaseSongId: "101",
        tags: expect.arrayContaining(["liked", "playable", "ai:scene:focus", "ai:mood:calm", "ai:energy:low", "ai:vocal:less_vocal", "ai:lang:zh", "ai:genre:folk", "ai:tagged"])
      })
    );
    expect(tagged[0].tags).not.toContain("ai_tagged");
    expect(tagged[0].tags.some((tag) => tag.startsWith("ai:source:") || tag.startsWith("ai:playback:") || tag.startsWith("ai:taste:"))).toBe(false);
  });

  it("accepts array-shaped DeepSeek tag responses", async () => {
    const client = fakeClient([
      JSON.stringify([
        {
          id: "101",
          tags: ["scene:focus", "mood:calm", "energy:low", "vocal:less_vocal"]
        }
      ])
    ]);
    const provider = new DeepSeekProvider({ client });

    const tagged = await provider.tagSongs([song({ neteaseSongId: "101" })]);

    expect(tagged[0].tags).toEqual(expect.arrayContaining(["ai:scene:focus", "ai:mood:calm", "ai:energy:low", "ai:vocal:less_vocal", "ai:tagged"]));
  });

  it("accepts id-mapped DeepSeek tag responses", async () => {
    const client = fakeClient([
      JSON.stringify({
        "101": ["scene:focus", "mood:calm", "energy:low", "vocal:less_vocal"],
        "102": { tags: ["scene:sleep", "mood:healing", "energy:low", "vocal:instrumental"] }
      })
    ]);
    const provider = new DeepSeekProvider({ client });

    const tagged = await provider.tagSongs([song({ neteaseSongId: "101" }), song({ neteaseSongId: "102" })]);

    expect(tagged[0].tags).toEqual(expect.arrayContaining(["ai:scene:focus", "ai:mood:calm", "ai:tagged"]));
    expect(tagged[1].tags).toEqual(expect.arrayContaining(["ai:scene:sleep", "ai:mood:healing", "ai:tagged"]));
  });

  it("retries AI tagging with a stricter prompt when DeepSeek echoes songs without tags", async () => {
    const client = fakeClient([
      JSON.stringify({
        items: [
          {
            id: "101",
            name: "慢半拍",
            artists: ["薛之谦"],
            existingTags: ["liked", "playable"]
          }
        ]
      }),
      JSON.stringify({
        items: [
          {
            id: "101",
            tags: ["scene:alone", "mood:melancholy", "energy:medium", "vocal:vocal_ok", "lang:zh", "genre:pop"]
          }
        ]
      })
    ]);
    const provider = new DeepSeekProvider({ client });

    const tagged = await provider.tagSongs([song({ neteaseSongId: "101", name: "慢半拍", artistNames: ["薛之谦"] })]);

    expect(client.calls).toHaveLength(2);
    expect(tagged[0].tags).toEqual(expect.arrayContaining(["ai:scene:alone", "ai:mood:melancholy", "ai:energy:medium", "ai:vocal:vocal_ok", "ai:lang:zh", "ai:genre:pop", "ai:tagged"]));
  });

  it("uses DeepSeek to parse intent and rerank real candidate songs", async () => {
    const client = fakeClient([
      JSON.stringify({
        scene: "work",
        mood: ["mood:calm"],
        energy: "low",
        vocal: "less_vocal",
        novelty: "balanced",
        avoid: ["energy:high"],
        targetTags: ["scene:focus", "mood:calm", "vocal:less_vocal"],
        excludeTags: ["energy:high"],
        familiarRatio: 0.6,
        exploreRatio: 0.4
      }),
      JSON.stringify({
        items: [
          { id: "quiet", reason: "更贴合安静、少人声的工作场景。", score: 98 },
          { id: "soft", reason: "情绪稳定，可以作为下一首衔接。", score: 86 }
        ]
      }),
      "{}"
    ]);
    const provider = new DeepSeekProvider({ client });
    const context = await provider.parseListeningContext("写代码，安静，少人声", "偏好安静歌曲");
    const reranked = await provider.rerankRecommendations(
      [
        rankedItem("quiet", ["scene:focus", "mood:calm", "vocal:less_vocal"]),
        rankedItem("loud", ["scene:workout", "energy:high"]),
        rankedItem("soft", ["mood:calm"])
      ],
      context
    );

    expect(client.calls).toHaveLength(3);
    expect(context.targetTags).toEqual(expect.arrayContaining(["scene:focus", "mood:calm", "vocal:less_vocal"]));
    expect(reranked.map((item) => item.song.neteaseSongId)).toEqual(["quiet", "soft"]);
    expect(reranked[0].reason).toBe("更贴合安静、少人声的工作场景。");
  });

  it("records the complete AI request and response in the trace", async () => {
    const client = fakeClient([
      JSON.stringify({
        scene: "work",
        mood: ["calm"],
        energy: "low",
        vocal: "less_vocal",
        novelty: "balanced",
        avoid: [],
        targetTags: ["scene:focus", "mood:calm"],
        excludeTags: [],
        familiarRatio: 0.6,
        exploreRatio: 0.4
      }),
      JSON.stringify({
        items: [{ id: "quiet", reason: "适合写代码时保持专注。", score: 98 }]
      })
    ]);
    const provider = new DeepSeekProvider({ client, allowFallback: false });

    const context = await provider.parseListeningContext("写代码，安静，少人声", "偏好安静歌曲");
    await provider.rerankRecommendations([rankedItem("quiet", ["scene:focus", "mood:calm"])], context);

    const trace = provider.getTrace();
    expect(trace).toHaveLength(2);
    expect(trace[0]).toEqual(
      expect.objectContaining({
        stage: "intent",
        request: expect.objectContaining({
          model: "deepseek-chat",
          response_format: { type: "json_object" },
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "system", content: expect.stringContaining("你是音乐推荐意图解析器") }),
            expect.objectContaining({ role: "user", content: expect.stringContaining("写代码") })
          ])
        }),
        rawResponse: expect.stringContaining("\"scene\":\"work\""),
        parsed: expect.objectContaining({ scene: "work" })
      })
    );
    expect(trace[1].request).toEqual(
      expect.objectContaining({
        response_format: { type: "json_object" },
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "system", content: expect.stringContaining("你是私人音乐推荐排序器") }),
          expect.objectContaining({ role: "user", content: expect.stringContaining("\"id\":\"quiet\"") })
        ])
      })
    );
  });

  it("asks DeepSeek for a 50-song queue and retries when the model returns too few songs", async () => {
    const client = fakeClient([
      JSON.stringify({
        items: [{ id: "song-1", reason: "第一轮返回太少", score: 90 }]
      }),
      JSON.stringify({
        items: Array.from({ length: 50 }, (_, index) => ({
          id: `song-${index + 1}`,
          reason: `完整队列第 ${index + 1} 首`,
          score: 100 - index
        }))
      })
    ]);
    const provider = new DeepSeekProvider({ client, allowFallback: false });
    const recommendations = Array.from({ length: 60 }, (_, index) => rankedItem(`song-${index + 1}`, ["ai:scene:focus", "ai:mood:calm"]));

    const reranked = await provider.rerankRecommendations(recommendations, {
      scene: "work",
      mood: ["calm"],
      energy: "low",
      vocal: "less_vocal",
      novelty: "balanced",
      avoid: [],
      targetTags: ["scene:focus"],
      excludeTags: [],
      familiarRatio: 0.6,
      exploreRatio: 0.4
    });
    const firstRequest = client.calls[0] as { messages: Array<{ role: string; content: string }> };
    const secondRequest = client.calls[1] as { messages: Array<{ role: string; content: string }> };
    const firstPayload = JSON.parse(firstRequest.messages.find((message) => message.role === "user")?.content ?? "{}");
    const secondSystem = secondRequest.messages.find((message) => message.role === "system")?.content ?? "";

    expect(client.calls).toHaveLength(2);
    expect(firstPayload.targetCount).toBe(50);
    expect(firstPayload.candidates).toHaveLength(60);
    expect(secondSystem).toContain("必须返回 50 首");
    expect(reranked).toHaveLength(50);
    expect(reranked[0].song.neteaseSongId).toBe("song-1");
    expect(provider.getTrace().filter((call) => call.stage === "rerank")).toHaveLength(2);
  });

  it("accepts nested DeepSeek intent JSON and keeps AI tags instead of failing schema parsing", async () => {
    const client = fakeClient([
      JSON.stringify({
        context: {
          targetTags: ["scene:focus", "mood:calm", "vocal:less_vocal"],
          excludeTags: ["energy:high"],
          familiarRatio: 0.7,
          exploreRatio: 0.3
        }
      })
    ]);
    const provider = new DeepSeekProvider({ client, allowFallback: false });

    const context = await provider.parseListeningContext("写代码，安静，少人声", "偏好安静歌曲");

    expect(client.calls).toHaveLength(1);
    expect(context.scene).toBe("work");
    expect(context.mood).toEqual(expect.arrayContaining(["calm", "focused"]));
    expect(context.targetTags).toEqual(expect.arrayContaining(["scene:focus", "mood:calm", "vocal:less_vocal"]));
    expect(context.excludeTags).toEqual(expect.arrayContaining(["energy:high"]));
  });

  it("normalizes loose DeepSeek intent field types before schema validation", async () => {
    const client = fakeClient([
      JSON.stringify({
        scene: "work",
        mood: "calm,focused",
        energy: "low",
        vocal: "less_vocal",
        novelty: 0.7,
        avoid: "noisy",
        targetTags: "scene:focus,mood:calm,vocal:less_vocal",
        excludeTags: "energy:high"
      })
    ]);
    const provider = new DeepSeekProvider({ client, allowFallback: false });

    const context = await provider.parseListeningContext("写代码，安静，少人声", "偏好安静歌曲");

    expect(context.mood).toEqual(expect.arrayContaining(["calm", "focused"]));
    expect(context.novelty).toBe("explore");
    expect(context.avoid).toEqual(expect.arrayContaining(["noisy"]));
    expect(context.targetTags).toEqual(expect.arrayContaining(["scene:focus", "mood:calm", "vocal:less_vocal"]));
    expect(context.excludeTags).toEqual(expect.arrayContaining(["energy:high"]));
  });

  it("normalizes DeepSeek ratio percentages before schema validation", async () => {
    const client = fakeClient([
      JSON.stringify({
        scene: "work",
        mood: ["calm"],
        energy: "low",
        vocal: "less_vocal",
        novelty: "balanced",
        avoid: [],
        targetTags: ["scene:focus", "mood:calm", "vocal:less_vocal"],
        excludeTags: [],
        familiarRatio: 60,
        exploreRatio: "40%"
      })
    ]);
    const provider = new DeepSeekProvider({ client, allowFallback: false });

    const context = await provider.parseListeningContext("写代码，安静，少人声", "偏好安静歌曲");

    expect(context.familiarRatio).toBe(0.6);
    expect(context.exploreRatio).toBe(0.4);
  });

  it("normalizes loose DeepSeek energy synonyms before schema validation", async () => {
    const client = fakeClient([
      JSON.stringify({
        scene: "work",
        mood: ["calm"],
        energy: "steady",
        vocal: "less_vocal",
        novelty: "balanced",
        avoid: ["too noisy"],
        targetTags: ["scene:focus", "mood:calm"],
        excludeTags: ["energy:high"]
      })
    ]);
    const provider = new DeepSeekProvider({ client, allowFallback: false });

    const context = await provider.parseListeningContext("写代码，安静，少人声，不要太吵", "偏好安静歌曲");

    expect(context.energy).toBe("medium");
    expect(context.excludeTags).toContain("energy:high");
  });

  it("accepts strong_vocal when DeepSeek selects a vocal-forward intent", async () => {
    const client = fakeClient([
      JSON.stringify({
        scene: "workout",
        mood: ["confident"],
        energy: "high",
        vocal: "strong_vocal",
        novelty: "explore",
        avoid: [],
        targetTags: ["vocal:strong_vocal", "energy:high"],
        excludeTags: []
      })
    ]);
    const provider = new DeepSeekProvider({ client, allowFallback: false });

    const context = await provider.parseListeningContext("运动，速度感强", "偏好有力量的人声歌曲");

    expect(context.vocal).toBe("strong_vocal");
    expect(context.targetTags).toEqual(expect.arrayContaining(["vocal:strong_vocal", "energy:high"]));
  });
});

function song(overrides: Partial<CandidateSong>): CandidateSong {
  return {
    neteaseSongId: "song",
    name: "测试歌曲",
    artistNames: ["测试歌手"],
    albumName: "测试专辑",
    coverUrl: null,
    streamUrl: "https://music.example/song.mp3",
    durationMs: 200000,
    popularity: 80,
    sources: ["liked"],
    tags: ["liked", "playable"],
    recentPlayCount: 0,
    daysSinceLastPlayed: 20,
    feedback: [],
    ...overrides
  };
}

function rankedItem(id: string, tags: string[]): RankedRecommendation {
  return {
    song: song({ neteaseSongId: id, tags }),
    score: 1,
    reason: "local reason",
    breakdown: {
      longTermPreferenceScore: 0,
      contextMatchScore: 0,
      sourceConfidenceScore: 0,
      noveltyScore: 0,
      feedbackAdjustmentScore: 0,
      implicitBehaviorScore: 0,
      repetitionPenalty: 0,
      fatiguePenalty: 0,
      negativeFeedbackPenalty: 0
    }
  };
}
