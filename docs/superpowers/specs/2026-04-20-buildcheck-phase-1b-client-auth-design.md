# BuildCheck — Phase 1b — Client Auth UI Design

**Date:** 2026-04-20
**Status:** Approved for implementation planning
**Phase:** 1b (client portion of §13 Phase 1 in the full redesign spec)
**Parent spec:** [2026-04-19-buildcheck-full-redesign.md](./2026-04-19-buildcheck-full-redesign.md)
**Depends on:** Phase 1a (merged) — server auth + admin routes live.

This design covers the client-side delivery of the auth slice: login, `/me` bootstrap, protected routing, and an admin-only users page with full CRUD. It builds on the existing shadcn + Tailwind + base-ui scaffolding in `client/` and introduces the routing, data-fetching, and form libraries the rest of the redesign will reuse.

---

## 1. Scope

**In scope**
- `/login` public page (email + password, server error surfacing, rate-limit feedback)
- `/` protected home placeholder ("Welcome, {name}" + top bar)
- `/admin/users` protected + ADMIN-only, full CRUD: list, create, delete, reset password, toggle active, stats cards
- `/403` forbidden fallback
- `AuthProvider` + `useAuth` hook + `useMe` query
- `<ProtectedRoute>` and `<AdminRoute>` wrappers
- Global 401 interceptor that drops session + redirects
- Toast notifications for mutation success/error
- New shared primitives: `lib/axios.ts`, `lib/queryClient.ts`, `hooks/useHttpClient.ts`, `api/auth.api.ts`, `api/admin.api.ts`, `api/types.ts`

**Out of scope (deferred)**
- Change-your-own-password flow (deferred to a later phase)
- Hebrew copy / RTL layout (Phase 9)
- Client unit or integration tests (owner directive: no client tests)
- Playwright smoke (Phase 9)

**Green bar for merging Phase 1b**
- `npm run typecheck` clean in `client/`
- `npm run build` clean in `client/`
- Manual smoke: log in as the seeded admin; land on `/`; open `/admin/users`; create a user; reset their password; toggle active; delete; log out; attempting `/admin/users` as a non-admin lands on `/403`.

---

## 2. Server contract consumed (already shipped in Phase 1a)

All responses follow the shared `{ data }` / `{ error }` shape from `server/CLAUDE.md`. Cookies are httpOnly JWT; client uses `withCredentials: true` only.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Sets auth cookie; returns `{ data: User }` |
| POST | `/api/auth/logout` | Clears auth cookie |
| GET | `/api/auth/me` | Returns `{ data: User }` or 401 |
| POST | `/api/auth/change-password` | (reserved — UI deferred) |
| GET | `/api/admin/users` | Returns `{ data: User[] }` — ADMIN only |
| POST | `/api/admin/users` | Create user; returns `{ data: { user, initialPassword } }` |
| DELETE | `/api/admin/users/:id` | Delete user |
| POST | `/api/admin/users/:id/reset-password` | Returns `{ data: { newPassword } }` |
| PATCH | `/api/admin/users/:id/active` | Toggle active — body `{ isActive: boolean }` |
| GET | `/api/admin/stats` | Returns `{ data: { total, active, admins } }` |

> Exact paths and payload shapes must be confirmed against [server/src/api/routes/auth.routes.ts](../../../server/src/api/routes/auth.routes.ts) and `admin.routes.ts` during plan writing; if any diverge from this table, the plan task list is the place to reconcile, not this doc.

---

## 3. New client dependencies

**Runtime**
- `react-router` (v7) — declarative routes + nested layouts
- `@tanstack/react-query` — cache for `['me']`, `['admin','users']`, `['admin','stats']`
- `react-hook-form` + `@hookform/resolvers` — form state
- `zod` — client-side form schemas
- `axios` — shared HTTP client (used by `useHttpClient` and passed as `queryFn` body)
- `sonner` — toast notifications

**shadcn components (added via CLI)**
`button`, `input`, `label`, `form`, `card`, `table`, `dialog`, `alert-dialog`, `dropdown-menu`, `badge`, `sonner`.

**No new dev deps** — client tests are explicitly deferred.

---

## 4. File layout

