# Multi-User Data Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first deployable multi-user data boundary so public song knowledge can be shared while login state, sources, playback, feedback, and recommendation history are private per user.

**Architecture:** Introduce an application-level current user and new user-private tables while keeping the existing single-user local flow working through a default owner user. Public `songs` rows remain shared by `netease_song_id`; private meaning moves into user-scoped source/event/session/login tables. Each repository method that reads or writes private data must accept or resolve a `userId`.

**Tech Stack:** Next.js App Router, TypeScript, SQLite, existing `AppDatabase` wrapper, `MusicRepository`, `RecommendationRepository`, `appServices`, Vitest repository and API contract tests.

---

## Current State

The current schema already has a `users` table, but it is not enough for isolation:

- `users.encrypted_cookie` mixes login credentials into a user profile row.
- `songs.sources_json` stores private source meaning on public song rows.
- `songs.recent_play_count` and `songs.days_since_last_played` are public columns but represent private behavior.
- `song_events` has no `user_id`.
- `recommendation_sessions` and `recommendation_items` have no `user_id`.
- `library_syncs` has no `user_id`.
- App services use global `process.env.NETEASE_COOKIE`.

Phase 4 must keep existing local use working while moving toward user-scoped storage.

---

## File Responsibilities

- `src/lib/db/schema.ts`
  - Adds user-private tables and compatibility migrations.
  - Ensures a default owner user exists for local single-user mode.

- `src/lib/db/types.ts`
  - Adds typed inputs for user context, user song sources, login state, and user events.

- `src/lib/user/currentUser.ts`
  - Resolves the current app user.
  - First implementation uses a default owner user in local mode.
  - Later implementation can read invite/session cookies.

- `src/lib/repositories/userRepository.ts`
  - Creates or reads users.
  - Reads/writes user login states.

- `src/lib/repositories/musicRepository.ts`
  - Keeps `songs` public.
  - Adds user-scoped source/event/feedback/playback methods.
  - Keeps old methods as owner-user compatibility wrappers only during migration.

- `src/lib/repositories/recommendationRepository.ts`
  - Adds `userId` to sessions and reads sessions by user.

- `src/lib/appServices.ts`
  - Resolves the current user before private reads/writes.
  - Persists QR/manual Cookie to user login state when available.

- `tests/unit/repositories.test.ts`
  - Proves isolation rules.

- `tests/unit/api-contracts.test.ts`
  - Proves app services do not leak private behavior across users.

---

## Phase 4 Execution Slices

Do not try to complete every isolation rule in one edit. Execute in these slices:

1. Default owner user and private schema foundation.
2. User-scoped song sources and feedback/playback events.
3. User-scoped recommendation sessions.
4. User-scoped login state.
5. API/request current-user resolution.

Slices 1 and 2 are the minimum useful implementation checkpoint.

---

## Task 1: Default Owner User And Private Schema Foundation

**Files:**

- Modify: `src/lib/db/schema.ts`
- Create: `src/lib/user/currentUser.ts`
- Create: `src/lib/repositories/userRepository.ts`
- Modify: `tests/unit/repositories.test.ts`

- [ ] **Step 1: Write failing schema test**

Add this test to `tests/unit/repositories.test.ts`:

```ts
it("creates a default owner user and user-private isolation tables", async () => {
  const db = await createDatabase(":memory:");
  migrate(db);

  const user = db.prepare("SELECT * FROM users WHERE id = 1").get() as { id: number; handle: string } | undefined;
  const privateTables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('user_login_states','user_song_sources','user_song_events')")
    .all() as Array<{ name: string }>;

  expect(user).toEqual(expect.objectContaining({ id: 1, handle: "owner" }));
  expect(privateTables.map((row) => row.name).sort()).toEqual(["user_login_states", "user_song_events", "user_song_sources"]);
});
```

- [ ] **Step 2: Verify it fails**

Run:

```bash
npm test -- tests/unit/repositories.test.ts -t "default owner user"
```

Expected: fail because `users.handle` and the private tables do not exist.

- [ ] **Step 3: Extend schema**

Modify `src/lib/db/schema.ts`:

```sql
ALTER TABLE users ADD COLUMN handle TEXT;
```

