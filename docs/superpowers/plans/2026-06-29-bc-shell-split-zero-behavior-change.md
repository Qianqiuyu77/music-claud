# B/C Shell Split Zero Behavior Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the consumer (`/`) and admin (`/admin`) route ownership into explicit app shells while preserving current UI, copy, API calls, and behavior.

**Architecture:** Add thin `ConsumerMusicApp` and `AdminMusicApp` wrappers that delegate to the existing `Workbench` compatibility layer. Route files switch to those wrappers, and tests assert that the wrappers pass the correct `mode` without changing current workbench behavior.

**Tech Stack:** Next.js App Router, React 19, Vitest, Testing Library, TypeScript.

---

## File Structure

- Create `src/components/player/ConsumerMusicApp.tsx`
  - C-side entry wrapper.
  - Renders the existing `<Workbench />` exactly as `/` does today.

- Create `src/components/admin/AdminMusicApp.tsx`
  - B-side entry wrapper.
  - Renders the existing `<Workbench mode="admin" />` exactly as `/admin` does today.

- Modify `src/app/page.tsx`
  - Replace direct `Workbench` import with `ConsumerMusicApp`.
  - Keep default export name and route behavior stable.

- Modify `src/app/admin/page.tsx`
  - Replace direct `Workbench` import with `AdminMusicApp`.
  - Keep default export name and route behavior stable.

- Create `tests/unit/app-shells.test.tsx`
  - Tests the new shells.
  - Mocks `Workbench` so tests prove shell-to-workbench wiring without depending on the whole app.

- Leave unchanged:
  - `src/components/workbench/Workbench.tsx`
  - `src/components/workbench/DataPanel.tsx`
  - `src/components/workbench/RecommendationPanel.tsx`
  - `src/components/admin/CookieTestPanel.tsx`
  - all CSS and visible UI.

---

### Task 1: Add Consumer and Admin Shell Failing Tests

**Files:**
- Create: `tests/unit/app-shells.test.tsx`

- [ ] **Step 1: Write the failing shell tests**

Create `tests/unit/app-shells.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConsumerMusicApp } from "@/components/player/ConsumerMusicApp";
import { AdminMusicApp } from "@/components/admin/AdminMusicApp";

vi.mock("@/components/workbench/Workbench", () => ({
  Workbench: ({ mode = "player" }: { mode?: "player" | "admin" }) => (
    <div data-testid="workbench" data-mode={mode}>
      Workbench {mode}
    </div>
  )
}));

describe("B/C app shells", () => {
  it("renders the consumer shell through the player Workbench mode", () => {
    render(<ConsumerMusicApp />);

    expect(screen.getByTestId("workbench")).toHaveAttribute("data-mode", "player");
    expect(screen.getByText("Workbench player")).toBeInTheDocument();
  });

  it("renders the admin shell through the admin Workbench mode", () => {
    render(<AdminMusicApp />);

    expect(screen.getByTestId("workbench")).toHaveAttribute("data-mode", "admin");
    expect(screen.getByText("Workbench admin")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm test -- tests/unit/app-shells.test.tsx
```

Expected:

```text
FAIL tests/unit/app-shells.test.tsx
Error: Failed to resolve import "@/components/player/ConsumerMusicApp"
```

If the failure is not about missing shell components, stop and inspect the test import paths before continuing.

---

### Task 2: Add Thin B/C App Shells

**Files:**
- Create: `src/components/player/ConsumerMusicApp.tsx`
- Create: `src/components/admin/AdminMusicApp.tsx`

- [ ] **Step 1: Add the consumer shell**

Create `src/components/player/ConsumerMusicApp.tsx`:

```tsx
import { Workbench } from "@/components/workbench/Workbench";

export function ConsumerMusicApp() {
  return <Workbench />;
}
```

- [ ] **Step 2: Add the admin shell**

Create `src/components/admin/AdminMusicApp.tsx`:

```tsx
import { Workbench } from "@/components/workbench/Workbench";

export function AdminMusicApp() {
  return <Workbench mode="admin" />;
}
```

- [ ] **Step 3: Run the shell tests**

Run:

```bash
npm test -- tests/unit/app-shells.test.tsx
```

Expected:

```text
2 tests passed
```

- [ ] **Step 4: Commit Task 2**

Run:

```bash
git add src/components/player/ConsumerMusicApp.tsx src/components/admin/AdminMusicApp.tsx tests/unit/app-shells.test.tsx
git commit -m "refactor: add consumer and admin app shells"
```

