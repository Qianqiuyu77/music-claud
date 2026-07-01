import { canAccessAdmin } from "@/lib/admin/access";
import { processTaggingQueueBatch } from "@/lib/appServices";

export async function POST(request: Request) {
  if (!(await canAccessAdmin(request))) {
    return new Response(null, { status: 404 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { limit?: number };
    const result = await processTaggingQueueBatch({ limit: body.limit });
    return Response.json({
      counts: {
        processed: result.processed,
        succeeded: result.succeeded,
        failed: result.failed,
        songs: result.songs.length
      }
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Tag queue processing failed." },
      { status: 500 }
    );
  }
}