Because SQLite cannot add a unique constraint with `ALTER TABLE`, add an index:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_handle ON users(handle);
```

Add tables:

```sql
CREATE TABLE IF NOT EXISTS user_login_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  encrypted_cookie TEXT NOT NULL,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  last_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, provider)
);

CREATE TABLE IF NOT EXISTS user_song_sources (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, song_id, source)
);

CREATE TABLE IF NOT EXISTS user_song_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  context_text TEXT,
  weight REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

After table creation, seed owner user:

```sql
INSERT OR IGNORE INTO users (id, handle, nickname)
VALUES (1, 'owner', 'Owner');
```

- [ ] **Step 4: Run schema test**

Run:

```bash
npm test -- tests/unit/repositories.test.ts -t "default owner user"
```

Expected: pass.

---

## Task 2: User Repository And Current User Resolver

**Files:**

- Create: `src/lib/repositories/userRepository.ts`
- Create: `src/lib/user/currentUser.ts`
- Modify: `tests/unit/repositories.test.ts`

- [ ] **Step 1: Write failing repository test**

Add this test:

```ts
import { UserRepository } from "@/lib/repositories/userRepository";

it("resolves the default owner user without exposing login credentials", async () => {
  const db = await createDatabase(":memory:");
  migrate(db);
  const users = new UserRepository(db);

  const owner = users.getDefaultOwner();
  users.saveLoginState({
    userId: owner.id,
    provider: "netease",
    encryptedCookie: "local-dev:secret",
    status: "active",
    source: "qr"
  });

  expect(owner).toEqual({ id: 1, handle: "owner", nickname: "Owner" });
  expect(users.getLoginState(owner.id, "netease")).toEqual(
    expect.objectContaining({
      userId: owner.id,
      provider: "netease",
      encryptedCookie: "local-dev:secret",
      status: "active",
      source: "qr"
    })
  );
});
```

- [ ] **Step 2: Verify it fails**

Run:

```bash
npm test -- tests/unit/repositories.test.ts -t "default owner user without exposing login credentials"
```

Expected: fail because `UserRepository` does not exist.

- [ ] **Step 3: Implement `UserRepository`**

Create `src/lib/repositories/userRepository.ts`:

```ts
import type { AppDatabase, BindParams } from "@/lib/db/client";

export type AppUser = {
  id: number;
  handle: string;
  nickname: string | null;
};

export type UserLoginStateInput = {
  userId: number;
  provider: "netease";
  encryptedCookie: string;
  status: "active" | "expired" | "revoked";
  source: "cookie" | "qr";
};

export class UserRepository {
  constructor(private readonly db: AppDatabase) {}

  getDefaultOwner(): AppUser {
    const row = this.getFirst<{ id: number; handle: string | null; nickname: string | null }>(
      "SELECT id, handle, nickname FROM users WHERE id = 1"
    );
    if (!row) throw new Error("Default owner user is missing");
    return { id: row.id, handle: row.handle ?? "owner", nickname: row.nickname };
  }

  saveLoginState(input: UserLoginStateInput) {
    this.db.run(
      `
        INSERT INTO user_login_states (user_id, provider, encrypted_cookie, status, source, last_verified_at)
        VALUES ($userId, $provider, $encryptedCookie, $status, $source, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, provider) DO UPDATE SET
          encrypted_cookie = excluded.encrypted_cookie,
          status = excluded.status,
          source = excluded.source,
          last_verified_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      `,
      {
        $userId: input.userId,
        $provider: input.provider,
        $encryptedCookie: input.encryptedCookie,
        $status: input.status,
        $source: input.source
      }
    );
  }

  getLoginState(userId: number, provider: "netease") {
    const row = this.getFirst<{
      user_id: number;
      provider: "netease";
      encrypted_cookie: string;
      status: "active" | "expired" | "revoked";
      source: "cookie" | "qr";
      last_verified_at: string | null;
    }>(
      "SELECT user_id, provider, encrypted_cookie, status, source, last_verified_at FROM user_login_states WHERE user_id = $userId AND provider = $provider",
      { $userId: userId, $provider: provider }
    );
    if (!row) return null;
    return {
      userId: row.user_id,
      provider: row.provider,
      encryptedCookie: row.encrypted_cookie,
      status: row.status,
      source: row.source,
      lastVerifiedAt: row.last_verified_at
    };
  }

  private getFirst<T>(sql: string, params?: BindParams): T | undefined {
    const stmt = this.db.prepare(sql);
    return stmt.get(params ?? {}) as T | undefined;
  }
}
```

