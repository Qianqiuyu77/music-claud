import { canAccessAdmin } from "@/lib/admin/access";
import { expandStoredLibrary, resolveCurrentUserForRequest } from "@/lib/appServices";

export async function POST(request: Request) {
  if (!(await canAccessAdmin(request))) {
    return new Response(null, { status: 404 });
  }

  try {
    const user = await resolveCurrentUserForRequest(request);
    const result = await expandStoredLibrary({ userId: user.id });
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
