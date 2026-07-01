import { getLoginStatusPreview, resolveCurrentUserForRequest } from "@/lib/appServices";
import { hasSignedSessionCookie } from "@/lib/user/sessionCookie";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (!key) {
    return Response.json({ error: "missing key" }, { status: 400 });
  }
  if (!hasSignedSessionCookie(request)) {
    await getLoginStatusPreview(key, true, undefined, { persist: false });
    return Response.json({ status: "waiting" });
  }
  const user = await resolveCurrentUserForRequest(request);
  return Response.json(await getLoginStatusPreview(key, url.searchParams.get("force") === "1", undefined, { userId: user.id }));
}
