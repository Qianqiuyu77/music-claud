import { createDefaultLikedQueueResponse, getMusicRepositoryForApp, getStoredLibraryStatus } from "@/lib/appServices";
import type { AppDatabase } from "@/lib/db/client";
import { resolveCurrentUser } from "@/lib/user/currentUser";

export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 12);
  const user = resolveCurrentUser((await getMusicRepositoryForApp() as unknown as { db: AppDatabase }).db, request);
  const libraryStatus = await getStoredLibraryStatus(user.id);
  if (libraryStatus.counts.songs === 0) {
    return Response.json({ error: "本地曲库为空，请先导入网易云歌曲。" }, { status: 404 });
  }

  try {
    return Response.json(await createDefaultLikedQueueResponse({ limit, userId: user.id }));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "默认播放队列生成失败。" },
      { status: 400 }
    );
  }
}
