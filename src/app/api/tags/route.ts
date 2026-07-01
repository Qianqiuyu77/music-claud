import { canAccessAdmin } from "@/lib/admin/access";
import { tagStoredLibraryBatch } from "@/lib/appServices";

export async function POST(request: Request) {
  if (!(await canAccessAdmin(request))) {
    return new Response(null, { status: 404 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { limit?: number };
    const result = await tagStoredLibraryBatch(body.limit);
    return Response.json({
      counts: {
        songs: result.stats?.songs ?? 0,
        imported: result.songs.length,
        playableSongs: result.stats?.playableSongs ?? 0,
        lastSyncAt: result.stats?.lastSyncAt ?? null,
        partialFailures: result.partialFailures.length
      },
      partialFailures: result.partialFailures
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "AI 打标失败，请稍后再试。" }, { status: 500 });
  }
}
