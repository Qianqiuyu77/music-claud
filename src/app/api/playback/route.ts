import { proxyPlaybackRequest } from "@/lib/playback/playbackService";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id")?.trim();
  if (!id) {
    return Response.json({ error: "缺少歌曲 ID。" }, { status: 400 });
  }

  try {
    return await proxyPlaybackRequest(id, request.headers);
  } catch {
    return Response.json({ error: "播放服务暂时不可用，请稍后再试。" }, { status: 502 });
  }
}