---

### Task 3: Rewire Routes to Use the Shells

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/admin/page.tsx`

- [ ] **Step 1: Update the consumer route**

Replace the contents of `src/app/page.tsx` with:

```tsx
import { ConsumerMusicApp } from "@/components/player/ConsumerMusicApp";

export default function HomePage() {
  return <ConsumerMusicApp />;
}
```

- [ ] **Step 2: Update the admin route**

Replace the contents of `src/app/admin/page.tsx` with:

```tsx
import { AdminMusicApp } from "@/components/admin/AdminMusicApp";

export default function AdminPage() {
  return <AdminMusicApp />;
}
```

- [ ] **Step 3: Run shell tests**

Run:

```bash
npm test -- tests/unit/app-shells.test.tsx
```

Expected:

```text
2 tests passed
```

- [ ] **Step 4: Run existing workbench tests**

Run:

```bash
npm test -- tests/unit/workbench.test.tsx
```

Expected:

```text
All tests in tests/unit/workbench.test.tsx pass
```

If any workbench test fails, revert only the route rewiring from this task and inspect whether the route imports introduced a module loading issue. Do not change `Workbench` behavior to satisfy this task.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add src/app/page.tsx src/app/admin/page.tsx
git commit -m "refactor: route consumer and admin pages through app shells"
```

---

### Task 4: Verify Zero Behavior Change

**Files:**
- No production file changes expected.

- [ ] **Step 1: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected:

```text
tsc --noEmit
```

Command exits with code `0`.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npm test -- tests/unit/app-shells.test.tsx tests/unit/workbench.test.tsx tests/unit/cookie-test-page.test.tsx
```

Expected:

```text
All listed test files pass
```

- [ ] **Step 3: If the dev server is not running, start it**

Check port:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
```

If nothing is listening, start:

```powershell
Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -WorkingDirectory 'D:\myProject\ai-music-claude' -RedirectStandardOutput 'D:\myProject\ai-music-claude\tmp-dev-server.out.log' -RedirectStandardError 'D:\myProject\ai-music-claude\tmp-dev-server.err.log' -WindowStyle Hidden
```

- [ ] **Step 4: Smoke test routes**

Run:

```powershell
(Invoke-WebRequest -Uri 'http://localhost:3000/' -UseBasicParsing -TimeoutSec 10).StatusCode
(Invoke-WebRequest -Uri 'http://localhost:3000/admin' -UseBasicParsing -TimeoutSec 10).StatusCode
(Invoke-WebRequest -Uri 'http://localhost:3000/admin/cookie-test' -UseBasicParsing -TimeoutSec 10).StatusCode
```

Expected:

```text
200
200
200
```

- [ ] **Step 5: Inspect diff for forbidden changes**

Run:

```bash
git diff -- src/app/page.tsx src/app/admin/page.tsx src/components/player/ConsumerMusicApp.tsx src/components/admin/AdminMusicApp.tsx tests/unit/app-shells.test.tsx
```

Expected:

- Only route import changes.
- Only thin shell components.
- Only shell tests.
- No CSS changes.
- No copy changes.
- No API behavior changes.
- No database schema changes.

- [ ] **Step 6: Commit verification-only updates if any**

If no files changed during verification, skip this step.

If test snapshots or generated files changed unexpectedly, do not commit them. Investigate why they changed.

---

## Self-Review Checklist

- Phase 1 spec coverage:
  - C route shell: Task 2 and Task 3.
  - B route shell: Task 2 and Task 3.
  - Zero behavior change: Task 4.
  - Existing tests continue to pass: Task 3 and Task 4.
  - New boundary tests: Task 1 and Task 2.

- Placeholder scan:
  - No `TBD`.
  - No `TODO`.
  - No "add appropriate error handling".
  - No unspecified test instruction.

- Type consistency:
  - `ConsumerMusicApp` and `AdminMusicApp` names are consistent across tests, files, and route imports.
  - `Workbench` mode remains `"player" | "admin"`.
  - The consumer shell omits `mode`, preserving current `/` behavior.

## Handoff Notes

This plan intentionally implements only Phase 1 from `docs/superpowers/specs/2026-06-29-bc-split-multi-user-onboarding-design.md`.

Do not start QR persistence, onboarding UI, database migration, public library reuse, user profiles, or proactive companion work while executing this plan. Each of those needs its own implementation plan.
