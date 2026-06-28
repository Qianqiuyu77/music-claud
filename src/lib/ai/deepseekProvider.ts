import OpenAI from "openai";
import { z } from "zod";
import { FallbackAiProvider } from "./fallbackProvider";
import { AI_TAG_TAXONOMY, filterAiTags, namespaceAiTags } from "./tagTaxonomy";
import type { AiProvider, AiTraceCall, CompanionChatInput } from "./types";
import { buildSongProfile } from "@/lib/recommendation/songProfile";
import type { CandidateSong, ListeningContext, RankedRecommendation } from "@/lib/recommendation/types";

type ChatCompletionParams = Parameters<OpenAI["chat"]["completions"]["create"]>[0];
type ChatCompletionResponse = {
  choices: Array<{
    message: {
      content?: string | null;
    };
  }>;
};
export type ChatClient = {
  chat: {
    completions: {
      create(input: ChatCompletionParams): Promise<ChatCompletionResponse>;
    };
  };
};

type DeepSeekProviderOptions = {
  client?: ChatClient | null;
  allowFallback?: boolean;
};

const contextSchema = z.object({
  scene: z.string().default("general"),
  mood: z.array(z.string()).default([]),
  energy: z.enum(["low", "low_to_medium", "medium", "high", "unknown"]).default("unknown"),
  vocal: z.enum(["less_vocal", "vocal_ok", "instrumental", "strong_vocal", "unknown"]).default("unknown"),
  novelty: z.enum(["familiar", "balanced", "explore"]).default("balanced"),
  avoid: z.array(z.string()).default([]),
  targetTags: z.array(z.string()).default([]),
  excludeTags: z.array(z.string()).default([]),
  familiarRatio: z.number().min(0).max(1).default(0.5),
  exploreRatio: z.number().min(0).max(1).default(0.5)
});

const tagResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.union([z.string(), z.number()]).transform(String),
      tags: z.array(z.string()),
      summary: z.string().optional()
    })
  )
});

const rerankResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      reason: z.string(),
      score: z.number().optional()
    })
  )
});
type RerankResponseItem = z.infer<typeof rerankResponseSchema>["items"][number];

const companionChatSchema = z.object({
  message: z.string().min(1)
});

const RERANK_TARGET_COUNT = 50;
const RERANK_CANDIDATE_LIMIT = 300;

export class DeepSeekProvider implements AiProvider {
  private readonly fallback = new FallbackAiProvider();
  private readonly client: ChatClient | null;
  private readonly allowFallback: boolean;
  private trace: AiTraceCall[] = [];

  constructor(options: DeepSeekProviderOptions = {}) {
    this.allowFallback = options.allowFallback ?? true;
    if ("client" in options) {
      this.client = options.client ?? null;
      return;
    }
    this.client = process.env.DEEPSEEK_API_KEY
      ? new OpenAI({
          apiKey: process.env.DEEPSEEK_API_KEY,
          baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com"
        })
      : null;
  }

  async parseListeningContext(input: string, profileSummary: string): Promise<ListeningContext> {
    if (!this.client) {
      if (!this.allowFallback) throw new Error("DeepSeek 未配置，不能使用兜底意图解析。");
      return this.fallback.parseListeningContext(input, profileSummary);
    }

    try {
      const request: ChatCompletionParams = {
        model: modelName(),
        messages: [
          {
            role: "system",
            content: [
              "你是音乐推荐意图解析器，只返回 JSON。",
              "必须返回一个扁平 JSON 对象，字段包含 scene,mood,energy,vocal,novelty,avoid,targetTags,excludeTags,familiarRatio,exploreRatio。",
              "必须把用户中文/英文听歌需求映射到受控标签体系 targetTags/excludeTags。",
              `可用标签：${AI_TAG_TAXONOMY.join(", ")}`,
              "不要要求 Cookie，不要编造歌曲。"
            ].join("\n")
          },
          {
            role: "user",
            content: JSON.stringify({ input, profileSummary })
          }
        ],
        response_format: { type: "json_object" }
      };
      const response = await this.client.chat.completions.create(request);
      const rawResponse = response.choices[0]?.message.content ?? "{}";
      const parsed = parseContextPayload(rawResponse);
      this.recordTrace({
        stage: "intent",
        title: "AI 意图解析",
        request,
        rawResponse,
        parsed
      });
      return mergeLocalSignals(input, {
        ...parsed,
        targetTags: filterAiTags(parsed.targetTags),
        excludeTags: filterAiTags(parsed.excludeTags)
      });
    } catch (error) {
      if (!this.allowFallback) throw new Error(`DeepSeek 意图解析失败：${errorMessage(error)}`);
      return this.fallback.parseListeningContext(input, profileSummary);
    }
  }

