const baseUrl = process.env.APP_BASE_URL?.trim() ?? "http://localhost:3000";
const secret = process.env.TAGGING_WORKER_SECRET?.trim();
const limit = Number(process.env.TAGGING_WORKER_LIMIT ?? "");

if (!secret) {
  console.error("TAGGING_WORKER_SECRET is required.");
  process.exit(1);
}

const response = await fetch(new URL("/api/workers/tagging", baseUrl), {
  method: "POST",
  headers: {
    authorization: `Bearer ${secret}`,
    "content-type": "application/json"
  },
  body: JSON.stringify(Number.isFinite(limit) && limit > 0 ? { limit } : {})
});

const body = await response.text();
if (!response.ok) {
  console.error(body);
  process.exit(1);
}

console.log(body);
