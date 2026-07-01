import { processTaggingQueueBatch } from "@/lib/appServices";

function hasWorkerAccess(request: Request) {
  const secret = process.env.TAGGING_WORKER_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!hasWorkerAccess(request)) {
    return Response.json({ error: "Unauthorized worker request." }, { status: 401 });
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
      { error: error instanceof Error ? error.message : "Tag worker processing failed." },
      { status: 500 }
    );
  }
}
