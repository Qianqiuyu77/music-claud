import { z } from "zod";
import { recordSongPlayback, resolveCurrentUserForRequest, UserSongAccessError } from "@/lib/appServices";

const playbackEventSchema = z.object({
  itemId: z.string().min(1),
  playedSeconds: z.number().nonnegative(),
  durationSeconds: z.number().nonnegative().nullable().optional(),
  completed: z.boolean().optional()
});

export async function POST(request: Request) {
  try {
    const parsed = playbackEventSchema.parse(await request.json());
    const user = await resolveCurrentUserForRequest(request);
    const saved = await recordSongPlayback(parsed, { userId: user.id });
    return Response.json({ ok: true, saved });
  } catch (error) {
    if (error instanceof UserSongAccessError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "播放记录保存失败。" },
      { status: 400 }
    );
  }
}