- [ ] **Step 4: Implement current user resolver**

Create `src/lib/user/currentUser.ts`:

```ts
import { UserRepository, type AppUser } from "@/lib/repositories/userRepository";
import type { AppDatabase } from "@/lib/db/client";

export function getDefaultCurrentUser(db: AppDatabase): AppUser {
  return new UserRepository(db).getDefaultOwner();
}
```

- [ ] **Step 5: Run repository test**

Run:

```bash
npm test -- tests/unit/repositories.test.ts -t "default owner user without exposing login credentials"
```

Expected: pass.

---

## Task 3: User-Scoped Song Sources And Events

**Files:**

- Modify: `src/lib/repositories/musicRepository.ts`
- Modify: `tests/unit/repositories.test.ts`

- [ ] **Step 1: Write failing isolation test**

Add this test:

```ts
it("shares public song rows while isolating sources, feedback, and playback by user", async () => {
  const db = await createDatabase(":memory:");
  migrate(db);
  const music = new MusicRepository(db);

  db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");

  const songId = music.upsertCandidateSong({
    neteaseSongId: "shared-song-1",
    name: "Shared Song",
    artistNames: ["Shared Artist"],
    artistIds: [],
    albumName: "Shared Album",
    coverUrl: null,
    streamUrl: "https://music.example/shared.mp3",
    durationMs: 180000,
    popularity: 80,
    sources: [],
    tags: ["ai:tagged", "ai:mood:calm"],
    recentPlayCount: 0,
    daysSinceLastPlayed: null,
    feedback: []
  });

  music.addUserSongSource({ userId: 1, songId, source: "liked" });
  music.addUserSongSource({ userId: 2, songId, source: "playlist" });
  music.recordFeedbackByNeteaseSongIdForUser(1, "shared-song-1", "like");
  music.recordPlaybackByNeteaseSongIdForUser(2, "shared-song-1", {
    playedSeconds: 90,
    durationSeconds: 180,
    completed: false
  });

  expect(music.listCandidateSongsForUser(1)[0]).toEqual(expect.objectContaining({ sources: ["liked"], feedback: ["like"] }));
  expect(music.listCandidateSongsForUser(2)[0]).toEqual(expect.objectContaining({ sources: ["playlist"], feedback: [] }));
  expect(music.listLatestPlaybackByNeteaseSongIdsForUser(1, ["shared-song-1"]).has("shared-song-1")).toBe(false);
  expect(music.listLatestPlaybackByNeteaseSongIdsForUser(2, ["shared-song-1"]).has("shared-song-1")).toBe(true);
  expect(music.listSongs()).toHaveLength(1);
});
```

- [ ] **Step 2: Verify it fails**

Run:

```bash
npm test -- tests/unit/repositories.test.ts -t "shares public song rows"
```

Expected: fail because user-scoped methods do not exist.

- [ ] **Step 3: Add user source/event methods**

Modify `MusicRepository`:

```ts
addUserSongSource(input: { userId: number; songId: number; source: string }) {
  this.db.run(
    `
      INSERT OR IGNORE INTO user_song_sources (user_id, song_id, source)
      VALUES ($userId, $songId, $source)
    `,
    { $userId: input.userId, $songId: input.songId, $source: input.source }
  );
}

addUserSongEvent(input: SongEventInput & { userId: number }) {
  this.db.run(
    `
      INSERT INTO user_song_events (user_id, song_id, event_type, source, context_text, weight)
      VALUES ($userId, $songId, $eventType, $source, $contextText, $weight)
    `,
    {
      $userId: input.userId,
      $songId: input.songId,
      $eventType: input.eventType,
      $source: input.source,
      $contextText: input.contextText,
      $weight: input.weight
    }
  );
  return this.getFirst<{ id: number }>("SELECT last_insert_rowid() AS id")?.id ?? 0;
}
```

- [ ] **Step 4: Add user candidate/read methods**

Add:

