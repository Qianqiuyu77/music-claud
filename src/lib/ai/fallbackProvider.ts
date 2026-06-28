import type { AiProvider } from "./types";
import type { ListeningContext, RankedRecommendation } from "@/lib/recommendation/types";

export class FallbackAiProvider implements AiProvider {
  async parseListeningContext(input: string, _profileSummary = ""): Promise<ListeningContext> {
    const lower = input.toLowerCase();
    const hasWorkIntent = includesAny(lower, ["code", "work", "写代码", "编程", "工作", "办公"]);
    const wantsCalm = includesAny(lower, ["calm", "quiet", "安静", "轻", "稳定"]);
    const wantsFocus = includesAny(lower, ["focus", "focused", "专注", "写代码", "编程"]);
    const wantsLowEnergy = includesAny(lower, ["sleep", "困", "睡", "放松"]);
    const wantsLessVocal = includesAny(lower, ["less vocal", "instrumental", "少人声", "无人声", "纯音乐"]);
    const wantsExplore = includesAny(lower, ["new", "explore", "新鲜", "探索", "没听过"]);
    const avoidsNoise = includesAny(lower, ["noisy", "吵", "太炸", "噪"]);

    return {
      scene: hasWorkIntent ? "work" : "general",
      mood: [wantsCalm ? "calm" : "balanced", wantsFocus ? "focused" : "open"],
      energy: wantsLowEnergy ? "low" : "low_to_medium",
      vocal: wantsLessVocal ? "less_vocal" : "vocal_ok",
      novelty: wantsExplore ? "explore" : "balanced",
      avoid: avoidsNoise ? ["noisy"] : []
    };
  }

  async summarizePreference(_profileData?: unknown): Promise<string> {
    return "偏好安静、专注、不过度疲劳的音乐，并保留少量新鲜感。";
  }

  async generateReasons(recommendations: RankedRecommendation[], _context?: ListeningContext): Promise<string[]> {
    return recommendations.map((item) => item.reason);
  }
}

function includesAny(input: string, words: string[]) {
  return words.some((word) => input.includes(word));
}
