# Private Server Deployment Runbook

This runbook turns a verified local release into a private single-server deployment. It assumes one Linux host, Node.js, npm, SQLite, systemd, Nginx, and HTTPS certificates. Keep the C side quiet for normal users and keep B-side diagnostics owner-only.

Replace `music.example.com`, `/srv/ai-music`, and the Linux user names before running commands on a real server.

## 1. Prepare Server Directories

Create the service user and persistent directories:

```bash
sudo useradd --system --create-home --home-dir /srv/ai-music --shell /usr/sbin/nologin ai-music
sudo mkdir -p /srv/ai-music/app /srv/ai-music/data /srv/ai-music/backups
sudo chown -R ai-music:ai-music /srv/ai-music
sudo chmod 750 /srv/ai-music /srv/ai-music/app /srv/ai-music/data /srv/ai-music/backups
```

Deploy the app source or build artifact into `/srv/ai-music/app`. Do not copy `.env.local` from a developer machine.

## 2. Configure Server Environment

Install the example environment file as a server-only file:

```bash
sudo install -m 600 docs/deploy/production.env.example /srv/ai-music/.env
sudo chown ai-music:ai-music /srv/ai-music/.env
sudo editor /srv/ai-music/.env
```

In `/srv/ai-music/.env`, replace every placeholder:

```bash
NODE_ENV=production
APP_BASE_URL=https://music.example.com
PORT=3000
HOSTNAME=127.0.0.1
MUSIC_DB_PATH=/srv/ai-music/data/music.sqlite
MUSIC_DB_BACKUP_DIR=/srv/ai-music/backups
DEEPSEEK_API_KEY=replace-with-server-secret
NETEASE_USE_REAL_LOGIN=1
NETEASE_DEVICE_ID=replace-with-stable-device-id
AI_MUSIC_SESSION_SECRET=replace-with-32-plus-char-session-secret
AI_MUSIC_INVITE_CODES=alpha-private,beta-private
TAGGING_WORKER_SECRET=replace-with-long-random-secret
```

Do not paste raw NetEase Cookie values into this file for normal production users. Leave `NETEASE_COOKIE` unset unless you intentionally need an owner-only bootstrap credential.

Safety checks before continuing:

- `APP_BASE_URL` must be the final HTTPS origin.
- `MUSIC_DB_PATH` must be persistent and must not be `:memory:`.
- `AI_MUSIC_SESSION_SECRET` must be a stable private signing key of at least 32 characters. Changing it signs out existing browser sessions.
- `AI_MUSIC_INVITE_CODES` must contain private invite codes, not `owner-code` or `friend-code`.
- `TAGGING_WORKER_SECRET` must be a long private value.
- The filled environment file must stay out of git, logs, screenshots, and chat messages.

## 2.1 Understand The Runtime Layout

The app runs as one Next.js process:

- Frontend: `/` is the C-side listening product, `/admin` and `/admin/cookie-test` are B-side owner tools.
- Backend: all server APIs live under `/api/*` in the same `next start` process.
- Database: SQLite is stored at `MUSIC_DB_PATH`; public song metadata is shared, while user login state, sources, feedback, playback, recommendations, and profiles are user-private.
- Login: a new C-side browser gets an anonymous signed `ai_music_user` session, scans NetEase QR, and stores that user's encrypted NetEase Cookie in SQLite.
- Background work: the tagging worker is a systemd timer that calls `/api/workers/tagging` with `TAGGING_WORKER_SECRET`.

Run one app instance per SQLite database. Do not scale this deployment horizontally until SQLite is replaced by a multi-writer database.

## 3. Install And Verify The App

Run dependency install and release checks as the service user:

```bash
cd /srv/ai-music/app
sudo -u ai-music npm ci
sudo -u ai-music bash -lc 'set -a; . /srv/ai-music/.env; set +a; npm run release:check'
```

If your shell or environment contains spaces or special characters, load `/srv/ai-music/.env` with the server's process manager or a dedicated secret manager.

The release gate must finish these checks:

- `npm test`
- `npm run typecheck`
- `npm run deploy:check-env`
- `npm run build`
- `npm run db:check`

Create an explicit backup before first start when an existing database is present:

```bash
sudo -u ai-music bash -lc 'set -a; . /srv/ai-music/.env; set +a; npm run db:backup'
```

## 4. Enable The Web Service

Copy and adapt the systemd service:

```bash
sudo cp docs/deploy/ai-music.service /etc/systemd/system/ai-music.service
sudo systemctl daemon-reload
sudo systemctl enable --now ai-music.service
sudo systemctl status ai-music.service --no-pager
```

Confirm the app listens only on the local interface:

```bash
curl -I http://127.0.0.1:3000/
```

Do not expose `127.0.0.1:3000` directly to the public internet. Nginx should be the public HTTPS entry point.

## 5. Enable HTTPS Reverse Proxy

Copy and adapt the Nginx site:

```bash
sudo cp docs/deploy/nginx-ai-music.conf /etc/nginx/sites-available/ai-music.conf
sudo editor /etc/nginx/sites-available/ai-music.conf
sudo ln -s /etc/nginx/sites-available/ai-music.conf /etc/nginx/sites-enabled/ai-music.conf
sudo nginx -t
sudo systemctl reload nginx
```

