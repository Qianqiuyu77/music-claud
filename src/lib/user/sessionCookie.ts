import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_COOKIE_NAME = "ai_music_user";
const SESSION_VERSION = "v1";

export function createSessionCookieValue(userId: number) {
  const id = String(userId);
  return `${SESSION_VERSION}.${id}.${signSessionId(id)}`;
}

export function createSessionSetCookie(userId: number) {
  const attributes = [`${SESSION_COOKIE_NAME}=${createSessionCookieValue(userId)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (process.env.NODE_ENV === "production") {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

export function parseSignedSessionUserId(cookieHeader: string) {
  const value = readCookie(cookieHeader, SESSION_COOKIE_NAME);
  if (!value) return null;
  const [version, id, signature] = value.split(".");
  if (version !== SESSION_VERSION || !id || !signature) return null;
  const userId = Number(id);
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;
  if (!safeSignatureEqual(signature, signSessionId(id))) return null;
  return userId;
}

export function hasSignedSessionCookie(request: Request) {
  return parseSignedSessionUserId(request.headers.get("cookie") ?? "") !== null;
}

function signSessionId(id: string) {
  return createHmac("sha256", sessionSecret()).update(`${SESSION_VERSION}.${id}`).digest("base64url");
}

function safeSignatureEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function sessionSecret() {
  return process.env.AI_MUSIC_SESSION_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim() || "local-dev-ai-music-session-secret";
}

function readCookie(cookieHeader: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${escapedName}=([^;]+)`));
  return match?.[1] ?? null;
}
