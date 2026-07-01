import { z } from "zod";
import { recordRecommendationFeedback, resolveCurrentUserForRequest, UserSongAccessError } from "@/lib/appServices";

const feedbackSchema = z.object({
  itemId: z.string(),
  feedback: z.enum(["like", "dislike", "too_familiar", "more_like_this", "later"])
});

export async function POST(request: Request) {
  const parsed = feedbackSchema.parse(await request.json());
  const user = await resolveCurrentUserForRequest(request);
  try {
    return Response.json({ ok: true, saved: await recordRecommendationFeedback(parsed.itemId, parsed.feedback, { userId: user.id }) });
  } catch (error) {
    if (error instanceof UserSongAccessError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
