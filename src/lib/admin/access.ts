import { getMusicRepositoryForApp } from "@/lib/appServices";
import type { AppDatabase } from "@/lib/db/client";
import { isOwnerUser, resolveCurrentUser } from "@/lib/user/currentUser";
import { hasSignedSessionCookie } from "@/lib/user/sessionCookie";

export async function canAccessAdmin(request: Request) {
  if (hasUnsignedSessionCookie(request)) {
    return false;
  }
  if (requiresExplicitAdminSession() && !hasSignedSessionCookie(request)) {
    return false;
  }
  const repository = await getMusicRepositoryForApp();
  const db = (repository as unknown as { db: AppDatabase }).db;
  return isOwnerUser(resolveCurrentUser(db, request));
}

function requiresExplicitAdminSession() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.AI_MUSIC_INVITE_CODES?.trim());
}

function hasUnsignedSessionCookie(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  return /(?:^|;\s*)ai_music_user=[^;]+(?:;|$)/.test(cookie) && !hasSignedSessionCookie(request);
}
