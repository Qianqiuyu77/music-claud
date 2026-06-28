import { z } from "zod";
import { recordSongPlayback } from "@/lib/appServices";

const playbackEventSchema = z.object({
  itemId: z.string().min(1),
  playedSeconds: z.number().nonnegative(),
  durationSeconds: z.number().nonnegative().nullable().optional(),
  completed: z.boolean().optional()
});

export async function POST(request: Request) {
  try {
    const parsed = playbackEventSchema.parse(await request.json());
    const saved = await recordSongPlayback(parsed);
    return Response.json({ ok: true, saved });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "播放记录保存失败。" },
      { status: 400 }
    );
  }
}
