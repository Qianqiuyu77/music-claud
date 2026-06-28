import { getSyncPreview } from "@/lib/appServices";

export async function POST() {
  try {
    const result = await getSyncPreview();
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
    return Response.json({ error: error instanceof Error ? error.message : "同步失败，请稍后再试。" }, { status: 500 });
  }
}
