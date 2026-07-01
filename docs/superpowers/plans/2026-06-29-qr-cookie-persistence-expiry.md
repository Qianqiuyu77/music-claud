# QR Cookie Persistence and Expiry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make NetEase QR login persist a usable Cookie in single-user local mode and report invalid/expired Cookie state through diagnostics.

**Architecture:** Extend the NetEase provider QR status result to carry a server-internal raw Cookie when authorization succeeds. `appServices.getLoginStatusPreview()` validates and persists that Cookie through the same normalization path as manual Cookie saving, while API responses keep exposing only safe summaries.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, NetEase provider wrapper, existing `.env.local` single-user Cookie storage.

---

## File Structure

- Modify `src/lib/netease/types.ts`
  - Add `rawCookie?: string` to the provider login status contract for server-side use.

- Modify `src/lib/netease/cloudProvider.ts`
  - Return `rawCookie` alongside `encryptedCookie` when QR status code is `803`.

- Modify `src/lib/appServices.ts`
  - Add a reusable `persistNeteaseCookie(cookie, source)` helper.
  - Keep `saveNeteaseCookie()` behavior for manual Cookie input.
  - Update `getLoginStatusPreview(key, forceRealLogin)` to persist QR cookies when authorized.
  - Keep raw Cookie out of API responses.

- Modify tests:
  - `tests/unit/providers.test.ts`
  - `tests/unit/api-contracts.test.ts`
  - `tests/unit/cookie-test-page.test.tsx` only if UI expectations need wording changes.

---

### Task 1: Add Failing Tests for QR Cookie Persistence

**Files:**
- Modify: `tests/unit/providers.test.ts`
- Modify: `tests/unit/api-contracts.test.ts`

- [ ] **Step 1: Update provider QR test to expect rawCookie**

In `tests/unit/providers.test.ts`, update the QR login test expected status result to include raw cookie:

```ts
await expect(provider.getLoginStatus("qr-key-1")).resolves.toEqual({
  status: "authorized",
  encryptedCookie: expect.stringContaining("local-dev:"),
  rawCookie: "MUSIC_U=secret-cookie",
  source: "qr"
});
```

- [ ] **Step 2: Add app service test for forced QR persistence**

In `tests/unit/api-contracts.test.ts`, add a test near the existing login tests:

```ts
it("persists a Cookie returned by QR login status", async () => {
  const originalCookie = process.env.NETEASE_COOKIE;
  const originalRealLogin = process.env.NETEASE_USE_REAL_LOGIN;

  delete process.env.NETEASE_COOKIE;
  process.env.NETEASE_USE_REAL_LOGIN = "1";

  try {
    const status = await getLoginStatusPreview("qr-key-1", true);

    expect(status).toEqual(
      expect.objectContaining({
        status: "authorized",
        source: "qr",
        encryptedCookie: expect.stringContaining("local-dev:")
      })
    );
    expect(process.env.NETEASE_COOKIE).toContain("MUSIC_U=");
  } finally {
    if (originalCookie === undefined) {
      delete process.env.NETEASE_COOKIE;
    } else {
      process.env.NETEASE_COOKIE = originalCookie;
    }
    if (originalRealLogin === undefined) {
      delete process.env.NETEASE_USE_REAL_LOGIN;
    } else {
      process.env.NETEASE_USE_REAL_LOGIN = originalRealLogin;
    }
  }
});
```

If the existing service does not allow injecting a fake provider for QR status, adjust this test to target the route/provider layer already used in the file. Do not call the real NetEase network in unit tests.

- [ ] **Step 3: Run tests and confirm they fail**

Run:

```bash
npm test -- tests/unit/providers.test.ts -t "QR login"
npm test -- tests/unit/api-contracts.test.ts -t "QR|login|Cookie"
```

Expected:

- Provider test fails because `rawCookie` is missing.
- App service persistence test fails because QR status does not save `process.env.NETEASE_COOKIE`.

---

### Task 2: Return Raw QR Cookie Inside the Server Contract

**Files:**
- Modify: `src/lib/netease/types.ts`
- Modify: `src/lib/netease/cloudProvider.ts`

- [ ] **Step 1: Extend the provider type**

In `src/lib/netease/types.ts`, update the `getLoginStatus()` return type so authorized responses may include raw Cookie:

```ts
  getLoginStatus(key: string): Promise<{
    status: "waiting" | "scanned" | "authorized" | "expired";
    encryptedCookie?: string;
    rawCookie?: string;
    source?: "cookie" | "qr";
  }>;
```

- [ ] **Step 2: Return rawCookie from `NeteaseCloudProvider.getLoginStatus()`**

In `src/lib/netease/cloudProvider.ts`, change the `code === 803` branch:

```ts
const cookie = String(response.body?.cookie ?? "");
return {
  status: "authorized" as const,
  encryptedCookie: encryptCookieForLocalUse(cookie),
  rawCookie: cookie,
  source: "qr" as const
};
```