```ts
listCandidateSongsForUser(userId: number): CandidateSong[] {
  const rows = this.listSongs();
  const sourcesBySongId = this.userSourcesBySongId(userId);
  const feedbackBySongId = this.userFeedbackBySongId(userId);
  return rows
    .map((row) => ({
      neteaseSongId: row.netease_song_id,
      name: row.name,
      artistNames: row.artist_names ? row.artist_names.split(", ").filter(Boolean) : [],
      artistIds: parseJsonArray(row.artist_ids_json) as string[],
      albumName: row.album_name,
      coverUrl: row.cover_url,
      streamUrl: row.stream_url,
      durationMs: row.duration_ms,
      popularity: row.popularity,
      sources: normalizeSources(sourcesBySongId.get(row.id) ?? []),
      tags: parseJsonArray(row.tags_json) as string[],
      recentPlayCount: row.recent_play_count,
      daysSinceLastPlayed: row.days_since_last_played,
      feedback: feedbackBySongId.get(row.id) ?? []
    }))
    .filter((song) => song.sources.length > 0);
}
```

Add private helpers:

```ts
private userSourcesBySongId(userId: number) {
  const rows = this.getAll<{ song_id: number; source: string }>(
    "SELECT song_id, source FROM user_song_sources WHERE user_id = $userId ORDER BY source",
    { $userId: userId }
  );
  const bySongId = new Map<number, string[]>();
  for (const row of rows) bySongId.set(row.song_id, unique([...(bySongId.get(row.song_id) ?? []), row.source]));
  return bySongId;
}

private userFeedbackBySongId(userId: number) {
  const rows = this.getAll<FeedbackRow>(
    "SELECT song_id, context_text FROM user_song_events WHERE user_id = $userId AND event_type = 'feedback' AND context_text IS NOT NULL ORDER BY id",
    { $userId: userId }
  );
  const bySongId = new Map<number, Feedback[]>();
  for (const row of rows) {
    if (!isFeedback(row.context_text)) continue;
    bySongId.set(row.song_id, unique([...(bySongId.get(row.song_id) ?? []), row.context_text]));
  }
  return bySongId;
}
```

- [ ] **Step 5: Add user feedback/playback methods**

Add:

```ts
recordFeedbackByNeteaseSongIdForUser(userId: number, neteaseSongId: string, feedback: Feedback) {
  const row = this.getFirst<{ id: number }>("SELECT id FROM songs WHERE netease_song_id = $id", { $id: neteaseSongId });
  if (!row) return null;
  this.addUserSongEvent({
    userId,
    songId: row.id,
    eventType: "feedback",
    source: "local",
    contextText: feedback,
    weight: feedback === "dislike" || feedback === "too_familiar" ? -1 : 1
  });
  return { itemId: neteaseSongId, feedback };
}

recordPlaybackByNeteaseSongIdForUser(userId: number, neteaseSongId: string, playback: { playedSeconds: number; durationSeconds: number | null; completed: boolean }) {
  const row = this.getFirst<{ id: number }>("SELECT id FROM songs WHERE netease_song_id = $id", { $id: neteaseSongId });
  if (!row) return null;
  this.addUserSongEvent({
    userId,
    songId: row.id,
    eventType: "played",
    source: "local",
    contextText: JSON.stringify(playback),
    weight: playback.completed ? 1 : 0.5
  });
  return { itemId: neteaseSongId, playback };
}
```

- [ ] **Step 6: Add user latest playback method**

Add:

```ts
listLatestPlaybackByNeteaseSongIdsForUser(userId: number, neteaseSongIds: string[]) {
  const ids = unique(neteaseSongIds.filter(Boolean));
  const result = new Map<string, LatestPlayback>();
  if (!ids.length) return result;
  const placeholders = ids.map((_, index) => `$id${index}`).join(", ");
  const params = Object.fromEntries(ids.map((id, index) => [`$id${index}`, id]));
  const rows = this.getAll<PlaybackRow>(
    `
      SELECT s.netease_song_id, e.context_text, e.created_at
      FROM user_song_events e
      JOIN songs s ON s.id = e.song_id
      WHERE e.user_id = $userId
        AND e.event_type = 'played'
        AND s.netease_song_id IN (${placeholders})
      ORDER BY e.created_at DESC, e.id DESC
    `,
    { ...params, $userId: userId }
  );
  for (const row of rows) {
    if (result.has(row.netease_song_id)) continue;
    const parsed = parsePlaybackContext(row.context_text);
    result.set(row.netease_song_id, { itemId: row.netease_song_id, ...parsed, createdAt: row.created_at });
  }
  return result;
}
```

