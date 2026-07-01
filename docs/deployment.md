# Deployment Guide

This project is currently safest as a private SQLite deployment with backups. Move to Postgres only when concurrent writes or multi-instance hosting become a real need.

## Production Environment

Use `.env.local` on the server or equivalent process environment variables. Do not commit real secrets.

Use `docs/deploy/production.env.example` as the server environment template. Copy it to the server-only environment file, replace every placeholder, and keep the filled file out of git. `npm run deploy:check-env` rejects unmodified placeholder values such as example domains, default invite-code examples, and `replace-with...` secrets.

```bash
NODE_ENV=production
APP_BASE_URL=https://your-domain.example
MUSIC_DB_PATH=/srv/ai-music/data/music.sqlite
MUSIC_DB_BACKUP_DIR=/srv/ai-music/backups

DEEPSEEK_API_KEY=replace-with-server-secret
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat

NETEASE_USE_REAL_LOGIN=1
NETEASE_DEVICE_ID=replace-with-stable-device-id

AI_MUSIC_SESSION_SECRET=replace-with-32-plus-char-session-secret
AI_MUSIC_INVITE_CODES=owner-code,friend-code

TAGGING_WORKER_SECRET=replace-with-long-random-secret
TAGGING_WORKER_LIMIT=8
TAGGING_QUEUE_BATCH_LIMIT=20
TAGGING_QUEUE_MAX_ATTEMPTS=3
TAGGING_QUEUE_RETRY_DELAY_SECONDS=300
SYNC_AI_TAG_LIMIT=100
```

Notes:

- `MUSIC_DB_PATH` stores public songs plus private user state. Back it up before every deploy.
- C-side users can open `/`, receive an anonymous signed browser session, scan the NetEase QR code, and get a user-private Cookie row. This is separate from the owner/admin user.
- `AI_MUSIC_SESSION_SECRET` signs the `ai_music_user` session cookie. Set it once before first production login and keep it stable; rotating it signs users out.
- `AI_MUSIC_INVITE_CODES` controls explicit invite-code session creation and keeps B-side/admin checks from falling back to anonymous owner access.
- Browser sessions are stored in `ai_music_user` with `HttpOnly; SameSite=Lax`; when `NODE_ENV=production`, the cookie also includes `Secure` and must be served over HTTPS.
- `TAGGING_WORKER_SECRET` protects the scheduled background tagging endpoint.
- `NETEASE_COOKIE` can exist for local owner bootstrap, but production users should normally create user-scoped cookies through QR login.
- Raw Cookie values must not appear in API JSON, UI, logs, docs, or commits.

## Database Check

Validate the production environment shape before opening the database or starting the app:

```bash
npm run deploy:check-env
```

This check verifies required production variables, HTTPS `APP_BASE_URL`, persistent SQLite paths, QR login mode, invite codes, and worker secret shape. It reports missing variable names and safety warnings only; it does not echo secret values.

Run this before first start and after deploys:

```bash
npm run db:check
```

The check opens the SQLite database at `MUSIC_DB_PATH`, creates missing baseline tables if needed, ensures the owner user exists, and fails if core tables are missing.

## Backup And Restore

Create a timestamped SQLite backup:

```bash
npm run db:backup
```

Restore manually by stopping the app and copying the selected backup over `MUSIC_DB_PATH`:

```bash
cp /srv/ai-music/backups/music.sqlite.2026-06-30T00-00-00-000Z.bak /srv/ai-music/data/music.sqlite
```

For Windows servers, use `Copy-Item` with the same source and target paths.

## Background Tagging

Schedule the public song tagging worker after the app is running:

```bash
APP_BASE_URL=https://your-domain.example TAGGING_WORKER_SECRET=replace-with-long-random-secret npm run worker:tagging
```

Run it from cron every few minutes for a private prototype. The C side remains usable while this worker fills public AI tags in the background.

## Process Templates

Linux server templates are provided as copy-and-edit examples:

- `docs/deploy/ai-music.service` starts the private web app with `npm run release:check`, `npm run db:backup`, and `npm run start` (`next start`).
- `docs/deploy/ai-music-tagging-worker.service` runs one background public-song tagging pass with `npm run worker:tagging`.
- `docs/deploy/ai-music-tagging-worker.timer` schedules the tagging worker periodically with systemd.
- `docs/deploy/nginx-ai-music.conf` is an HTTPS Nginx reverse proxy example for `127.0.0.1:3000`.

Before copying templates into `/etc/systemd/system` or `/etc/nginx/sites-available`, replace placeholder paths, user names, and `music.example.com`. Keep secrets in the server environment file, not inside unit files or Nginx config.

## Frontend And Backend Topology

This is a single Next.js deployment:

- Frontend pages are served by `next start` from `/`, `/admin`, and `/admin/cookie-test`.
- Backend APIs are served by the same process under `/api/*`.
- Nginx terminates HTTPS and proxies all routes to `127.0.0.1:3000`.
- SQLite lives at `MUSIC_DB_PATH`; keep it on persistent disk.
- Background AI tagging is a separate systemd timer calling the deployed `/api/workers/tagging` endpoint.

Do not run multiple app instances against the same SQLite file. Stay single-process until the database is migrated to a multi-writer store.

## Deployment Gate

Before deploying a release candidate:

```bash
npm run release:check
```

This runs the local automated release gate in order: unit tests, TypeScript, production environment shape, production build, and SQLite schema check. The release runner forces `NODE_ENV=test` for test/typecheck steps, then uses the configured production environment for deploy checks, build, and database checks.

```bash
npm test -- tests/unit/repositories.test.ts
npm test -- tests/unit/api-contracts.test.ts
npm test -- tests/unit/workbench.test.tsx
npm test -- tests/unit/app-shells.test.tsx
npm test -- tests/unit/cookie-test-page.test.tsx
npm test -- tests/unit/deployment-docs.test.ts
npm test -- tests/unit/deployment-smoke.test.tsx
npm run typecheck
npm run deploy:check-env
npm run build
npm run db:check
npm run smoke:production
```

The automated smoke test covers the page shells and critical API statuses for `/`, `/admin/cookie-test`, `/api/login/diagnostics`, `/api/default-queue`, `/api/recommendations`, and `/api/tags/queue`.

After the server is running, set `APP_BASE_URL` to the deployed origin and run:

```bash
APP_BASE_URL=https://your-domain.example npm run smoke:production
```

The production smoke script checks that the C-side home and login APIs respond safely, unknown browser sessions cannot reach B-side/admin diagnostics, the tagging worker rejects missing secrets, and API responses do not include raw Cookie markers such as `MUSIC_U`, `MUSIC_A`, `__csrf`, `local-dev:`, `encryptedCookie`, or `rawCookie`.

Manual browser smoke checks:

```text
/
/admin
/admin/cookie-test
/api/login/diagnostics
/api/default-queue
/api/recommendations
/api/tags/queue
/api/workers/tagging
```

## Raw Cookie Safety

Raw Cookie data is private credential material. Deployment acceptance requires:

- C side does not show Cookie, encrypted Cookie summaries, queue internals, or profile internals.
- B side may accept pasted Cookie input and show safe diagnostics, but copied Cookie values are not echoed into separate preview text.
- API responses never include raw Cookie.
- Logs and docs do not contain real Cookie values.
- User-scoped Cookie storage is validated with multi-user tests before opening access beyond a private prototype.
