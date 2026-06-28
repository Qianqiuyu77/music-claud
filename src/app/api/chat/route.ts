import { handleChatRequest } from "@/lib/companionChatRoute";

export async function POST(request: Request) {
  return handleChatRequest(request);
}