  async summarizePreference(profileData: unknown): Promise<string> {
    if (!this.client) {
      if (!this.allowFallback) throw new Error("DeepSeek 未配置，不能使用兜底偏好摘要。");
      return this.fallback.summarizePreference(profileData);
    }
    const request: ChatCompletionParams = {
      model: modelName(),
      messages: [
        {
          role: "system",
          content: "你是私人音乐偏好总结器。用一句中文总结用户长期偏好，只返回纯文本。"
        },
        {
          role: "user",
          content: JSON.stringify(profileData)
        }
      ],
      max_tokens: 120
    };
    const response = await this.client.chat.completions.create(request);
    const summary = response.choices[0]?.message.content?.trim();
    if (summary) {
      this.recordTrace({
        stage: "preference",
        title: "AI 偏好摘要",
        request,
        rawResponse: summary,
        parsed: { summary }
      });
      return summary;
    }
    if (!this.allowFallback) throw new Error("DeepSeek 偏好摘要失败：模型返回为空。");
    return this.fallback.summarizePreference(profileData);
  }

  async generateReasons(recommendations: RankedRecommendation[], context: ListeningContext): Promise<string[]> {
    if (!this.client) {
      if (!this.allowFallback) throw new Error("DeepSeek 未配置，不能使用兜底推荐理由。");
      return this.fallback.generateReasons(recommendations, context);
    }
    const reranked = await this.rerankRecommendations(recommendations, context);
    return recommendations.map((item) => reranked.find((ranked) => ranked.song.neteaseSongId === item.song.neteaseSongId)?.reason ?? item.reason);
  }

  async chatCompanion(input: CompanionChatInput) {
    if (!this.client) {
      throw new Error("AI companion chat failed: DEEPSEEK_API_KEY is not configured.");
    }

    const request: ChatCompletionParams = {
      model: modelName(),
      messages: [
        {
          role: "system",
          content: [
            "You are a friend listening to music with the user, not a DJ and not an expert analyst.",
            "Reply in the same language the user uses. If the user writes Chinese, answer in natural Chinese.",
            "Keep it short, warm, and conversational, like a message bubble from a friend.",
            "You may react to the current song and current lyric line when they are provided.",
            "Do not invent songs, lyrics, playback state, personal facts, or NetEase data.",
            "Do not mention prompts, tags, scoring, models, or recommendation algorithms unless the user asks directly.",
            "Return strict JSON only: {\"message\":\"...\"}."
          ].join("\n")
        },
        {
          role: "user",
          content: JSON.stringify({
            message: input.message,
            song: input.song,
            currentLyricLine: input.currentLyricLine ?? null,
            playback: input.playback ?? {},
            history: (input.history ?? []).slice(-12)
          })
        }
      ],
      response_format: { type: "json_object" },
      max_tokens: 220
    };
    const response = await this.client.chat.completions.create(request);
    const rawResponse = response.choices[0]?.message.content ?? "{}";
    const parsed = companionChatSchema.parse(JSON.parse(rawResponse));
    this.recordTrace({
      stage: "chat",
      title: "AI 伴听聊天",
      request,
      rawResponse,
      parsed
    });
    return {
      message: parsed.message,
      rawResponse
    };
  }

