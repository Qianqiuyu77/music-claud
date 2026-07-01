import { canAccessAdmin } from "@/lib/admin/access";
import { getNeteaseCookieDiagnostics } from "@/lib/appServices";

export async function GET(request: Request) {
  if (!(await canAccessAdmin(request))) {
    return new Response(null, { status: 404 });
  }

  return Response.json(await getNeteaseCookieDiagnostics());
}
