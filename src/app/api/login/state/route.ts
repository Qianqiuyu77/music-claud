import { getCurrentUserLoginStatus } from "@/lib/appServices";

export async function GET(request: Request) {
  try {
    return Response.json({
      login: await getCurrentUserLoginStatus(request)
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Login state could not be loaded." },
      { status: 500 }
    );
  }
}
