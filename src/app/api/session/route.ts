import { z } from "zod";
import { getMusicRepositoryForApp } from "@/lib/appServices";
import type { AppDatabase } from "@/lib/db/client";
import { UserRepository } from "@/lib/repositories/userRepository";
import { createSessionSetCookie, hasSignedSessionCookie } from "@/lib/user/sessionCookie";
import { resolveCurrentUser } from "@/lib/user/currentUser";

const sessionSchema = z.object({
  inviteCode: z.string().optional(),
  nickname: z.string().optional()
});

export async function POST(request: Request) {
  try {
    const parsed = sessionSchema.parse(await request.json());
    if (parsed.inviteCode && !isInviteAllowed(parsed.inviteCode)) {
      return Response.json({ error: "Invite code is not allowed." }, { status: 403 });
    }
    const repository = await getMusicRepositoryForApp();
    const db = (repository as unknown as { db: AppDatabase }).db;
    const users = new UserRepository(db);
    const currentUser = resolveCurrentUser(db, request);
    const user = parsed.inviteCode
      ? users.findOrCreateInviteUser(parsed.inviteCode, parsed.nickname)
      : hasSignedSessionCookie(request) && currentUser.id > 0
        ? currentUser
        : users.createAnonymousBrowserUser();

    return Response.json(
      { user },
      {
        headers: {
          "Set-Cookie": createSessionSetCookie(user.id)
        }
      }
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Session could not be created." },
      { status: 400 }
    );
  }
}

function isInviteAllowed(inviteCode: string) {
  const configured = process.env.AI_MUSIC_INVITE_CODES?.trim();
  if (!configured) return true;
  const allowed = new Set(
    configured
      .split(",")
      .map((code) => code.trim())
      .filter(Boolean)
  );
  return allowed.has(inviteCode.trim());
}
