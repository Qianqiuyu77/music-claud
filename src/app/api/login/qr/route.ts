import { getLoginQrPreview, resolveCurrentUserForRequest } from "@/lib/appServices";
import { hasSignedSessionCookie } from "@/lib/user/sessionCookie";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const forceRealLogin = url.searchParams.get("force") === "1";
  if (!hasSignedSessionCookie(request) && !forceRealLogin) {
    return Response.json(await getLoginQrPreview(true));
  }
  const user = await resolveCurrentUserForRequest(request);
  return Response.json(await getLoginQrPreview(forceRealLogin, { userId: user.id }));
}
