import { createDefaultLikedQueueResponse, getMusicRepositoryForApp } from "@/lib/appServices";

export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 12);
  const stats = (await getMusicRepositoryForApp()).getLibraryStats();
  if (stats.songs === 0) {
    return Response.json({ error: "本地曲库为空，请先导入网易云歌曲。" }, { status: 404 });
  }

  try {
    return Response.json(await createDefaultLikedQueueResponse({ limit }));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "默认播放队列生成失败。" },
      { status: 400 }
    );
  }
}
