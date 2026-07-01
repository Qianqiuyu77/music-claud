import type { AppDatabase } from "@/lib/db/client";
import { UserRepository, type AppUser } from "@/lib/repositories/userRepository";
import { parseSignedSessionUserId } from "@/lib/user/sessionCookie";

export function getDefaultCurrentUser(db: AppDatabase): AppUser {
  return new UserRepository(db).getDefaultOwner();
}

export function resolveCurrentUser(db: AppDatabase, request?: Request): AppUser {
  const users = new UserRepository(db);
  const cookieHeader = request?.headers.get("cookie") ?? "";
  const userId = parseSignedSessionUserId(cookieHeader);
  if (userId) {
    const user = users.getUserById(userId);
    if (user) return user;
    return unknownUser();
  }
  if (hasUnsignedSessionCookie(cookieHeader)) {
    return unknownUser();
  }
  return users.getDefaultOwner();
}

export function isOwnerUser(user: AppUser) {
  return user.id === 1 && user.handle === "owner";
}

function hasUnsignedSessionCookie(cookieHeader: string) {
  return /(?:^|;\s*)ai_music_user=[^;]+(?:;|$)/.test(cookieHeader);
}

function unknownUser(): AppUser {
  return {
    id: 0,
    handle: "unknown",
    nickname: null
  };
}
