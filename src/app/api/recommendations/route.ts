import { createRecommendationResponse, getMusicRepositoryForApp, hasConfiguredNeteaseCookie } from "@/lib/appServices";

export async function POST(request: Request) {
  const body = (await request.json()) as { prompt?: string; limit?: number; excludeIds?: string[] };
  const prompt = body.prompt?.trim() ?? "";
  if (!prompt) {
    return Response.json({ error: "请输入当前想听歌的场景。" }, { status: 400 });
  }
  const stats = (await getMusicRepositoryForApp()).getLibraryStats();
  if (!hasConfiguredNeteaseCookie() && stats.songs === 0) {
    return Response.json({ error: "缺少网易云 Cookie 或本地曲库，不能生成真实推荐。" }, { status: 401 });
  }
  try {
    return Response.json(
      await createRecommendationResponse(prompt, undefined, {
        limit: body.limit,
        excludeIds: Array.isArray(body.excludeIds) ? body.excludeIds : [],
        requireAi: true
      })
    );
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "推荐生成失败，请稍后再试。" }, { status: 400 });
  }
}
