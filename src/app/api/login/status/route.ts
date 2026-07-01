import { getLoginStatusPreview, resolveCurrentUserForRequest } from "@/lib/appServices";
import { createSessionSetCookie, hasSignedSessionCookie } from "@/lib/user/sessionCookie";

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
  const status = await getLoginStatusPreview(key, url.searchParams.get("force") === "1", undefined, { userId: user.id });
  const statusUserId = readStatusUserId(status);
  const headers = status.status === "authorized" && statusUserId && statusUserId !== user.id ? { "Set-Cookie": createSessionSetCookie(statusUserId, request) } : undefined;
  return Response.json(stripInternalLoginStatus(status), { headers });
}

function readStatusUserId(status: Awaited<ReturnType<typeof getLoginStatusPreview>>) {
  return "userId" in status && typeof status.userId === "number" ? status.userId : null;
}

function stripInternalLoginStatus(status: Awaited<ReturnType<typeof getLoginStatusPreview>>) {
  if ("userId" in status) {
    const { userId: _userId, ...safeStatus } = status;
    return safeStatus;
  }
  return status;
}
