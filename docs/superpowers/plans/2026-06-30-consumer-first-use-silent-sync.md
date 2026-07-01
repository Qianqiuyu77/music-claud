# Consumer First-Use Silent Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a new C-side user open `/`, complete QR login, and have the app silently sync enough music to enter playback without exposing admin/debug state.

**Architecture:** Keep `Workbench` as the shared compatibility component, but add a C-side-only `silentSyncOnFirstUse` capability enabled by `ConsumerMusicApp`. Admin mode keeps manual sync behavior. The silent sync runs once when login is authorized and the stored library is empty, then loads the default queue as soon as sync reports usable songs.

**Tech Stack:** Next.js App Router, React client components, TypeScript, Vitest, React Testing Library, existing `/api/login/qr`, `/api/login/status`, `/api/library`, `/api/sync`, and `/api/default-queue` endpoints.

---

## File Responsibilities

- `src/components/player/ConsumerMusicApp.tsx`
  - Enables C-side first-use behavior by rendering `Workbench` with a consumer-only prop.

- `src/components/admin/AdminMusicApp.tsx`
  - Remains unchanged and renders `Workbench mode="admin"`.

- `src/components/workbench/Workbench.tsx`
  - Owns login, library status, sync, recommendation, and default queue state.
  - Adds a guarded silent sync path for player mode only.

- `tests/unit/workbench.test.tsx`
  - Adds regression coverage for C-side silent sync and admin non-auto-sync behavior.

---

## Task 1: Add Failing Test For Consumer Silent Sync

**Files:**

- Modify: `tests/unit/workbench.test.tsx`

- [ ] **Step 1: Write the failing test**

Add a test inside `describe("Workbench", () => { ... })`:

```tsx
it("silently syncs once for a first-use consumer after login is authorized and the local library is empty", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "/api/login/qr") {
      return new Response(JSON.stringify({ key: "cookie-login", qrUrl: "", source: "cookie" }));
    }
    if (url === "/api/library") {
      return new Response(JSON.stringify({ counts: { songs: 0, playableSongs: 0, partialFailures: 0 } }));
    }
    if (url === "/api/sync") {
      return new Response(JSON.stringify({ counts: { songs: 18, playableSongs: 16, imported: 18, partialFailures: 0 }, partialFailures: [] }));
    }
    if (url === "/api/default-queue?limit=12") {
      return new Response(JSON.stringify(defaultLikedResult));
    }
    return new Response(JSON.stringify({ ok: true }));
  });

  render(<Workbench silentSyncOnFirstUse />);

  expect(await screen.findByText("榛樿鍠滄姝屾洸 A")).toBeInTheDocument();
  expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/sync")).toHaveLength(1);
  expect(fetchMock).toHaveBeenCalledWith("/api/sync", { method: "POST" });
  expect(fetchMock).toHaveBeenCalledWith("/api/default-queue?limit=12");
  expect(screen.queryByText("18 棣?)).not.toBeInTheDocument();

  fetchMock.mockRestore();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/unit/workbench.test.tsx -t "silently syncs once"
```

Expected: fail because `silentSyncOnFirstUse` is not a valid prop and/or `/api/sync` is not called.

---

## Task 2: Add Failing Test For Admin Non-Auto-Sync

**Files:**

- Modify: `tests/unit/workbench.test.tsx`

- [ ] **Step 1: Write the failing test**

Add a test inside `describe("Workbench", () => { ... })`:

```tsx
it("does not run silent first-use sync in admin mode when the library is empty", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "/api/login/qr") {
      return new Response(JSON.stringify({ key: "cookie-login", qrUrl: "", source: "cookie" }));
    }
    if (url === "/api/library") {
      return new Response(JSON.stringify({ counts: { songs: 0, playableSongs: 0, partialFailures: 0 } }));
    }
    return new Response(JSON.stringify({ ok: true }));
  });

  render(<Workbench mode="admin" silentSyncOnFirstUse />);

  expect(await screen.findByText("缃戞槗浜戝凡杩炴帴")).toBeInTheDocument();
  expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/sync")).toHaveLength(0);

  fetchMock.mockRestore();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/unit/workbench.test.tsx -t "does not run silent first-use sync"
```

Expected: fail until the prop is added and admin guard exists.

---

## Task 3: Implement Minimal Silent Sync Support

**Files:**

