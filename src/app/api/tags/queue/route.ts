import { canAccessAdmin } from "@/lib/admin/access";
import { getMusicRepositoryForApp } from "@/lib/appServices";
import type { AppDatabase } from "@/lib/db/client";
import { TaggingQueueRepository } from "@/lib/repositories/taggingQueueRepository";

export async function GET(request: Request) {
  if (!(await canAccessAdmin(request))) {
    return new Response(null, { status: 404 });
  }

  try {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 20);
    const repository = await getMusicRepositoryForApp();
    const queue = new TaggingQueueRepository((repository as unknown as { db: AppDatabase }).db);
    return Response.json({
      counts: queue.getCounts(),
      jobs: queue.listRecent(Number.isFinite(limit) ? limit : 20)
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Tag queue status could not be loaded." },
      { status: 500 }
    );
  }
}
