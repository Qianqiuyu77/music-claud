import { handleProactiveCompanionRequest } from "@/lib/proactiveCompanionRoute";

export async function POST(request: Request) {
  return handleProactiveCompanionRequest(request);
}