  async tagSongs(songs: CandidateSong[]): Promise<CandidateSong[]> {
    if (!songs.length) return [];
    if (!this.client) {
      throw new Error("AI 打标失败：缺少 DEEPSEEK_API_KEY，不能静默使用兜底标签。");
    }

    const tagged = new Map<string, string[]>();
    for (const batch of chunks(songs, 40)) {
      const parsed = await requestTagBatch(this.client, batch, (call) => this.recordTrace(call));
      for (const item of parsed.items) tagged.set(item.id, filterAiTags(item.tags));
    }

    return songs.map((song) => {
      const aiTags = tagged.get(song.neteaseSongId);
      if (!aiTags?.length) {
        throw new Error(`AI 打标失败：歌曲 ${song.neteaseSongId} 没有返回有效标签。`);
      }
      return {
        ...song,
        tags: Array.from(new Set([...stripStoredAiTags(song.tags), ...namespaceAiTags(aiTags), "ai:tagged"]))
      };
    });
  }

  async rerankRecommendations(recommendations: RankedRecommendation[], context: ListeningContext): Promise<RankedRecommendation[]> {
    if (!recommendations.length) return [];
    if (!this.client) {
      throw new Error("AI 推荐失败：缺少 DEEPSEEK_API_KEY，不能静默使用本地排序。");
    }

    const candidates = recommendations.slice(0, RERANK_CANDIDATE_LIMIT);
    const byId = new Map(candidates.map((item) => [item.song.neteaseSongId, item]));
    const targetCount = Math.min(RERANK_TARGET_COUNT, candidates.length);
    let bestReranked: RankedRecommendation[] = [];

    for (const strict of [false, true]) {
      const request = buildRerankRequest(candidates, context, targetCount, strict);
      try {
        const response = await this.client.chat.completions.create(request);
        const rawResponse = response.choices[0]?.message.content ?? "{}";
        const parsed = rerankResponseSchema.parse(JSON.parse(rawResponse));
        const reranked = materializeRerankedItems(parsed.items, byId);
        if (reranked.length > bestReranked.length) bestReranked = reranked;
        this.recordTrace({
          stage: "rerank",
          title: strict ? "AI 推荐重排重试" : "AI 推荐重排",
          request,
          rawResponse,
          parsed: {
            ...parsed,
            targetCount,
            validCount: reranked.length,
            insufficient: reranked.length < targetCount
          }
        });
        if (reranked.length >= targetCount) return reranked;
      } catch (error) {
        this.recordTrace({
          stage: "rerank",
          title: strict ? "AI 推荐重排重试失败" : "AI 推荐重排失败",
          request,
          rawResponse: "",
          parsed: {
            targetCount,
            validCount: bestReranked.length,
            insufficient: bestReranked.length < targetCount,
            error: errorMessage(error)
          }
        });
      }
    }

    if (!bestReranked.length) {
      throw new Error("AI 推荐失败：模型没有返回任何有效候选歌曲。");
    }
    return bestReranked;
  }

  clearTrace() {
    this.trace = [];
  }

  getTrace() {
    return [...this.trace];
  }

  private recordTrace(call: Omit<AiTraceCall, "id" | "model" | "createdAt">) {
    this.trace.push({
      id: `${call.stage}-${this.trace.length + 1}`,
      model: modelName(),
      createdAt: new Date().toISOString(),
      ...call
    });
  }
}

