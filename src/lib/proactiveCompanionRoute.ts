import { createProactiveCompanionResponse, resolveCurrentUserForRequest } from "@/lib/appServices";
import { normalizeChatInput } from "@/lib/companionChatRoute";
import type { AiProvider } from "@/lib/ai/types";

export async function handleProactiveCompanionRequest(request: Request, options: { aiProvider?: AiProvider } = {}) {
  try {
    const body = await request.json().catch(() => ({}));
    const input = normalizeChatInput({ ...(typeof body === "object" && body ? body : {}), message: "proactive companion" });
    const user = await resolveCurrentUserForRequest(request);
    const response = await createProactiveCompanionResponse(
      {
        song: input.song,
        currentLyricLine: input.currentLyricLine,
        playback: input.playback,
        history: input.history
      },
      { aiProvider: options.aiProvider, userId: user.id }
    );
    return Response.json({
      message: response.message,
      rawResponse: response.rawResponse
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "主动伴听生成失败，请稍后再试。" },
      { status: 400 }
    );
  }
}