- Modify: `src/components/workbench/Workbench.tsx`
- Modify: `src/components/player/ConsumerMusicApp.tsx`

- [ ] **Step 1: Extend props**

Change:

```tsx
type WorkbenchProps = {
  mode?: "player" | "admin";
};
```

To:

```tsx
type WorkbenchProps = {
  mode?: "player" | "admin";
  silentSyncOnFirstUse?: boolean;
};
```

Change:

```tsx
export function Workbench({ mode = "player" }: WorkbenchProps) {
```

To:

```tsx
export function Workbench({ mode = "player", silentSyncOnFirstUse = false }: WorkbenchProps) {
```

- [ ] **Step 2: Enable the prop in consumer shell**

Change `src/components/player/ConsumerMusicApp.tsx`:

```tsx
export function ConsumerMusicApp() {
  return <Workbench silentSyncOnFirstUse />;
}
```

- [ ] **Step 3: Add refs to prevent double sync and stale work**

Near `resultRef`, add:

```tsx
const silentSyncAttemptedRef = useRef(false);
```

- [ ] **Step 4: Add the silent sync function**

Inside `Workbench`, add:

```tsx
async function runSilentFirstUseSync(active: boolean) {
  if (silentSyncAttemptedRef.current) return;
  silentSyncAttemptedRef.current = true;
  try {
    const response = await fetch("/api/sync", { method: "POST" });
    if (!response.ok) return;
    const data = (await response.json()) as {
      counts: { songs: number; playableSongs?: number; imported?: number; lastSyncAt?: string | null; partialFailures: number };
      partialFailures?: string[];
    };
    if (!active) return;
    setSyncCounts(data.counts);
    if (data.counts.songs > 0) {
      await loadDefaultQueue(active);
    }
  } catch {
    // Keep first-use sync quiet on the C side; users can still request recommendations manually.
  }
}
```

- [ ] **Step 5: Call it from library loading**

In the `/api/library` effect, after `setSyncCounts(data.counts);`, use:

```tsx
if (mode === "player" && data.counts.songs > 0) {
  void loadDefaultQueue(active);
  return;
}
if (mode === "player" && silentSyncOnFirstUse && loginAuthorized && data.counts.songs === 0) {
  void runSilentFirstUseSync(active);
}
```

Because `loginAuthorized` changes after login fetch, add it to the effect dependencies:

```tsx
}, [mode, silentSyncOnFirstUse, loginAuthorized]);
```

The ref prevents duplicate sync attempts when the effect reruns.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- tests/unit/workbench.test.tsx -t "silent|first-use|local library"
```

Expected: relevant tests pass.

---

## Task 4: Verify Shell Wiring

**Files:**

- Test: `tests/unit/app-shells.test.tsx`

- [ ] **Step 1: Run shell tests**

Run:

```bash
npm test -- tests/unit/app-shells.test.tsx
```

Expected: pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: pass.

---

## Task 5: Phase Verification

**Files:**

- Test: `tests/unit/workbench.test.tsx`
- Test: `tests/unit/app-shells.test.tsx`
- Test: `tests/unit/cookie-test-page.test.tsx`

- [ ] **Step 1: Run final focused unit tests**

Run:

```bash
npm test -- tests/unit/workbench.test.tsx tests/unit/app-shells.test.tsx tests/unit/cookie-test-page.test.tsx
```

Expected: pass.

- [ ] **Step 2: Run route smoke if dev server is running**

Run:

```bash
node -e "Promise.all(['http://localhost:3000/','http://localhost:3000/admin','http://localhost:3000/admin/cookie-test'].map(async u=>{const r=await fetch(u); console.log(u,r.status)})).catch(e=>{console.error(e); process.exit(1)})"
```

Expected:

```text
http://localhost:3000/ 200
http://localhost:3000/admin 200
http://localhost:3000/admin/cookie-test 200
```

If no dev server is running, skip route smoke and state that it was not run.

---

## Acceptance Checklist

- [ ] `ConsumerMusicApp` enables silent first-use sync.
- [ ] Admin mode does not auto-sync.
- [ ] Silent sync runs once when login is authorized and library is empty.
- [ ] Default queue loads after silent sync reports songs.
- [ ] Existing local library still loads default queue without calling `/api/sync`.
- [ ] C side does not expose admin controls or sync details.
- [ ] Focused unit tests pass.
- [ ] Typecheck passes.
