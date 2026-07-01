import { getSyncPreview, NeteaseLoginExpiredError, resolveCurrentUserForRequest } from "@/lib/appServices";

export async function POST(request: Request) {
  try {
    const user = await resolveCurrentUserForRequest(request);
    const url = new URL(request.url);
    const result = await getSyncPreview({ userId: user.id, quick: url.searchParams.get("mode") === "quick" });
    const stats = "stats" in result ? result.stats : null;
    return Response.json({
      counts: {
        songs: stats?.songs ?? result.songs.length,
        imported: result.songs.length,
        playableSongs: stats?.playableSongs ?? result.songs.filter((song) => song.streamUrl).length,
        lastSyncAt: stats?.lastSyncAt ?? null,
        partialFailures: result.partialFailures.length
      },
      partialFailures: result.partialFailures
    });
  } catch (error) {
    if (error instanceof NeteaseLoginExpiredError) {
      return Response.json({ error: error.message }, { status: 401 });
    }
    return Response.json({ error: error instanceof Error ? error.message : "同步失败，请稍后再试。" }, { status: 500 });
  }
}