function mergeLocalSignals(input: string, context: ListeningContext): ListeningContext {
  const lower = input.toLowerCase();
  const mood = new Set(context.mood);
  const targetTags = new Set(context.targetTags ?? []);
  const excludeTags = new Set(context.excludeTags ?? []);

  if (includesAny(lower, ["calm", "quiet", "安静", "轻", "稳定"])) {
    mood.add("calm");
    targetTags.add("mood:calm");
  }
  if (includesAny(lower, ["focus", "focused", "专注", "写代码", "编程"])) {
    mood.add("focused");
    targetTags.add("scene:focus");
    targetTags.add("mood:focused");
  }
  if (includesAny(lower, ["少人声", "无人声", "less vocal", "instrumental", "纯音乐"])) {
    targetTags.add("vocal:less_vocal");
  }
  if (includesAny(lower, ["睡", "睡前", "放松"])) {
    targetTags.add("scene:sleep");
    targetTags.add("energy:low");
  }
  if (includesAny(lower, ["跑步", "运动", "健身", "workout"])) {
    targetTags.add("scene:workout");
    targetTags.add("energy:high");
  }
  if (includesAny(lower, ["吵", "太吵", "noisy"])) {
    excludeTags.add("energy:high");
  }

  return {
    ...context,
    scene: includesAny(lower, ["code", "work", "写代码", "编程", "工作", "办公"]) ? "work" : context.scene,
    mood: Array.from(mood),
    energy: includesAny(lower, ["sleep", "困", "睡", "放松"]) ? "low" : context.energy,
    vocal: includesAny(lower, ["less vocal", "instrumental", "少人声", "无人声", "纯音乐"]) ? "less_vocal" : context.vocal,
    novelty: includesAny(lower, ["new", "explore", "新鲜", "探索", "没听过"]) ? "explore" : context.novelty,
    avoid: includesAny(lower, ["noisy", "吵", "太吵", "噪"]) ? Array.from(new Set([...context.avoid, "noisy"])) : context.avoid,
    targetTags: filterAiTags(Array.from(targetTags)),
    excludeTags: filterAiTags(Array.from(excludeTags))
  };
}

function parseContextPayload(content: string) {
  const raw = JSON.parse(content);
  const payload = unwrapContextPayload(raw);
  return contextSchema.parse(normalizeContextPayload(payload));
}

function parseTagPayload(content: string) {
  const raw = JSON.parse(content);
  return tagResponseSchema.parse(normalizeTagPayload(raw));
}

function buildRerankRequest(candidates: RankedRecommendation[], context: ListeningContext, targetCount: number, strict: boolean): ChatCompletionParams {
  return {
    model: modelName(),
    messages: [
      {
        role: "system",
        content: [
          "你是私人音乐推荐排序器，只返回 JSON。",
          "只能从候选歌曲 ID 中选择，不能编造歌曲 ID。",
          "根据用户场景意图、歌曲 8 维画像、来源、本地分数、最近播放和用户反馈排序。",
          "判断时像一个陪用户听歌的朋友：这首歌会不会帮助用户进入当下状态，会不会打扰，是否太困或太吵。",
          `必须返回 ${targetCount} 首，除非候选歌曲不足 ${targetCount} 首。`,
          "返回 items: [{id, reason, score}]，reason 用中文，简短具体，像朋友解释，不要写模型分数或标签分析。",
          strict ? `上一轮返回数量不足。现在必须返回 ${targetCount} 首有效候选 ID，不要解释。` : ""
        ]
          .filter(Boolean)
          .join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          context,
          targetCount,
          candidates: candidates.map((item) => ({
            id: item.song.neteaseSongId,
            name: item.song.name,
            artists: item.song.artistNames,
            album: item.song.albumName,
            tags: item.song.tags,
            sources: item.song.sources,
            profile: buildSongProfile(item.song),
            signals: {
              localScore: item.score,
              recentPlayCount: item.song.recentPlayCount,
              daysSinceLastPlayed: item.song.daysSinceLastPlayed,
              feedback: item.song.feedback,
              playable: Boolean(item.song.streamUrl)
            }
          }))
        })
      }
    ],
    response_format: { type: "json_object" }
  };
}

function materializeRerankedItems(items: RerankResponseItem[], byId: Map<string, RankedRecommendation>) {
  const used = new Set<string>();
  const reranked: RankedRecommendation[] = [];
  for (const item of items) {
    const original = byId.get(item.id);
    if (!original || used.has(item.id)) continue;
    used.add(item.id);
    reranked.push({
      ...original,
      score: item.score ?? original.score,
      reason: item.reason || original.reason
    });
  }
  return reranked;
}