```
client/src/
  main.tsx                    QueryClientProvider + BrowserRouter + ThemeProvider + AuthProvider + <Toaster />
  App.tsx                     imports <AppRoutes/>
  routes.tsx                  <AppRoutes> — route tree
  lib/
    utils.ts                  (existing)
    axios.ts                  configured instance: baseURL from VITE_API_BASE_URL, withCredentials: true
    queryClient.ts            QueryClient with retry: false for 4xx, staleTime for ['me']
    http-error.ts             normalize axios error → { status, message, details }
  api/
    auth.api.ts               login, logout, getMe
    admin.api.ts              listUsers, createUser, deleteUser, resetPassword, toggleActive, getStats
    types.ts                  User, Role ('ADMIN' | 'USER'), AdminStats
  hooks/
    useHttpClient.ts          imperative call + AbortController (per referenced reference)
    useAuth.ts                reads AuthContext
    useMe.ts                  React Query wrapper around authApi.getMe
  context/
    auth.context.tsx          AuthProvider, AuthContext
  components/
    layout/
      AppLayout.tsx           top bar + <Outlet/>
      TopBar.tsx              brand, admin link (if ADMIN), user menu (logout)
    routing/
      ProtectedRoute.tsx      gate — redirects unauthenticated to /login with `state.from`
      AdminRoute.tsx          gate — redirects non-admins to /403
    ui/                       shadcn primitives (existing + new)
    mode-toggle.tsx           (existing)
    theme-provider.tsx        (existing)
  pages/
    LoginPage.tsx
    HomePage.tsx              "Welcome, {name}" placeholder
    ForbiddenPage.tsx         /403
    admin/
      AdminUsersPage.tsx      page shell: stats cards + <UsersTable/>
      UsersTable.tsx          shadcn Table + row action dropdown
      CreateUserDialog.tsx    RHF + zod
      ResetPasswordDialog.tsx confirm → show new password with copy-to-clipboard
      DeleteUserConfirm.tsx   AlertDialog ("type email to confirm")
      ToggleActiveConfirm.tsx AlertDialog
```

`api/` is the only layer that imports axios. `hooks/` composes Query + context. `pages/` consume hooks. `components/` are presentational. Phase 2's projects slot into `pages/` and `api/` without disturbing this structure.

---

## 5. Auth flow

### 5.1 Bootstrap
1. `main.tsx` wraps the tree: `<QueryClientProvider><BrowserRouter><ThemeProvider><AuthProvider><Toaster /><App/></AuthProvider></ThemeProvider></BrowserRouter></QueryClientProvider>`.
2. `AuthProvider` calls `useMe()` — `useQuery({ queryKey: ['me'], queryFn: authApi.getMe, retry: false, staleTime: 5 * 60_000 })`.
3. While `useMe.isLoading`, `AuthProvider` renders a full-viewport centered spinner. This prevents `<ProtectedRoute>` from racing with an unresolved session and flashing the login page.
4. On success: `user` set in context. On 401: `user = null`.

### 5.2 Login
1. `LoginPage` uses RHF with a zod schema (`email: z.string().email()`, `password: z.string().min(1)`).
2. Submit calls `useHttpClient({ fn: authApi.login })` (imperative + abort on unmount).
3. On 2xx: `queryClient.invalidateQueries({ queryKey: ['me'] })` → `AuthProvider` refetch completes → `navigate(state?.from?.pathname ?? '/', { replace: true })`.
4. On 401: inline form error ("Invalid email or password").
5. On 429: toast ("Too many attempts — try again in a moment").
6. On 5xx or network: toast ("Something went wrong — try again").

### 5.3 Logout
1. TopBar user menu → `authApi.logout()` via `useHttpClient`.
2. Regardless of response (logout is idempotent on the client), `queryClient.removeQueries()` + `queryClient.setQueryData(['me'], null)` → `navigate('/login', { replace: true })`.

### 5.4 Route guards
- `<ProtectedRoute>` — reads `useAuth()`. If `!user` → `<Navigate to="/login" state={{ from: location }} replace />`.
- `<AdminRoute>` — nested inside `<ProtectedRoute>`; if `user.role !== 'ADMIN'` → `<Navigate to="/403" replace />`.

### 5.5 Global 401 handling
`lib/axios.ts` installs a response interceptor. On any 401 response **except** for `POST /api/auth/login` (where 401 is expected and surfaced as an inline form error), the interceptor calls `queryClient.setQueryData(['me'], null)` + `queryClient.removeQueries({ predicate: q => q.queryKey[0] !== 'me' })`. On the next render, `<ProtectedRoute>` sees `user === null` and redirects to `/login`. This handles session expiry mid-session without each query having to special-case 401.

---

## 6. Routes

```tsx
<Routes>
  <Route path="/login" element={<LoginPage />} />
  <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
    <Route path="/" element={<HomePage />} />
    <Route path="/403" element={<ForbiddenPage />} />
    <Route element={<AdminRoute />}>
      <Route path="/admin/users" element={<AdminUsersPage />} />
    </Route>
  </Route>
  <Route path="*" element={<Navigate to="/" replace />} />
</Routes>
```