- [ ] **Step 7: Run isolation test**

Run:

```bash
npm test -- tests/unit/repositories.test.ts -t "shares public song rows"
```

Expected: pass.

---

## Task 4: Recommendation Sessions Scoped By User

**Files:**

- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/repositories/recommendationRepository.ts`
- Modify: `tests/unit/repositories.test.ts`

- [ ] **Step 1: Write failing recommendation isolation test**

Add:

```ts
it("stores recommendation sessions per user", async () => {
  const db = await createDatabase(":memory:");
  migrate(db);
  const recs = new RecommendationRepository(db);

  db.run("INSERT INTO users (id, handle, nickname) VALUES (2, 'friend', 'Friend')");

  const ownerSession = recs.createSessionForUser(1, {
    prompt: "owner prompt",
    parsedContext: { scene: "work" },
    strategy: { novelty: "balanced" }
  });
  const friendSession = recs.createSessionForUser(2, {
    prompt: "friend prompt",
    parsedContext: { scene: "night" },
    strategy: { novelty: "explore" }
  });

  expect(recs.getSessionWithItemsForUser(1, ownerSession)).not.toBeNull();
  expect(recs.getSessionWithItemsForUser(1, friendSession)).toBeNull();
  expect(recs.getSessionWithItemsForUser(2, friendSession)).not.toBeNull();
});
```

- [ ] **Step 2: Verify it fails**

Run:

```bash
npm test -- tests/unit/repositories.test.ts -t "recommendation sessions per user"
```

Expected: fail because methods and schema do not exist.

- [ ] **Step 3: Add `user_id` schema**

In `recommendation_sessions`, add a compatibility migration:

```sql
ALTER TABLE recommendation_sessions ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
UPDATE recommendation_sessions SET user_id = 1 WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_recommendation_sessions_user_id ON recommendation_sessions(user_id);
```

Guard `ALTER TABLE` with a schema helper or try/catch pattern if the project already has one. Since `migrate` currently runs raw SQL, add a small helper outside the main SQL block:

```ts
addColumnIfMissing(db, "recommendation_sessions", "user_id", "INTEGER REFERENCES users(id) ON DELETE CASCADE");
```

- [ ] **Step 4: Implement user methods**

Add to `RecommendationRepository`:

```ts
createSessionForUser(userId: number, input: SessionInput): number {
  this.db.run(
    `
      INSERT INTO recommendation_sessions (user_id, prompt, parsed_context_json, strategy_json)
      VALUES ($userId, $prompt, $parsedContextJson, $strategyJson)
    `,
    {
      $userId: userId,
      $prompt: input.prompt,
      $parsedContextJson: JSON.stringify(input.parsedContext),
      $strategyJson: JSON.stringify(input.strategy)
    }
  );
  return this.lastInsertId();
}

