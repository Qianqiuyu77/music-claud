const preferredCookieKeys = [
  "MUSIC_U",
  "MUSIC_A",
  "__csrf",
  "JSESSIONID-WYYY",
  "NMTID",
  "sDeviceId",
  "_ntes_nuid",
  "_ntes_nnid",
  "WEVNSM",
  "WNMCID",
  "ntes_kaola_ad"
];

const allowedCookieKeys = new Set(preferredCookieKeys);

export function normalizeNeteaseCookie(input: string) {
  const parsed = parseCookieInput(input);
  return preferredCookieKeys
    .filter((key) => parsed.has(key))
    .map((key) => `${key}=${parsed.get(key)}`)
    .join("; ");
}

function parseCookieInput(input: string) {
  const fromStandardCookie = parseStandardCookie(input);
  if (fromStandardCookie.size > 0) return fromStandardCookie;
  const fromBareMusicU = parseBareMusicUToken(input);
  if (fromBareMusicU.size > 0) return fromBareMusicU;
  return parseDevtoolsTable(input);
}

function parseStandardCookie(input: string) {
  const result = new Map<string, string>();
  for (const part of input.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (allowedCookieKeys.has(key) && value) result.set(key, value);
  }
  return result;
}

function parseBareMusicUToken(input: string) {
  const result = new Map<string, string>();
  const token = input.trim();
  if (/^[A-Za-z0-9_-]{48,}$/.test(token)) result.set("MUSIC_U", token);
  return result;
}

function parseDevtoolsTable(input: string) {
  const result = new Map<string, string>();
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const columns = line.includes("\t") ? line.split(/\t+/).map((value) => value.trim()) : line.split(/\s{2,}/).map((value) => value.trim());
    const key = columns[0];
    const value = columns[1];
    if (allowedCookieKeys.has(key) && value) result.set(key, value);
  }
  return result;
}
