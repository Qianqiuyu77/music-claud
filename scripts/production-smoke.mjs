const baseUrl = process.env.APP_BASE_URL?.trim() || "http://localhost:3000";
const forbiddenTokens = ["MUSIC_U", "MUSIC_A", "__csrf", "NMTID", "local-dev:", "encryptedCookie", "rawCookie"];

const checks = [
  {
    name: "C-side home renders",
    path: "/",
    expectStatus: 200,
    forbidSecrets: true
  },
  {
    name: "Anonymous login state is safe",
    path: "/api/login/state",
    expectStatus: 200,
    forbidSecrets: true
  },
  {
    name: "Anonymous QR preview is safe",
    path: "/api/login/qr",
    expectStatus: 200,
    forbidSecrets: true,
    validate: (body) => {
      const json = parseJson(body);
      if (!json.key || typeof json.qrUrl !== "string") throw new Error("QR response must include key and qrUrl.");
      if (json.source === "cookie") throw new Error("Anonymous QR preview must not inherit owner Cookie.");
    }
  },
  {
    name: "Unknown user cannot access admin page",
    path: "/admin",
    expectStatus: 404,
    headers: { cookie: "ai_music_user=999" }
  },
  {
    name: "Unknown user cannot access login diagnostics",
    path: "/api/login/diagnostics",
    expectStatus: 404,
    headers: { cookie: "ai_music_user=999" },
    forbidSecrets: true
  },
  {
    name: "Unknown user cannot access tag queue",
    path: "/api/tags/queue",
    expectStatus: 404,
    headers: { cookie: "ai_music_user=999" },
    forbidSecrets: true
  },
  {
    name: "Unknown user cannot access profile diagnostics",
    path: "/api/profiles/status",
    expectStatus: 404,
    headers: { cookie: "ai_music_user=999" },
    forbidSecrets: true
  },
  {
    name: "Tagging worker rejects missing secret",
    path: "/api/workers/tagging",
    method: "POST",
    expectStatus: 401,
    forbidSecrets: true
  }
];

const failures = [];

for (const check of checks) {
  try {
    const response = await fetch(new URL(check.path, baseUrl), {
      method: check.method ?? "GET",
      headers: check.headers
    });
    const body = await response.text();
    if (response.status !== check.expectStatus) {
      throw new Error(`Expected HTTP ${check.expectStatus}, got ${response.status}.`);
    }
    if (check.forbidSecrets) assertNoSecrets(body);
    check.validate?.(body);
    console.log(`PASS ${check.name}`);
  } catch (error) {
    failures.push(`${check.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length) {
  console.error("Production smoke failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Production smoke passed: ${baseUrl}`);

function assertNoSecrets(body) {
  const hit = forbiddenTokens.find((token) => body.includes(token));
  if (hit) throw new Error(`Response contained forbidden token marker: ${hit}`);
}

function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Response was not valid JSON.");
  }
}