Confirm the HTTPS origin responds:

```bash
curl -I https://music.example.com/
```

Production sessions rely on HTTPS because the browser session cookie is `Secure` when `NODE_ENV=production`.

If you do not have certificates yet, install Certbot and issue one before enabling the 443 server block:

```bash
sudo certbot certonly --nginx -d music.example.com
```

## 6. Run Post-Deploy Smoke

From the deployed app directory, run:

```bash
cd /srv/ai-music/app
sudo -u ai-music env APP_BASE_URL=https://music.example.com npm run smoke:production
```

The smoke check must verify:

- C-side `/` responds.
- Login state and QR APIs respond without raw credential leakage.
- Admin diagnostics reject an unknown or non-owner session.
- The worker endpoint rejects missing secrets.
- Responses do not contain `MUSIC_U`, `MUSIC_A`, `__csrf`, `NMTID`, `local-dev:`, `rawCookie`, or `encryptedCookie`.

If any smoke check fails, stop before inviting users:

```bash
sudo systemctl stop ai-music.service
```

## 7. Enable Background Tagging

Run one manual worker pass before scheduling it:

```bash
cd /srv/ai-music/app
sudo -u ai-music env APP_BASE_URL=https://music.example.com TAGGING_WORKER_SECRET=replace-with-long-random-secret npm run worker:tagging
```

After the manual pass succeeds, install and enable the timer:

```bash
sudo cp docs/deploy/ai-music-tagging-worker.service /etc/systemd/system/ai-music-tagging-worker.service
sudo cp docs/deploy/ai-music-tagging-worker.timer /etc/systemd/system/ai-music-tagging-worker.timer
sudo systemctl daemon-reload
sudo systemctl enable --now ai-music-tagging-worker.timer
sudo systemctl list-timers ai-music-tagging-worker.timer --no-pager
```

The worker fills public AI tags in the background. C-side users should not see tag queue state, retry details, or sync internals.

## 8. Manual Product Smoke

Use a browser and one owner invite code plus one non-owner invite code:

- New C-side user opens `/`, scans the NetEase QR code, and reaches playback after silent sync.
- Refreshing the same browser keeps the same signed session and does not create a new private user.
- Opening `/` in a fresh browser profile creates a separate private user and does not see the first user's library.
- Existing C-side user opens `/` and sees the listening product without admin wording.
- Expired Cookie asks the user to scan again without exposing credential details.
- Owner opens `/admin` and can see diagnostics, profile health, tag queue, and Cookie test tools.
- A forged raw cookie like `ai_music_user=1` receives 404 for admin surfaces; only signed owner sessions may access B-side tools.
- An unknown or non-owner session receives 404 for `/admin`, `/api/login/diagnostics`, `/api/tags/queue`, and `/api/profiles/status`.
- Public song tags are reused across users, while Cookie, playback, feedback, recommendations, profiles, and companion state remain user-private.
- Rendered pages and API responses do not show `MUSIC_U`, `MUSIC_A`, `__csrf`, `NMTID`, `local-dev:`, `rawCookie`, or `encryptedCookie`.

## 9. Daily Operations

Useful commands on the server:

```bash
sudo systemctl status ai-music.service --no-pager
sudo journalctl -u ai-music.service -n 200 --no-pager
sudo systemctl list-timers ai-music-tagging-worker.timer --no-pager
sudo journalctl -u ai-music-tagging-worker.service -n 100 --no-pager
cd /srv/ai-music/app && sudo -u ai-music bash -lc 'set -a; . /srv/ai-music/.env; set +a; npm run db:backup'
cd /srv/ai-music/app && sudo -u ai-music bash -lc 'set -a; . /srv/ai-music/.env; set +a; npm run db:check'
```

Before every app update:

```bash
sudo systemctl stop ai-music-tagging-worker.timer
cd /srv/ai-music/app
sudo -u ai-music bash -lc 'set -a; . /srv/ai-music/.env; set +a; npm run db:backup'
sudo -u ai-music git pull --ff-only
sudo -u ai-music npm ci
sudo -u ai-music bash -lc 'set -a; . /srv/ai-music/.env; set +a; npm run release:check'
sudo systemctl restart ai-music.service
sudo systemctl start ai-music-tagging-worker.timer
sudo -u ai-music env APP_BASE_URL=https://music.example.com npm run smoke:production
```

Record the deployment origin, database path, backup path, worker timer interval, invite-code policy, and smoke result in the master plan after the first successful deployment.

## Rollback

Stop services before replacing the app or database:

```bash
sudo systemctl stop ai-music-tagging-worker.timer
sudo systemctl stop ai-music.service
```

Restore the previous app release or copy a selected SQLite backup over `MUSIC_DB_PATH`:

```bash
sudo -u ai-music cp /srv/ai-music/backups/music.sqlite.2026-06-30T00-00-00-000Z.bak /srv/ai-music/data/music.sqlite
sudo systemctl start ai-music.service
sudo systemctl start ai-music-tagging-worker.timer
```

Run smoke again after rollback:

```bash
cd /srv/ai-music/app
sudo -u ai-music env APP_BASE_URL=https://music.example.com npm run smoke:production
```
