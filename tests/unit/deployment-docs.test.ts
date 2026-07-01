import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";

describe("deployment hardening documentation", () => {
  it("documents production environment, SQLite operations, and deploy gates", () => {
    const doc = readFileSync("docs/deployment.md", "utf8");

    for (const envName of [
      "MUSIC_DB_PATH",
      "AI_MUSIC_INVITE_CODES",
      "TAGGING_WORKER_SECRET",
      "AI_MUSIC_SESSION_SECRET",
      "APP_BASE_URL",
      "DEEPSEEK_API_KEY",
      "NETEASE_USE_REAL_LOGIN"
    ]) {
      expect(doc).toContain(envName);
    }

    expect(doc).toContain("SQLite");
    expect(doc).toContain("npm run db:check");
    expect(doc).toContain("npm run db:backup");
    expect(doc).toContain("npm run build");
    expect(doc).toContain("npm run smoke:production");
    expect(doc).toContain("Raw Cookie");
  });

  it("exposes deployment database scripts", () => {
    expect(packageJson.scripts).toEqual(
      expect.objectContaining({
        "db:check": "node scripts/check-db.mjs",
        "db:backup": "node scripts/backup-db.mjs",
        start: "next start",
        "smoke:production": "node scripts/production-smoke.mjs"
      })
    );
  });

  it("uses the application database migration for deployment checks", () => {
    const script = readFileSync("scripts/check-db.mjs", "utf8");

    expect(script).toContain("src/lib/db/client.ts");
    expect(script).toContain("src/lib/db/schema.ts");
    expect(script).toContain("migrate(db)");
    expect(script).not.toContain("CREATE TABLE IF NOT EXISTS users");
  });

  it("ships a production smoke script for post-deploy checks", () => {
    const script = readFileSync("scripts/production-smoke.mjs", "utf8");

    expect(script).toContain("APP_BASE_URL");
    expect(script).toContain("/api/login/qr");
    expect(script).toContain("/api/workers/tagging");
    expect(script).toContain("MUSIC_U");
    expect(script).toContain("ai_music_user=999");
  });

  it("checks production environment shape without echoing secrets", () => {
    expect(packageJson.scripts).toEqual(
      expect.objectContaining({
        "deploy:check-env": "node scripts/check-production-env.mjs"
      })
    );

    expect(() =>
      execFileSync("node", ["scripts/check-production-env.mjs"], {
        env: {
          ...process.env,
          NODE_ENV: "production",
          APP_BASE_URL: "",
          MUSIC_DB_PATH: "",
          MUSIC_DB_BACKUP_DIR: "",
          DEEPSEEK_API_KEY: "",
          NETEASE_USE_REAL_LOGIN: "",
          NETEASE_DEVICE_ID: "",
          AI_MUSIC_SESSION_SECRET: "",
          AI_MUSIC_INVITE_CODES: "",
          TAGGING_WORKER_SECRET: ""
        },
        encoding: "utf8",
        stdio: "pipe"
      })
    ).toThrow(/APP_BASE_URL/);

    const output = execFileSync("node", ["scripts/check-production-env.mjs"], {
      env: {
        ...process.env,
        NODE_ENV: "production",
        APP_BASE_URL: "https://music.example.test",
        MUSIC_DB_PATH: "/srv/ai-music/data/music.sqlite",
        MUSIC_DB_BACKUP_DIR: "/srv/ai-music/backups",
        DEEPSEEK_API_KEY: "secret-deepseek-key",
        NETEASE_USE_REAL_LOGIN: "1",
        NETEASE_DEVICE_ID: "stable-device-id",
        AI_MUSIC_SESSION_SECRET: "secret-session-token-at-least-32-chars",
        AI_MUSIC_INVITE_CODES: "alpha-private,beta-private",
        TAGGING_WORKER_SECRET: "secret-worker-token"
      },
      encoding: "utf8",
      stdio: "pipe"
    });

    expect(output).toContain("Production environment check passed");
    expect(output).not.toContain("secret-deepseek-key");
    expect(output).not.toContain("secret-worker-token");

    expect(() =>
      execFileSync("node", ["scripts/check-production-env.mjs"], {
        env: {
          ...process.env,
          NODE_ENV: "production",
          APP_BASE_URL: "https://music.example.com",
          MUSIC_DB_PATH: "/srv/ai-music/data/music.sqlite",
          MUSIC_DB_BACKUP_DIR: "/srv/ai-music/backups",
          DEEPSEEK_API_KEY: "replace-with-server-secret",
          NETEASE_USE_REAL_LOGIN: "1",
          NETEASE_DEVICE_ID: "replace-with-stable-device-id",
          AI_MUSIC_SESSION_SECRET: "replace-with-32-plus-char-session-secret",
          AI_MUSIC_INVITE_CODES: "owner-code,friend-code",
          TAGGING_WORKER_SECRET: "replace-with-long-random-secret"
        },
        encoding: "utf8",
        stdio: "pipe"
      })
    ).toThrow(/placeholder/);
  });

  it("exposes a single release check command for pre-deploy gates", () => {
    expect(packageJson.scripts).toEqual(
      expect.objectContaining({
        "release:check": "node scripts/release-check.mjs"
      })
    );

    const script = readFileSync("scripts/release-check.mjs", "utf8");
    expect(script).toContain("npm test");
    expect(script).toContain('NODE_ENV: "test"');
    expect(script).toContain("npm run deploy:check-env");
    expect(script).toContain("npm run build");
    expect(script).toContain("npm run db:check");

    const doc = readFileSync("docs/deployment.md", "utf8");
    expect(doc).toContain("npm run release:check");
  });

  it("documents private server process templates", () => {
    const doc = readFileSync("docs/deployment.md", "utf8");
    const appService = readFileSync("docs/deploy/ai-music.service", "utf8");
    const workerService = readFileSync("docs/deploy/ai-music-tagging-worker.service", "utf8");
    const workerTimer = readFileSync("docs/deploy/ai-music-tagging-worker.timer", "utf8");
    const nginx = readFileSync("docs/deploy/nginx-ai-music.conf", "utf8");

    expect(doc).toContain("docs/deploy/ai-music.service");
    expect(doc).toContain("docs/deploy/ai-music-tagging-worker.timer");
    expect(doc).toContain("docs/deploy/nginx-ai-music.conf");

    expect(appService).toContain("npm run release:check");
    expect(appService).toContain("npm run db:backup");
    expect(appService).toContain("npm run start");
    expect(workerService).toContain("npm run worker:tagging");
    expect(workerService).toContain("TAGGING_WORKER_SECRET");
    expect(workerTimer).toContain("OnCalendar=");
    expect(nginx).toContain("proxy_pass http://127.0.0.1:3000");
    expect(nginx).toContain("ssl_certificate");
  });

  it("ships an ordered private server deployment runbook", () => {
    const runbook = readFileSync("docs/deploy/private-server-runbook.md", "utf8");

    for (const section of [
      "## 1. Prepare Server Directories",
      "## 2. Configure Server Environment",
      "## 3. Install And Verify The App",
      "## 4. Enable The Web Service",
      "## 5. Enable HTTPS Reverse Proxy",
      "## 6. Run Post-Deploy Smoke",
      "## 7. Enable Background Tagging",
      "## 8. Manual Product Smoke",
      "## Rollback"
    ]) {
      expect(runbook).toContain(section);
    }

    for (const command of [
      "sudo mkdir -p /srv/ai-music/app /srv/ai-music/data /srv/ai-music/backups",
      "sudo install -m 600 docs/deploy/production.env.example /srv/ai-music/.env",
      "npm ci",
      "set -a; . /srv/ai-music/.env; set +a; npm run release:check",
      "sudo systemctl enable --now ai-music.service",
      "sudo nginx -t",
      "APP_BASE_URL=https://music.example.com npm run smoke:production",
      "npm run worker:tagging",
      "sudo systemctl enable --now ai-music-tagging-worker.timer"
    ]) {
      expect(runbook).toContain(command);
    }

    for (const safetyInvariant of [
      "Do not paste raw NetEase Cookie values into this file",
      "replace every placeholder",
      "AI_MUSIC_INVITE_CODES",
      "AI_MUSIC_SESSION_SECRET",
      "TAGGING_WORKER_SECRET",
      "MUSIC_U",
      "encryptedCookie",
      "unknown or non-owner session"
    ]) {
      expect(runbook).toContain(safetyInvariant);
    }
  });

  it("ships a safe production environment example", () => {
    const doc = readFileSync("docs/deployment.md", "utf8");
    const example = readFileSync("docs/deploy/production.env.example", "utf8");

    expect(doc).toContain("docs/deploy/production.env.example");
    for (const name of [
      "NODE_ENV=production",
      "APP_BASE_URL=",
      "MUSIC_DB_PATH=",
      "MUSIC_DB_BACKUP_DIR=",
      "DEEPSEEK_API_KEY=",
      "NETEASE_USE_REAL_LOGIN=1",
      "NETEASE_DEVICE_ID=",
      "AI_MUSIC_INVITE_CODES=",
      "AI_MUSIC_SESSION_SECRET=",
      "TAGGING_WORKER_SECRET="
    ]) {
      expect(example).toContain(name);
    }

    for (const forbidden of ["MUSIC_U", "MUSIC_A", "__csrf", "NMTID", "local-dev:", "rawCookie", "encryptedCookie"]) {
      expect(example).not.toContain(forbidden);
    }
  });
});
