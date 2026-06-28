import { expandStoredLibrary } from "@/lib/appServices";

export async function POST() {
  try {
    const result = await expandStoredLibrary();
    return Response.json({
      counts: {
        songs: result.stats?.songs ?? result.songs.length,
        imported: result.songs.length,
        playableSongs: result.stats?.playableSongs ?? result.songs.filter((song) => song.streamUrl).length,
        partialFailures: result.partialFailures.length
      },
      partialFailures: result.partialFailures
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "扩充曲库失败，请稍后再试。" }, { status: 500 });
  }
}
