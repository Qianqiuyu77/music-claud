import { createCompanionChatResponse } from "@/lib/appServices";
import type { AiProvider, CompanionChatInput, CompanionChatMessage } from "@/lib/ai/types";

type ChatRouteBody = {
  message?: string;
  song?: {
    id?: string;
    name?: string;
    artists?: string[];
    album?: string | null;
    tags?: string[];
  };
  currentLyricLine?: {
    time?: number | null;
    text?: string;
    translation?: string | null;
  } | null;
  playback?: {
    currentTime?: number | null;
    duration?: number | null;
  };
  history?: CompanionChatMessage[];
};

export async function handleChatRequest(request: Request, options: { aiProvider?: AiProvider } = {}) {
  try {
    const body = (await request.json().catch(() => ({}))) as ChatRouteBody;
    const input = normalizeChatInput(body);
    const response = await createCompanionChatResponse(input, options);
    return Response.json({
      message: response.message,
      rawResponse: response.rawResponse
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "伴听聊天失败，请稍后再试。" },
      { status: 400 }
    );
  }
}

export function normalizeChatInput(body: ChatRouteBody): CompanionChatInput {
  const song = body.song ?? {};
  return {
    message: String(body.message ?? "").trim(),
    song: {
      id: String(song.id ?? "").trim(),
      name: String(song.name ?? "").trim(),
      artists: Array.isArray(song.artists) ? song.artists.filter(isNonEmptyString).slice(0, 6) : [],
      album: song.album ?? null,
      tags: Array.isArray(song.tags) ? song.tags.filter(isNonEmptyString).slice(0, 24) : []
    },
    currentLyricLine: normalizeLyricLine(body.currentLyricLine),
    playback: {
      currentTime: normalizeNumber(body.playback?.currentTime),
      duration: normalizeNumber(body.playback?.duration)
    },
    history: Array.isArray(body.history) ? body.history.filter(isChatMessage).slice(-12) : []
  };
}

function normalizeLyricLine(line: ChatRouteBody["currentLyricLine"]) {
  if (!line?.text?.trim()) return null;
  return {
    time: normalizeNumber(line.time),
    text: line.text.trim(),
    translation: line.translation?.trim() || null
  };
}

function isChatMessage(message: unknown): message is CompanionChatMessage {
  if (!message || typeof message !== "object") return false;
  const record = message as Partial<CompanionChatMessage>;
  return (record.role === "user" || record.role === "companion") && typeof record.text === "string" && record.text.trim().length > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