async function requestTagBatch(client: ChatClient, batch: CandidateSong[], recordTrace?: (call: Omit<AiTraceCall, "id" | "model" | "createdAt">) => void) {
  let lastError: unknown = null;
  for (const strict of [false, true]) {
    try {
      const request: ChatCompletionParams = {
        model: modelName(),
        messages: buildTagMessages(batch, strict),
        response_format: { type: "json_object" }
      };
      const response = await client.chat.completions.create(request);
      const rawResponse = response.choices[0]?.message.content ?? "{}";
      const parsed = parseTagPayload(rawResponse);
      const validItems = parsed.items.map((item) => ({
        ...item,
        tags: filterAiTags(item.tags)
      }));
      recordTrace?.({
        stage: "tagging",
        title: strict ? "AI 标签重试" : "AI 歌曲打标",
        request,
        rawResponse,
        parsed: { items: validItems }
      });
      if (validItems.every((item) => item.tags.length > 0)) {
        return { items: validItems };
      }
      lastError = new Error("模型返回的标签不在受控标签体系内。");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("AI 打标失败：模型没有返回有效 JSON 标签。");
}

function buildTagMessages(batch: CandidateSong[], strict: boolean): ChatCompletionParams["messages"] {
  const inputItems = batch.map((song) => ({
    id: song.neteaseSongId,
    name: song.name,
    artists: song.artistNames,
    album: song.albumName,
    durationMs: song.durationMs,
    popularity: song.popularity
  }));

  return [
    {
      role: "system",
      content: [
        "你是音乐标签标注器，只返回 JSON。",
        "任务：为每首输入歌曲选择 4-10 个最合适的 tags。",
        "只能根据歌名、歌手、专辑、时长、热度做音乐理解判断；不要使用网易云标签、本地标签、来源标签、播放状态作为依据。",
        "输出必须是 {\"items\":[{\"id\":\"歌曲ID\",\"tags\":[\"受控标签\"]}]}。",
        "items 里每一项只能包含 id、tags、summary；不要回传 name、artists、album、sources、existingTags。",
        "tags 只能使用给定标签体系，不要新增标签。",
        strict ? "上一轮返回格式不合格。现在必须为每个 id 产出非空 tags 数组，不能复述输入字段。" : "",
        `可用标签：${AI_TAG_TAXONOMY.join(", ")}`
      ]
        .filter(Boolean)
        .join("\n")
    },
    {
      role: "user",
      content: JSON.stringify({
        requiredOutputShape: {
          items: inputItems.map((song) => ({ id: song.id, tags: ["从可用标签中选择4到8个，不要照抄这个说明"] }))
        },
        songsToTag: inputItems
      })
    }
  ];
}

function normalizeTagPayload(value: unknown): unknown {
  if (Array.isArray(value)) return { items: value };
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  for (const key of ["items", "taggedSongs", "tagged", "songs", "data", "result", "results", "tags"]) {
    if (!(key in record)) continue;
    const nested: unknown = normalizeTagPayload(record[key]);
    if (isNormalizedTagPayload(nested)) return nested;
  }
  const singleItem = normalizeTagItem(record);
  if (singleItem) return { items: [singleItem] };
  const mappedItems = Object.entries(record)
    .map(([id, item]) => normalizeTagItem(item, id))
    .filter(Boolean);
  if (mappedItems.length) return { items: mappedItems };
  return value;
}

function normalizeTagItem(value: unknown, fallbackId?: string) {
  if (Array.isArray(value)) {
    return fallbackId ? { id: fallbackId, tags: stringList(value) ?? [] } : null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = record.id ?? record.songId ?? record.neteaseSongId ?? record.netease_song_id ?? fallbackId;
  if (id === undefined || id === null) return null;
  const tags = stringList(record.tags) ?? stringList(record.tag) ?? stringList(record.labels) ?? stringList(record.categories);
  if (!tags?.length) return null;
  return {
    ...record,
    id: String(id),
    tags
  };
}

function isNormalizedTagPayload(value: unknown): value is { items: unknown[] } {
  return Boolean(value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items));
}

function unwrapContextPayload(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (record.context && typeof record.context === "object") return record.context;
  if (record.data && typeof record.data === "object") return record.data;
  if (record.result && typeof record.result === "object") return record.result;
  return value;
}

function normalizeContextPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = { ...(value as Record<string, unknown>) };
  record.mood = stringList(record.mood);
  record.avoid = stringList(record.avoid);
  record.targetTags = stringList(record.targetTags);
  record.excludeTags = stringList(record.excludeTags);
  record.energy = normalizeEnergy(record.energy);
  record.vocal = normalizeVocal(record.vocal);
  record.novelty = normalizeNovelty(record.novelty);
  record.familiarRatio = normalizeRatio(record.familiarRatio);
  record.exploreRatio = normalizeRatio(record.exploreRatio);
  return record;
}

function stringList(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") {
    return value
      .split(/[,，、;；|]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return undefined;
}

function normalizeNovelty(value: unknown) {
  if (value === "familiar" || value === "balanced" || value === "explore") return value;
  if (typeof value === "number") {
    if (value >= 0.66) return "explore";
    if (value <= 0.33) return "familiar";
    return "balanced";
  }
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (["new", "fresh", "explore", "探索", "新鲜"].some((word) => lower.includes(word.toLowerCase()))) return "explore";
    if (["familiar", "熟悉", "红心", "常听"].some((word) => lower.includes(word.toLowerCase()))) return "familiar";
  }
  return undefined;
}

function normalizeEnergy(value: unknown) {
  if (value === "low" || value === "low_to_medium" || value === "medium" || value === "high" || value === "unknown") return value;
  if (typeof value === "number") {
    if (value <= 0.25) return "low";
    if (value <= 0.45) return "low_to_medium";
    if (value <= 0.75) return "medium";
    return "high";
  }
  if (typeof value !== "string") return undefined;
  const lower = value.toLowerCase().trim();
  if (["low", "quiet", "soft", "calm", "relaxed", "chill", "低", "安静", "轻松"].some((word) => lower.includes(word.toLowerCase()))) return "low";
  if (["low_to_medium", "low-medium", "medium_low", "gentle", "mellow", "舒缓"].some((word) => lower.includes(word.toLowerCase()))) return "low_to_medium";
  if (["medium", "steady", "stable", "moderate", "balanced", "normal", "mid", "中等", "稳定", "均衡"].some((word) => lower.includes(word.toLowerCase()))) return "medium";
  if (["high", "energetic", "intense", "fast", "loud", "upbeat", "高", "强", "激烈"].some((word) => lower.includes(word.toLowerCase()))) return "high";
  return undefined;
}

function normalizeVocal(value: unknown) {
  if (value === "less_vocal" || value === "vocal_ok" || value === "instrumental" || value === "strong_vocal" || value === "unknown") return value;
  if (typeof value !== "string") return undefined;
  const lower = value.toLowerCase().trim();
  if (["instrumental", "no vocal", "no_vocal", "无人声", "纯音乐"].some((word) => lower.includes(word.toLowerCase()))) return "instrumental";
  if (["less_vocal", "less vocal", "few vocal", "少人声", "人声少"].some((word) => lower.includes(word.toLowerCase()))) return "less_vocal";
  if (["strong_vocal", "vocal-forward", "vocal forward", "人声突出", "强人声"].some((word) => lower.includes(word.toLowerCase()))) return "strong_vocal";
  if (["vocal_ok", "vocal", "voice", "人声", "可以有人声"].some((word) => lower.includes(word.toLowerCase()))) return "vocal_ok";
  return undefined;
}

function normalizeRatio(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string") {
    const parsed = Number(value.trim().replace("%", ""));
    if (!Number.isFinite(parsed)) return undefined;
    return parsed > 1 ? Math.min(1, parsed / 100) : Math.max(0, parsed);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value > 1 ? Math.min(1, value / 100) : Math.max(0, value);
}

function stripStoredAiTags(tags: string[]) {
  return tags.filter((tag) => tag !== "ai_tagged" && tag !== "ai:tagged" && !tag.startsWith("ai:"));
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function includesAny(input: string, words: string[]) {
  return words.some((word) => input.includes(word.toLowerCase()));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function modelName() {
  return process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
}