- Unauthenticated `/*` → `<ProtectedRoute>` redirects to `/login` with `state.from` for post-login return.
- Authenticated unknown path → redirects to `/` (which is protected, so safe).

---

## 7. Admin users page

### 7.1 Queries
- `['admin','users']` → `adminApi.listUsers()` — `staleTime: 0`, invalidated by every admin mutation
- `['admin','stats']` → `adminApi.getStats()` — invalidated together with users list

### 7.2 Layout
- Header row: title "Users" + primary button "Create user"
- Stats cards row: total / active / admins (shadcn `Card`)
- `UsersTable` — columns: email, name, role badge (ADMIN/USER), active badge (Active/Disabled), created (date), actions (dropdown)

### 7.3 Row actions dropdown
- Reset password → `ResetPasswordDialog` → AlertDialog confirm → server returns new password → show in modal with copy button
- Toggle active → `ToggleActiveConfirm` → AlertDialog confirm
- Delete → `DeleteUserConfirm` → AlertDialog requiring the user to **type the target email** before the destructive button enables

The current user's own row has all actions disabled (the client refuses to let an admin delete or deactivate themselves — defense in depth; the server should enforce this too).

### 7.4 Create user
Dialog with RHF + zod: email, name, role. On submit via `useHttpClient`, server returns `{ user, initialPassword }`. The dialog switches to a success state showing the initial password with a copy-to-clipboard button and an explicit "Close" button (the password is shown only once).

### 7.5 Mutations
All via `useHttpClient`. On success: `invalidateQueries({ queryKey: ['admin', 'users'] })` + `invalidateQueries({ queryKey: ['admin', 'stats'] })` + success toast. On error: error toast with the normalized message from `http-error.ts`.

### 7.6 States
- Loading: skeleton rows in the table, skeleton cards
- Error: `<Alert variant="destructive">` with a "Retry" button that calls `refetch()`
- Empty: "No users" row (unreachable given the seeded admin)

---

## 8. Process / branching

**Client submodule branch.** Create `feat/buildcheck-phase-1b` off `feat/buildcheck-redesign` inside `client/`. Phase commits land on that branch; its PR targets `feat/buildcheck-redesign` (the client's long-lived redesign line). The main repo's `feat/buildcheck-phase-1b` branch bumps the submodule pointer as commits land.

**Main repo branch.** Create `feat/buildcheck-phase-1b` off `integration/buildcheck`. PR targets `integration/buildcheck` per the redesign branch strategy.

**Uncommitted changes on integration/buildcheck.** The existing working-tree edits (`Phase Status.md` untracked, `CLAUDE.md`, CI workflow, vault MOCs, spec, `skills-lock.json`, `.mcp.json`, deleted tailwind-v4 spec) are tooling/process work unrelated to Phase 1b. They land as a single `chore(integration): ...` commit on `integration/buildcheck` **before** the phase-1b branch is cut, so the phase-1b PR stays scoped to client auth UI. This preserves the rule that integration is never committed to *for feature work* — a chore commit grouping outside-scope tooling is the narrow documented exception.

**Phase Status update.** The transition (`not-started → in-progress` when the branch is created, `in-progress → in-review` when the PR opens, `in-review → merged` at merge) is updated in `docs/vault/00-Index/Phase Status.md` in the same commit as the transition, per the CLAUDE.md rule.

**Vault.** Auth pages in the vault already exist for Phase 1a (server side). Phase 1b updates: Client MOC additions for the new pages/hooks/context, and a new flow page describing bootstrap + login + logout (or an append to the existing auth flow page if one exists). Updates land in the phase-1b PR alongside the code, per CLAUDE.md.

---

## 9. Risks & non-goals

- **No tests** is an explicit owner call. Regressions in auth are caught by manual smoke at merge and by Phase 9's Playwright smoke. This is a conscious risk.
- **Cookie SameSite / cross-origin in dev.** Dev server runs on a different port than the API. Server CORS already sets `credentials: true` (Phase 0); the client's axios instance must use `withCredentials: true` and the server cookie must be `SameSite=Lax` or `None; Secure` as appropriate. If Phase 0's cookie is `SameSite=Strict`, dev login will silently fail and the plan must surface this before implementation.
- **Self-action guards are client-side only** for delete/deactivate-self. The server must also refuse these (Phase 1a scope); if a gap exists, it's tracked as a Phase 1a follow-up, not expanded here.
- **No i18n layer.** English strings are inline. Phase 9 introduces Hebrew copy and any needed RTL CSS in a coordinated pass. If the owner reverses this before Phase 9, extracting inline strings is a mechanical refactor.
