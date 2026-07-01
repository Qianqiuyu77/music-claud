const required = [
  "APP_BASE_URL",
  "MUSIC_DB_PATH",
  "MUSIC_DB_BACKUP_DIR",
  "DEEPSEEK_API_KEY",
  "NETEASE_USE_REAL_LOGIN",
  "NETEASE_DEVICE_ID",
  "AI_MUSIC_SESSION_SECRET",
  "AI_MUSIC_INVITE_CODES",
  "TAGGING_WORKER_SECRET"
];

const errors = [];
const warnings = [];

for (const name of required) {
  if (!process.env[name]?.trim()) errors.push(`${name} is required.`);
}

for (const name of required) {
  const value = process.env[name]?.trim();
  if (value && isPlaceholderValue(value)) {
    errors.push(`${name} still contains a placeholder value.`);
  }
}

if (process.env.NODE_ENV?.trim() !== "production") {
  errors.push("NODE_ENV must be production.");
}

const appBaseUrl = process.env.APP_BASE_URL?.trim();
if (appBaseUrl) {
  try {
    const url = new URL(appBaseUrl);
    if (url.protocol !== "https:") {
      errors.push("APP_BASE_URL must use https for production session cookies.");
    }
  } catch {
    errors.push("APP_BASE_URL must be a valid absolute URL.");
  }
}

if (process.env.NETEASE_USE_REAL_LOGIN?.trim() !== "1") {
  errors.push("NETEASE_USE_REAL_LOGIN must be 1.");
}

const dbPath = process.env.MUSIC_DB_PATH?.trim();
if (dbPath === ":memory:") {
  errors.push("MUSIC_DB_PATH must be persistent and cannot be :memory:.");
}

const inviteCodes = splitCsv(process.env.AI_MUSIC_INVITE_CODES);
if (inviteCodes.length === 0) {
  errors.push("AI_MUSIC_INVITE_CODES must include at least one invite code.");
}
if (inviteCodes.some((code) => isPlaceholderValue(code))) {
  errors.push("AI_MUSIC_INVITE_CODES still contains a placeholder value.");
}

const workerSecret = process.env.TAGGING_WORKER_SECRET?.trim() ?? "";
if (workerSecret && workerSecret.length < 16) {
  errors.push("TAGGING_WORKER_SECRET must be at least 16 characters.");
}

const sessionSecret = process.env.AI_MUSIC_SESSION_SECRET?.trim() ?? "";
if (sessionSecret && sessionSecret.length < 32) {
  errors.push("AI_MUSIC_SESSION_SECRET must be at least 32 characters.");
}

if (process.env.NETEASE_COOKIE?.trim()) {
  warnings.push("NETEASE_COOKIE is set; production users should normally use QR login instead of a global bootstrap Cookie.");
}

if (errors.length) {
  console.error("Production environment check failed:");
  for (const error of errors) console.error(`- ${error}`);
  for (const warning of warnings) console.error(`- Warning: ${warning}`);
  process.exit(1);
}

for (const warning of warnings) console.warn(`Warning: ${warning}`);
console.log("Production environment check passed.");

function splitCsv(value) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isPlaceholderValue(value) {
  const lower = value.toLowerCase();
  return (
    lower.includes("replace-with") ||
    lower.includes("your-domain.example") ||
    lower.includes("music.example.com") ||
    lower === "owner-code" ||
    lower === "friend-code"
  );
}
