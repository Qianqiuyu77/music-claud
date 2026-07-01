import { canAccessAdmin } from "@/lib/admin/access";
import { getUserProfileDiagnostics, resolveCurrentUserForRequest } from "@/lib/appServices";

export async function GET(request: Request) {
  if (!(await canAccessAdmin(request))) {
    return new Response(null, { status: 404 });
  }

  try {
    const user = await resolveCurrentUserForRequest(request);
    return Response.json({
      profile: await getUserProfileDiagnostics(user.id)
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Profile status could not be loaded." },
      { status: 500 }
    );
  }
}