- [ ] **Step 3: Run provider test**

Run:

```bash
npm test -- tests/unit/providers.test.ts -t "QR login"
```

Expected:

```text
1 test passed
```

---

### Task 3: Persist QR Cookie in App Services Without Exposing Raw Cookie

**Files:**
- Modify: `src/lib/appServices.ts`
- Modify: `tests/unit/api-contracts.test.ts`

- [ ] **Step 1: Add provider injection seam if needed**

If unit tests cannot fake QR status without network access, add an optional provider parameter to `getLoginStatusPreview`:

```ts
export async function getLoginStatusPreview(key: string, forceRealLogin = false, provider = realNetease) {
```

Use `provider` instead of `realNetease` inside this function.

- [ ] **Step 2: Add shared persistence helper**

In `src/lib/appServices.ts`, replace the duplicated save logic with:

```ts
async function persistNeteaseCookie(cookie: string, source: "cookie" | "qr") {
  const normalizedCookie = normalizeNeteaseCookie(cookie);
  if (!normalizedCookie.includes("MUSIC_U=") && !normalizedCookie.includes("MUSIC_A=")) {
    return {
      ok: false,
      error: "Cookie 里没有 MUSIC_U 或 MUSIC_A，像是复制错了。"
    };
  }

  process.env.NETEASE_COOKIE = normalizedCookie;
  await saveLocalEnvValue("NETEASE_COOKIE", normalizedCookie);
  return {
    ok: true,
    status: "authorized" as const,
    encryptedCookie: encryptCookieForLocalUse(normalizedCookie),
    source
  };
}
```

- [ ] **Step 3: Update manual `saveNeteaseCookie()`**

Replace `saveNeteaseCookie()` body with:

```ts
export async function saveNeteaseCookie(cookie: string) {
  return persistNeteaseCookie(cookie, "cookie");
}
```

If existing tests expect no `encryptedCookie` on manual save, update the helper or test expectation so manual save remains backward compatible. Prefer preserving existing response shape unless the UI needs the new field.

- [ ] **Step 4: Update QR status persistence**

Inside the forced-real-login branch of `getLoginStatusPreview`, after calling provider status:

```ts
const status = await provider.getLoginStatus(key);
if (status.status === "authorized" && status.rawCookie) {
  const saved = await persistNeteaseCookie(status.rawCookie, "qr");
  if (!saved.ok) return { status: "waiting" as const };
  return {
    status: "authorized" as const,
    encryptedCookie: saved.encryptedCookie,
    source: "qr" as const
  };
}
return stripRawCookie(status);
```

Add helper:

```ts
function stripRawCookie<T extends { rawCookie?: string }>(value: T) {
  const { rawCookie: _rawCookie, ...safeValue } = value;
  return safeValue;
}
```

- [ ] **Step 5: Add or update app service test with fake provider**

Use fake provider injection if added:

```ts
const fakeProvider = {
  async getLoginStatus(_key: string) {
    return {
      status: "authorized" as const,
      encryptedCookie: "local-dev:test",
      rawCookie: "MUSIC_U=qr-cookie",
      source: "qr" as const
    };
  }
};

const status = await getLoginStatusPreview("qr-key-1", true, fakeProvider as never);
expect(status).toEqual({
  status: "authorized",
  encryptedCookie: expect.stringContaining("local-dev:"),
  source: "qr"
});
expect(process.env.NETEASE_COOKIE).toBe("MUSIC_U=qr-cookie");
expect(status).not.toHaveProperty("rawCookie");
```

- [ ] **Step 6: Run login tests**

Run:

```bash
npm test -- tests/unit/api-contracts.test.ts -t "login|Cookie|cookie|QR"
```

Expected:

```text
login/Cookie/QR tests pass
```

---

### Task 4: Verify Diagnostics and UI Compatibility

**Files:**
- No additional production file changes expected.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- tests/unit/providers.test.ts -t "QR login"
npm test -- tests/unit/api-contracts.test.ts -t "login|Cookie|cookie|QR"
npm test -- tests/unit/cookie-test-page.test.tsx
```

Expected:

```text
All listed tests pass
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected:

```text
tsc --noEmit
```

Command exits with code `0`.

- [ ] **Step 3: Smoke test diagnostics endpoint**

With the dev server running, request:

```powershell
(Invoke-WebRequest -Uri 'http://localhost:3000/api/login/diagnostics' -UseBasicParsing -TimeoutSec 10).StatusCode
```

Expected:

```text
200
```

- [ ] **Step 4: Inspect safe response boundary**

Run tests or inspect route output to ensure:

- `/api/login/status` never returns `rawCookie`.
- `CookieTestPanel` still only displays encrypted summaries.
- manual Cookie save still works.

---

## Handoff Notes

This plan implements only QR persistence and expiry diagnostics in single-user mode. It does not implement app-level user accounts, multi-user `user_login_states`, or C-side onboarding UI.