getSessionWithItemsForUser(userId: number, sessionId: number) {
  const session = this.getFirst("SELECT * FROM recommendation_sessions WHERE id = $sessionId AND user_id = $userId", {
    $sessionId: sessionId,
    $userId: userId
  });
  if (!session) return null;
  const rows = this.getAll<ItemRow>("SELECT * FROM recommendation_items WHERE session_id = $sessionId ORDER BY rank", {
    $sessionId: sessionId
  });
  return {
    session,
    items: rows.map(rowToRecommendationItemRecord)
  };
}
```

Keep existing `createSession` as owner compatibility:

```ts
createSession(input: SessionInput): number {
  return this.createSessionForUser(1, input);
}
```

- [ ] **Step 5: Run recommendation repository tests**

Run:

```bash
npm test -- tests/unit/repositories.test.ts -t "recommendation sessions per user|stores songs"
```

Expected: pass.

---

## Task 5: App Service Owner Compatibility

**Files:**

- Modify: `src/lib/appServices.ts`
- Modify: `tests/unit/api-contracts.test.ts`

- [ ] **Step 1: Write failing app-service isolation test**

Add a focused test proving owner compatibility still works while using user-scoped APIs:

```ts
it("records playback in the default owner scope without making it public to another user", async () => {
  const originalDbPath = process.env.MUSIC_DB_PATH;
  process.env.MUSIC_DB_PATH = ":memory:";
  resetAppServicesForTests();

  try {
    const repository = await getMusicRepositoryForApp();
    repository.upsertCandidateSongs(longFixtureSongs);
    repository.recordSync("netease_import", longFixtureSongs.length, []);

    await recordSongPlayback({
      itemId: "long-fixture-1",
      playedSeconds: 190,
      durationSeconds: 190,
      completed: true
    });

    expect(repository.listLatestPlaybackByNeteaseSongIdsForUser(1, ["long-fixture-1"]).has("long-fixture-1")).toBe(true);
    expect(repository.listLatestPlaybackByNeteaseSongIdsForUser(2, ["long-fixture-1"]).has("long-fixture-1")).toBe(false);
  } finally {
    if (originalDbPath === undefined) delete process.env.MUSIC_DB_PATH;
    else process.env.MUSIC_DB_PATH = originalDbPath;
    resetAppServicesForTests();
  }
});
```

- [ ] **Step 2: Verify it fails**

Run:

```bash
npm test -- tests/unit/api-contracts.test.ts -t "records playback in the default owner scope"
```

Expected: fail until `recordSongPlayback` uses owner-scoped method.

- [ ] **Step 3: Update services to default owner user**

In `appServices.ts`, add:

```ts
import { getDefaultCurrentUser } from "@/lib/user/currentUser";
```

Then update private reads/writes:

```ts
const user = getDefaultCurrentUser(repository.db);
```

If `db` is private inside repository, add `getDefaultCurrentUserForRepository()` or expose a `getDefaultOwnerUserId()` helper through a `UserRepository` created where the database is available. Prefer a small service helper:

```ts
async function getDefaultOwnerUserId() {
  const repository = await getMusicRepositoryForApp();
  return 1;
}
```

For this slice, using constant `1` is acceptable because request-level user resolution is a later task.

Change:

```ts
repository.recordPlaybackByNeteaseSongId(input.itemId, ...)
```

To:

```ts
repository.recordPlaybackByNeteaseSongIdForUser(1, input.itemId, ...)
```

Change recommendation cooldown reads:

```ts
repository.listLatestPlaybackByNeteaseSongIds(...)
```

To:

```ts
repository.listLatestPlaybackByNeteaseSongIdsForUser(1, ...)
```

Change feedback:

```ts
repository.recordFeedbackByNeteaseSongId(itemId, feedback)
```

To:

```ts
repository.recordFeedbackByNeteaseSongIdForUser(1, itemId, feedback)
```

- [ ] **Step 4: Run app-service isolation test**

Run:

```bash
npm test -- tests/unit/api-contracts.test.ts -t "records playback in the default owner scope"
```

Expected: pass.

---

## Task 6: Verification Gate

**Files:**

- Test: `tests/unit/repositories.test.ts`
- Test: `tests/unit/api-contracts.test.ts`
- Test: `tests/unit/workbench.test.tsx`

- [ ] **Step 1: Run repository tests**

Run:

```bash
npm test -- tests/unit/repositories.test.ts
```

Expected: pass.

- [ ] **Step 2: Run API contract tests**

Run:

```bash
npm test -- tests/unit/api-contracts.test.ts
```

Expected: pass.

- [ ] **Step 3: Run Phase 3 regression tests**

Run:

```bash
npm test -- tests/unit/workbench.test.tsx tests/unit/app-shells.test.tsx tests/unit/cookie-test-page.test.tsx
```

Expected: pass.

- [ ] **Step 4: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: pass.

---

## Acceptance Checklist For This Phase Slice

- [ ] A default owner user exists after migration.
- [ ] Public `songs` rows are shared.
- [ ] User sources are stored outside `songs`.
- [ ] User feedback is stored outside global `song_events`.
- [ ] User playback is stored outside global `song_events`.
- [ ] User A feedback does not appear in User B candidate songs.
- [ ] User A playback cooldown does not affect User B.
- [ ] Recommendation sessions can be scoped to a user.
- [ ] Existing local single-user app still works through owner user `1`.

---

## Explicit Non-Goals For This Slice

- Do not implement full invite-code auth yet.
- Do not remove legacy columns from `songs` yet.
- Do not remove legacy `song_events` yet.
- Do not migrate raw Cookie fully out of `.env.local` yet.
- Do not switch SQLite to Postgres yet.

These are later Phase 4 tasks after the private data boundary is proven by tests.
