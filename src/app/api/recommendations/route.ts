import { createRecommendationResponse, getCurrentUserLoginStatus, getStoredLibraryStatus, hasConfiguredNeteaseCookie, resolveCurrentUserForRequest } from "@/lib/appServices";
import type { RecommendationMode, RecommendationScene } from "@/lib/recommendation/types";

export async function POST(request: Request) {
  const body = (await request.json()) as { prompt?: string; text?: string; mode?: RecommendationMode; scene?: RecommendationScene; limit?: number; excludeIds?: string[] };
  const prompt = (body.text ?? body.prompt)?.trim() ?? "";
  if (!prompt) {
    return Response.json({ error: "请输入当前想听歌的场景。" }, { status: 400 });
  }
  const user = await resolveCurrentUserForRequest(request);
  const libraryStatus = await getStoredLibraryStatus(user.id);
  const loginStatus = await getCurrentUserLoginStatus(request);
  if (!hasConfiguredNeteaseCookie() && loginStatus.status !== "active" && libraryStatus.counts.songs === 0) {
    return Response.json({ error: "缺少网易云 Cookie 或本地曲库，不能生成真实推荐。" }, { status: 401 });
  }
  try {
    return Response.json(
      await createRecommendationResponse(prompt, undefined, {
        limit: body.limit,
        excludeIds: Array.isArray(body.excludeIds) ? body.excludeIds : [],
        mode: body.mode,
        scene: body.scene,
        userId: user.id,
        requireAi: true
      })
    );
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "推荐生成失败，请稍后再试。" }, { status: 400 });
  }
}
