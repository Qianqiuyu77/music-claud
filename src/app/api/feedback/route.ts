import { z } from "zod";
import { recordRecommendationFeedback } from "@/lib/appServices";

const feedbackSchema = z.object({
  itemId: z.string(),
  feedback: z.enum(["like", "dislike", "too_familiar", "more_like_this", "later"])
});

export async function POST(request: Request) {
  const parsed = feedbackSchema.parse(await request.json());
  return Response.json({ ok: true, saved: recordRecommendationFeedback(parsed.itemId, parsed.feedback) });
}
