import { canAccessAdmin } from "@/lib/admin/access";
import { resolveCurrentUserForRequest, saveNeteaseCookie } from "@/lib/appServices";

export async function POST(request: Request) {
  if (!(await canAccessAdmin(request))) {
    return new Response(null, { status: 404 });
  }

  const body = (await request.json()) as { cookie?: string };
  const user = await resolveCurrentUserForRequest(request);
  const result = await saveNeteaseCookie(body.cookie ?? "", { userId: user.id });
  return Response.json(stripInternalCookieResult(result), { status: result.ok ? 200 : 400 });
}

function stripInternalCookieResult(result: Awaited<ReturnType<typeof saveNeteaseCookie>>) {
  if ("userId" in result) {
    const { userId: _userId, ...safeResult } = result;
    return safeResult;
  }
  return result;
}
