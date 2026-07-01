import { spawnSync } from "node:child_process";

const productionEnvNames = [
  "APP_BASE_URL",
  "MUSIC_DB_PATH",
  "MUSIC_DB_BACKUP_DIR",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "NETEASE_COOKIE",
  "NETEASE_USE_REAL_LOGIN",
  "NETEASE_DEVICE_ID",
  "AI_MUSIC_SESSION_SECRET",
  "AI_MUSIC_INVITE_CODES",
  "TAGGING_WORKER_SECRET",
  "TAGGING_WORKER_LIMIT",
  "TAGGING_QUEUE_BATCH_LIMIT",
  "TAGGING_QUEUE_MAX_ATTEMPTS",
  "TAGGING_QUEUE_RETRY_DELAY_SECONDS",
  "SYNC_AI_TAG_LIMIT"
];

const steps = [
  {
    name: "unit tests",
    commandLabel: "npm test",
    command: "npm",
    args: ["test"],
    env: createTestEnv()
  },
  {
    name: "typecheck",
    commandLabel: "npm run typecheck",
    command: "npm",
    args: ["run", "typecheck"],
    env: createTestEnv()
  },
  {
    name: "production environment",
    commandLabel: "npm run deploy:check-env",
    command: "npm",
    args: ["run", "deploy:check-env"]
  },
  {
    name: "production build",
    commandLabel: "npm run build",
    command: "npm",
    args: ["run", "build"]
  },
  {
    name: "database schema",
    commandLabel: "npm run db:check",
    command: "npm",
    args: ["run", "db:check"]
  }
];

for (const step of steps) {
  console.log(`\n==> ${step.name}: ${step.commandLabel}`);
  const invocation = commandInvocation(step.command, step.args);
  const result = spawnSync(invocation.command, invocation.args, {
    env: { ...process.env, ...step.env },
    stdio: "inherit"
  });

  if (result.status !== 0) {
    if (result.error) console.error(result.error.message);
    console.error(`Release check failed at step: ${step.name}`);
    process.exit(result.status ?? 1);
  }
}

console.log("\nRelease check passed.");

function createTestEnv() {
  const env = { ...process.env, NODE_ENV: "test" };
  const productionNames = new Set(productionEnvNames.map((name) => name.toLowerCase()));
  for (const name of Object.keys(env)) {
    if (productionNames.has(name.toLowerCase())) delete env[name];
  }
  for (const name of productionEnvNames) env[name] = "";
  return env;
}

function commandInvocation(command, args) {
  if (process.platform !== "win32") return { command, args };
  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", [command, ...args].join(" ")]
  };
}
