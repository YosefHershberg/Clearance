# Phase 1b — Client Auth UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the client-side delivery of auth: login page, `/me`-backed auth state, protected route wrapper, admin-only users page with full CRUD, all integrated with the existing Phase 1a server contract.

**Architecture:** React + Vite + TypeScript + shadcn/ui. react-router v7 for declarative routes. React Query for cached reads (`['me']`, admin list, admin stats). RHF + zod for forms. Axios for HTTP (shared instance with `withCredentials: true`); cached queries use the axios instance, imperative mutations go through `useHttpClient` (AbortController-aware). Sonner for toasts. No client tests (per owner directive) — green bar is `npm run typecheck` + `npm run build` + manual smoke.

**Tech stack additions:** `react-router@7`, `@tanstack/react-query`, `react-hook-form`, `@hookform/resolvers`, `zod`, `axios`, `sonner`. shadcn components: `button`, `input`, `label`, `form`, `card`, `table`, `dialog`, `alert-dialog`, `dropdown-menu`, `badge`, `sonner`.

**Design spec:** [2026-04-20-buildcheck-phase-1b-client-auth-design.md](../specs/2026-04-20-buildcheck-phase-1b-client-auth-design.md)

---

## Server contract (verified in `server/src/api/`)

| Method | Path | Request | Success Response |
|---|---|---|---|
| POST | `/api/auth/login` | `{ email, password }` | `{ data: { user: User } }` sets httpOnly cookie |
| POST | `/api/auth/logout` | — | `{ data: { ok: true } }` clears cookie |
| GET | `/api/auth/me` | — | `{ data: { user: User } }` or 401 |
| GET | `/api/admin/users?q&limit&cursor` | — | `{ data: { users: User[], nextCursor?: string } }` |
| POST | `/api/admin/users` | `{ email, name, initialPassword }` (min 8) | `201 { data: { user: User } }` |
| DELETE | `/api/admin/users/:id` | — | `{ data: { ok: true } }` |
| POST | `/api/admin/users/:id/reset-password` | `{ newPassword }` (min 8) | `{ data: { ok: true } }` |
| PATCH | `/api/admin/users/:id/active` | `{ isActive: boolean }` | `{ data: { user: User } }` |
| GET | `/api/admin/stats` | — | `{ data: { userCount, projectCount, analysisCount } }` |

`User` shape: `{ id, email, name, role: 'ADMIN' \| 'USER', isActive, createdAt }`.

**Reconciliation with design doc:** Admin does NOT receive a server-generated password for create/reset — admin **types** the password themselves, server stores it. `AdminStats` is `{ userCount, projectCount, analysisCount }`, not `{ total, active, admins }`; for Phase 1b the card row shows the three as-is (projects/analyses will naturally light up in later phases).

---

## Dependency graph + parallelization clusters

```
Cluster 0 (sequential setup)
   └─> Cluster 1 (parallel: infra, api, hook)
           └─> Cluster 2 (sequential: context + query hook)
                   └─> Cluster 3 (parallel: routing, layout, login, home)
                           └─> Cluster 4 (sequential: wire-up + smoke checkpoint)
                                   └─> Cluster 5 (parallel: admin page + dialogs)
                                           └─> Cluster 6 (sequential: final smoke + bump + push)
```

Agents in a parallel cluster touch disjoint files. **Agents do NOT commit** — the orchestrator commits at cluster boundaries.

---

## Preflight: repo state assumptions

- CWD: `C:/Users/yosefh/OneDrive - hms.co.il/Desktop/Clearance`
- Main repo branch: `feat/buildcheck-phase-1b` (already cut; has the design-spec commit `feff824`)
- Client submodule is on `feat/buildcheck-redesign` with uncommitted tooling WT (deleted `.github/workflows/ci.yml` + `deploy.yml`; modified `CLAUDE.md`; untracked `.dockerignore`, `.github/workflows/ci-cd.yml`, `Dockerfile`, `nginx.conf`). These are build/deploy tooling, unrelated to Phase 1b client auth work.

---

## Task 1 — Client submodule: chore commit + cut phase-1b branch (sequential)

**Files:**
- In `client/`: commit the tooling WT as `chore(build): ...` on `feat/buildcheck-redesign`, then cut `feat/buildcheck-phase-1b` off it.

- [ ] **Step 1.1** — In `client/`, stage the tooling WT

```bash
cd "C:/Users/yosefh/OneDrive - hms.co.il/Desktop/Clearance/client"
git add CLAUDE.md
git add -- .github/workflows/ci.yml .github/workflows/deploy.yml
git add .github/workflows/ci-cd.yml .dockerignore Dockerfile nginx.conf
git status --short
```

Expected: all listed files staged (`M`, `D`, or `A`), no remaining untracked/modified except any intentional leftovers.

- [ ] **Step 1.2** — Commit as chore

```bash
git commit -m "chore(build): replace split CI workflows with ci-cd; add Docker/nginx"
```

Expected: single commit on `feat/buildcheck-redesign`.

- [ ] **Step 1.3** — Cut phase-1b branch

```bash
git checkout -b feat/buildcheck-phase-1b
git status
```

Expected: "On branch feat/buildcheck-phase-1b" with clean working tree.

---

## Task 2 — Install runtime dependencies (sequential)

**Files:** `client/package.json`, `client/package-lock.json`.

- [ ] **Step 2.1** — Install all runtime deps in a single call

```bash
cd "C:/Users/yosefh/OneDrive - hms.co.il/Desktop/Clearance/client"
npm install react-router @tanstack/react-query react-hook-form @hookform/resolvers zod axios sonner
```

Expected: exits 0; `package.json` dependencies updated; lockfile updated.

- [ ] **Step 2.2** — Sanity-check typecheck baseline

```bash
npm run typecheck
```

Expected: exits 0 (project still builds; deps added but not yet imported).

- [ ] **Step 2.3** — Commit

```bash
git add package.json package-lock.json
git commit -m "feat(deps): add router, query, rhf, zod, axios, sonner for auth UI"
```

---

## Task 3 — Add shadcn components (sequential)

**Files:** multiple under `client/src/components/ui/`.

- [ ] **Step 3.1** — Run shadcn CLI to add each primitive

```bash
cd "C:/Users/yosefh/OneDrive - hms.co.il/Desktop/Clearance/client"
npx shadcn@latest add button input label form card table dialog alert-dialog dropdown-menu badge sonner
```

Expected: creates files under `src/components/ui/` (button.tsx, input.tsx, label.tsx, form.tsx, card.tsx, table.tsx, dialog.tsx, alert-dialog.tsx, dropdown-menu.tsx, badge.tsx, sonner.tsx). May install peer deps (`@radix-ui/*`, `cmdk`, etc.). Accept all prompts.

- [ ] **Step 3.2** — Typecheck

```bash
npm run typecheck
```

Expected: exits 0.

- [ ] **Step 3.3** — Commit

```bash
git add src/components/ui package.json package-lock.json components.json 2>/dev/null
git commit -m "feat(ui): add shadcn primitives for auth + admin pages"
```

---

## Cluster 1 — Infra + API types + imperative hook (parallel)

Three sub-tasks that touch disjoint files. Dispatch in parallel after Task 3.

### Task 4 — lib/ utilities + env

**Files (create):**
- `client/src/lib/axios.ts`
- `client/src/lib/queryClient.ts`
- `client/src/lib/http-error.ts`
- `client/.env.development`
- `client/src/vite-env.d.ts` — modify to type `VITE_API_BASE_URL`

- [ ] **Step 4.1** — Create `src/lib/axios.ts`

```ts
// client/src/lib/axios.ts
import axios from 'axios';
import { queryClient } from './queryClient';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  withCredentials: true,
});

// Global 401 handler: session expired mid-use → drop the me cache; <ProtectedRoute>
// picks it up and redirects. Exempt the login route where 401 is an expected form error.
api.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error?.response?.status;
    const url: string = error?.config?.url ?? '';
    if (status === 401 && !url.endsWith('/auth/login')) {
      queryClient.setQueryData(['me'], null);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    }
    return Promise.reject(error);
  },
);
```

- [ ] **Step 4.2** — Create `src/lib/queryClient.ts`

```ts
// client/src/lib/queryClient.ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: unknown) => {
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});
```

- [ ] **Step 4.3** — Create `src/lib/http-error.ts`

```ts
// client/src/lib/http-error.ts
import type { AxiosError } from 'axios';

export type NormalizedHttpError = {
  status: number | null;
  message: string;
  details?: Array<{ message: string }>;
};

export function normalizeHttpError(err: unknown): NormalizedHttpError {
  const ax = err as AxiosError<{ error?: string; details?: Array<{ message: string }> }>;
  const status = ax?.response?.status ?? null;
  const payload = ax?.response?.data;
  const message = payload?.error ?? ax?.message ?? 'Unexpected error';
  return { status, message, details: payload?.details };
}
```

- [ ] **Step 4.4** — Create `client/.env.development`

```
VITE_API_BASE_URL=http://localhost:3001/api
```

Note: Replace `3001` if the server runs on a different port locally.

- [ ] **Step 4.5** — Update `src/vite-env.d.ts` (append, don't replace existing `/// <reference ...>`)

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 4.6** — Typecheck only (do NOT commit here; orchestrator commits Cluster 1 together)

```bash
npm run typecheck
```

Expected: exits 0.

### Task 5 — API types + auth.api + admin.api

**Files (create):**
- `client/src/api/types.ts`
- `client/src/api/auth.api.ts`
- `client/src/api/admin.api.ts`

- [ ] **Step 5.1** — `src/api/types.ts`

```ts
// client/src/api/types.ts
export type Role = 'ADMIN' | 'USER';

export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: string; // ISO
};

export type AdminStats = {
  userCount: number;
  projectCount: number;
  analysisCount: number;
};

export type ListUsersResponse = {
  users: User[];
  nextCursor?: string;
};
```

- [ ] **Step 5.2** — `src/api/auth.api.ts`

```ts
// client/src/api/auth.api.ts
import { api } from '@/lib/axios';
import type { User } from './types';

export async function login(body: { email: string; password: string }, signal?: AbortSignal) {
  const res = await api.post<{ data: { user: User } }>('/auth/login', body, { signal });
  return res.data.data.user;
}

export async function logout(signal?: AbortSignal) {
  await api.post<{ data: { ok: true } }>('/auth/logout', undefined, { signal });
}

export async function getMe(signal?: AbortSignal): Promise<User | null> {
  try {
    const res = await api.get<{ data: { user: User } }>('/auth/me', { signal });
    return res.data.data.user;
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 401) return null;
    throw err;
  }
}
```

- [ ] **Step 5.3** — `src/api/admin.api.ts`

```ts
// client/src/api/admin.api.ts
import { api } from '@/lib/axios';
import type { AdminStats, ListUsersResponse, User } from './types';

export async function listUsers(
  params: { q?: string; limit?: number; cursor?: string } = {},
  signal?: AbortSignal,
): Promise<ListUsersResponse> {
  const res = await api.get<{ data: ListUsersResponse }>('/admin/users', { params, signal });
  return res.data.data;
}

export async function createUser(
  body: { email: string; name: string; initialPassword: string },
  signal?: AbortSignal,
): Promise<User> {
  const res = await api.post<{ data: { user: User } }>('/admin/users', body, { signal });
  return res.data.data.user;
}

export async function deleteUser(id: string, signal?: AbortSignal): Promise<void> {
  await api.delete(`/admin/users/${id}`, { signal });
}

export async function resetPassword(
  id: string,
  body: { newPassword: string },
  signal?: AbortSignal,
): Promise<void> {
  await api.post(`/admin/users/${id}/reset-password`, body, { signal });
}

export async function setActive(
  id: string,
  body: { isActive: boolean },
  signal?: AbortSignal,
): Promise<User> {
  const res = await api.patch<{ data: { user: User } }>(`/admin/users/${id}/active`, body, { signal });
  return res.data.data.user;
}

export async function getStats(signal?: AbortSignal): Promise<AdminStats> {
  const res = await api.get<{ data: AdminStats }>('/admin/stats', { signal });
  return res.data.data;
}
```

- [ ] **Step 5.4** — Typecheck (no commit)

```bash
npm run typecheck
```

### Task 6 — hooks/useHttpClient

**Files (create):** `client/src/hooks/useHttpClient.ts`.

- [ ] **Step 6.1** — Create file verbatim from the referenced hook, adapted to the `AxiosError` import already brought in by axios dep

```ts
// client/src/hooks/useHttpClient.ts
import { useRef, useEffect, useState, useCallback } from 'react';
import { AxiosError } from 'axios';

const useHttpClient = <TResponse, TArgs extends unknown[]>(
  {
    fn: apiFn,
    onSuccess,
    onError,
  }: {
    fn: (...args: [...TArgs, AbortSignal]) => Promise<TResponse>;
    onSuccess?: (data: TResponse) => void;
    onError?: (error: AxiosError) => void;
  },
) => {
  const activeHttpRequests = useRef<AbortController[]>([]);
  const [state, setState] = useState<{
    data: TResponse | null;
    error: AxiosError | null;
    isLoading: boolean;
    responseStatus: number | null;
  }>({ data: null, error: null, isLoading: false, responseStatus: null });

  const execute = useCallback(
    async (...args: TArgs) => {
      const httpAbortCtrl = new AbortController();
      activeHttpRequests.current.push(httpAbortCtrl);
      setState((prev) => ({ ...prev, isLoading: true, error: null }));
      try {
        const res = await apiFn(...args, httpAbortCtrl.signal);
        setState((prev) => ({
          ...prev,
          data: res,
          responseStatus: (res as { status?: number } | null)?.status ?? null,
        }));
        onSuccess?.(res);
        return res;
      } catch (error) {
        setState((prev) => ({ ...prev, error: error as AxiosError }));
        onError?.(error as AxiosError);
        throw error;
      } finally {
        setState((prev) => ({ ...prev, isLoading: false }));
        activeHttpRequests.current = activeHttpRequests.current.filter(
          (reqCtrl) => reqCtrl !== httpAbortCtrl,
        );
      }
    },
    [apiFn, onSuccess, onError],
  );

  useEffect(() => {
    const requests = activeHttpRequests.current;
    return () => {
      requests.forEach((abortCtrl) => abortCtrl.abort());
      activeHttpRequests.current = [];
    };
  }, []);

  return {
    data: state.data,
    error: state.error,
    isLoading: state.isLoading,
    execute,
    responseStatus: state.responseStatus,
  };
};

export default useHttpClient;
```

- [ ] **Step 6.2** — Typecheck (no commit)

```bash
npm run typecheck
```

### Orchestrator step — Commit Cluster 1

```bash
cd "C:/Users/yosefh/OneDrive - hms.co.il/Desktop/Clearance/client"
git add src/lib src/api src/hooks/useHttpClient.ts src/vite-env.d.ts .env.development
git commit -m "feat(auth): add axios client, query client, http-error, api layer, useHttpClient"
```

---

## Cluster 2 — AuthContext + query hooks (sequential)

### Task 7 — AuthContext + useAuth + useMe

**Files (create):**
- `client/src/context/auth.context.tsx`
- `client/src/hooks/useAuth.ts`
- `client/src/hooks/useMe.ts`

- [ ] **Step 7.1** — `src/hooks/useMe.ts`

```ts
// client/src/hooks/useMe.ts
import { useQuery } from '@tanstack/react-query';
import { getMe } from '@/api/auth.api';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: ({ signal }) => getMe(signal),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
```

- [ ] **Step 7.2** — `src/context/auth.context.tsx`

```tsx
// client/src/context/auth.context.tsx
import { createContext, useMemo, type ReactNode } from 'react';
import { useMe } from '@/hooks/useMe';
import type { User } from '@/api/types';

export type AuthContextValue = {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useMe();
  const value = useMemo<AuthContextValue>(
    () => ({ user: data ?? null, isLoading, isAuthenticated: !!data }),
    [data, isLoading],
  );

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
```

- [ ] **Step 7.3** — `src/hooks/useAuth.ts`

```ts
// client/src/hooks/useAuth.ts
import { useContext } from 'react';
import { AuthContext, type AuthContextValue } from '@/context/auth.context';

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
```

- [ ] **Step 7.4** — Typecheck + commit

```bash
npm run typecheck
git add src/context src/hooks/useAuth.ts src/hooks/useMe.ts
git commit -m "feat(auth): AuthContext + useMe + useAuth hooks"
```

---

## Cluster 3 — Routing, layout, login, home (parallel)

Four sub-tasks across disjoint files.

### Task 8 — Routing gates + forbidden page

**Files (create):**
- `client/src/components/routing/ProtectedRoute.tsx`
- `client/src/components/routing/AdminRoute.tsx`
- `client/src/pages/ForbiddenPage.tsx`

- [ ] **Step 8.1** — `ProtectedRoute.tsx`

```tsx
// client/src/components/routing/ProtectedRoute.tsx
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '@/hooks/useAuth';

export function ProtectedRoute() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}
```

- [ ] **Step 8.2** — `AdminRoute.tsx`

```tsx
// client/src/components/routing/AdminRoute.tsx
import { Navigate, Outlet } from 'react-router';
import { useAuth } from '@/hooks/useAuth';

export function AdminRoute() {
  const { user } = useAuth();
  if (!user || user.role !== 'ADMIN') {
    return <Navigate to="/403" replace />;
  }
  return <Outlet />;
}
```

- [ ] **Step 8.3** — `ForbiddenPage.tsx`

```tsx
// client/src/pages/ForbiddenPage.tsx
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
      <h1 className="text-3xl font-semibold">403 — Forbidden</h1>
      <p className="text-muted-foreground">You don't have permission to view this page.</p>
      <Button asChild variant="outline"><Link to="/">Go home</Link></Button>
    </div>
  );
}
```

- [ ] **Step 8.4** — Typecheck (no commit)

### Task 9 — Layout

**Files (create):**
- `client/src/components/layout/AppLayout.tsx`
- `client/src/components/layout/TopBar.tsx`

- [ ] **Step 9.1** — `TopBar.tsx`

```tsx
// client/src/components/layout/TopBar.tsx
import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';
import useHttpClient from '@/hooks/useHttpClient';
import { logout as logoutApi } from '@/api/auth.api';
import { toast } from 'sonner';
import { normalizeHttpError } from '@/lib/http-error';

export function TopBar() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { execute, isLoading } = useHttpClient({ fn: logoutApi });

  const handleLogout = async () => {
    try {
      await execute();
    } catch (e) {
      toast.error(normalizeHttpError(e).message);
    } finally {
      qc.setQueryData(['me'], null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      navigate('/login', { replace: true });
    }
  };

  if (!user) return null;

  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link to="/" className="font-semibold">Clearance</Link>
        <nav className="flex items-center gap-2">
          {user.role === 'ADMIN' && (
            <Button asChild variant="ghost" size="sm"><Link to="/admin/users">Admin</Link></Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">{user.name}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} disabled={isLoading}>
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>
      </div>
    </header>
  );
}
```

- [ ] **Step 9.2** — `AppLayout.tsx`

```tsx
// client/src/components/layout/AppLayout.tsx
import { Outlet } from 'react-router';
import { TopBar } from './TopBar';

export function AppLayout() {
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 9.3** — Typecheck (no commit)

### Task 10 — Login page

**Files (create):** `client/src/pages/LoginPage.tsx`.

- [ ] **Step 10.1** — `LoginPage.tsx`

```tsx
// client/src/pages/LoginPage.tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import useHttpClient from '@/hooks/useHttpClient';
import { login as loginApi } from '@/api/auth.api';
import { normalizeHttpError } from '@/lib/http-error';
import { useAuth } from '@/hooks/useAuth';
import { useEffect } from 'react';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});
type Values = z.infer<typeof schema>;

export default function LoginPage() {
  const { isAuthenticated } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/';

  useEffect(() => {
    if (isAuthenticated) navigate(from, { replace: true });
  }, [isAuthenticated, from, navigate]);

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });
  const { execute, isLoading } = useHttpClient({ fn: loginApi });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await execute(values);
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate(from, { replace: true });
    } catch (e) {
      const { status, message } = normalizeHttpError(e);
      if (status === 401) {
        form.setError('password', { message: 'Invalid email or password' });
      } else if (status === 429) {
        toast.error('Too many attempts — try again in a moment');
      } else {
        toast.error(message);
      }
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Clearance — BuildCheck</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl><Input type="email" autoComplete="email" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl><Input type="password" autoComplete="current-password" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={isLoading}>{isLoading ? 'Signing in…' : 'Sign in'}</Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 10.2** — Typecheck (no commit)

### Task 11 — Home page

**Files (create):** `client/src/pages/HomePage.tsx`.

- [ ] **Step 11.1** — `HomePage.tsx`

```tsx
// client/src/pages/HomePage.tsx
import { useAuth } from '@/hooks/useAuth';

export default function HomePage() {
  const { user } = useAuth();
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">Welcome, {user?.name}</h1>
      <p className="text-muted-foreground">
        Phase 1b shell — project pages arrive in Phase 2.
      </p>
    </div>
  );
}
```

- [ ] **Step 11.2** — Typecheck (no commit)

### Orchestrator step — Commit Cluster 3

```bash
cd "C:/Users/yosefh/OneDrive - hms.co.il/Desktop/Clearance/client"
git add src/components/routing src/components/layout src/pages/LoginPage.tsx src/pages/HomePage.tsx src/pages/ForbiddenPage.tsx
git commit -m "feat(auth): routing gates, app layout, login + home + forbidden pages"
```

---

## Cluster 4 — Wire-up + smoke checkpoint (sequential)

### Task 12 — Routes wire-up

**Files:**
- Modify: `client/src/main.tsx`
- Create: `client/src/routes.tsx`
- Replace: `client/src/App.tsx`

- [ ] **Step 12.1** — Replace `src/App.tsx`

```tsx
// client/src/App.tsx
import AppRoutes from './routes';

export default function App() {
  return <AppRoutes />;
}
```

- [ ] **Step 12.2** — Create `src/routes.tsx`

```tsx
// client/src/routes.tsx
import { Navigate, Route, Routes } from 'react-router';
import { ProtectedRoute } from '@/components/routing/ProtectedRoute';
import { AdminRoute } from '@/components/routing/AdminRoute';
import { AppLayout } from '@/components/layout/AppLayout';
import LoginPage from '@/pages/LoginPage';
import HomePage from '@/pages/HomePage';
import ForbiddenPage from '@/pages/ForbiddenPage';
import AdminUsersPage from '@/pages/admin/AdminUsersPage';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/403" element={<ForbiddenPage />} />
          <Route element={<AdminRoute />}>
            <Route path="/admin/users" element={<AdminUsersPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
```

Note: `AdminUsersPage` is imported but not yet built. Cluster 5 creates it. **Before running the dev server in step 12.4, Cluster 5 must be complete OR create a stub now.** To keep the wire-up reviewable on its own, create a stub:

- [ ] **Step 12.3** — Create stub `src/pages/admin/AdminUsersPage.tsx` (Cluster 5 will replace)

```tsx
// client/src/pages/admin/AdminUsersPage.tsx
export default function AdminUsersPage() {
  return <div>Admin users — implementation coming in Cluster 5.</div>;
}
```

- [ ] **Step 12.4** — Replace `src/main.tsx`

```tsx
// client/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import './index.css';
import App from './App.tsx';
import { ThemeProvider } from '@/components/theme-provider';
import { queryClient } from '@/lib/queryClient';
import { AuthProvider } from '@/context/auth.context';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <App />
            <Toaster richColors position="top-right" />
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 12.5** — Typecheck + build

```bash
cd "C:/Users/yosefh/OneDrive - hms.co.il/Desktop/Clearance/client"
npm run typecheck
npm run build
```

Both must exit 0.

- [ ] **Step 12.6** — Smoke test (requires server running on VITE_API_BASE_URL). **Ask user to start the server**, then:

```bash
npm run dev
```

Open the printed URL. Expected:
- `/` redirects to `/login` (no session).
- Log in as seeded admin → redirected to `/` showing "Welcome, {name}".
- TopBar shows an "Admin" button (role=ADMIN).
- `/admin/users` loads the stub ("Admin users — implementation coming in Cluster 5.").
- Logout from user menu → back to `/login`; hitting `/` redirects back to `/login`.

Stop dev server once smoke passes.

- [ ] **Step 12.7** — Commit

```bash
git add src/main.tsx src/App.tsx src/routes.tsx src/pages/admin/AdminUsersPage.tsx
git commit -m "feat(auth): wire providers + routes; smoke-verified login/logout + 403 flow"
```

---

## Cluster 5 — Admin page + dialogs (parallel)

Five sub-tasks. `AdminUsersPage` and `UsersTable` can run in parallel with the four dialog components because dialogs are referenced only by name by `UsersTable` — pass stub no-op handlers until dialogs exist, or let the agent implement the callsite imports at the end.

**Coordination rule:** agents writing dialogs create their file standalone (no barrel edits). The `UsersTable` agent imports the dialog components directly by path. No shared barrel file.

### Task 13 — AdminUsersPage + UsersTable

**Files:**
- Replace: `client/src/pages/admin/AdminUsersPage.tsx`
- Create: `client/src/pages/admin/UsersTable.tsx`

- [ ] **Step 13.1** — Replace `AdminUsersPage.tsx`

```tsx
// client/src/pages/admin/AdminUsersPage.tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listUsers, getStats } from '@/api/admin.api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import UsersTable from './UsersTable';
import CreateUserDialog from './CreateUserDialog';

export default function AdminUsersPage() {
  const [createOpen, setCreateOpen] = useState(false);

  const usersQ = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: ({ signal }) => listUsers({ limit: 50 }, signal),
    staleTime: 0,
  });

  const statsQ = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: ({ signal }) => getStats(signal),
    staleTime: 30_000,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Users</h1>
        <Button onClick={() => setCreateOpen(true)}>Create user</Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Users</CardTitle></CardHeader>
          <CardContent className="text-3xl font-semibold">
            {statsQ.isLoading ? '—' : statsQ.data?.userCount ?? 0}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Projects</CardTitle></CardHeader>
          <CardContent className="text-3xl font-semibold">
            {statsQ.isLoading ? '—' : statsQ.data?.projectCount ?? 0}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Analyses</CardTitle></CardHeader>
          <CardContent className="text-3xl font-semibold">
            {statsQ.isLoading ? '—' : statsQ.data?.analysisCount ?? 0}
          </CardContent>
        </Card>
      </div>

      <UsersTable
        users={usersQ.data?.users ?? []}
        isLoading={usersQ.isLoading}
        isError={usersQ.isError}
        onRetry={() => usersQ.refetch()}
      />

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
```

- [ ] **Step 13.2** — Create `UsersTable.tsx`

```tsx
// client/src/pages/admin/UsersTable.tsx
import { useState } from 'react';
import type { User } from '@/api/types';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';
import ResetPasswordDialog from './ResetPasswordDialog';
import ToggleActiveConfirm from './ToggleActiveConfirm';
import DeleteUserConfirm from './DeleteUserConfirm';

type Props = {
  users: User[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
};

export default function UsersTable({ users, isLoading, isError, onRetry }: Props) {
  const { user: me } = useAuth();
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [toggleTarget, setToggleTarget] = useState<User | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);

  if (isError) {
    return (
      <div className="flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 p-4">
        <span className="text-sm text-destructive">Failed to load users.</span>
        <Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-[80px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
            )}
            {!isLoading && users.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No users</TableCell></TableRow>
            )}
            {!isLoading && users.map((u) => {
              const isSelf = me?.id === u.id;
              return (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.email}</TableCell>
                  <TableCell>{u.name}</TableCell>
                  <TableCell><Badge variant={u.role === 'ADMIN' ? 'default' : 'secondary'}>{u.role}</Badge></TableCell>
                  <TableCell><Badge variant={u.isActive ? 'default' : 'outline'}>{u.isActive ? 'Active' : 'Disabled'}</Badge></TableCell>
                  <TableCell>{new Date(u.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" disabled={isSelf}>…</Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setResetTarget(u)}>Reset password</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setToggleTarget(u)}>
                          {u.isActive ? 'Disable' : 'Enable'}
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(u)}>
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <ResetPasswordDialog user={resetTarget} onOpenChange={() => setResetTarget(null)} />
      <ToggleActiveConfirm user={toggleTarget} onOpenChange={() => setToggleTarget(null)} />
      <DeleteUserConfirm user={deleteTarget} onOpenChange={() => setDeleteTarget(null)} />
    </>
  );
}
```

### Task 14 — CreateUserDialog

**Files (create):** `client/src/pages/admin/CreateUserDialog.tsx`.

- [ ] **Step 14.1**

```tsx
// client/src/pages/admin/CreateUserDialog.tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import useHttpClient from '@/hooks/useHttpClient';
import { createUser } from '@/api/admin.api';
import { normalizeHttpError } from '@/lib/http-error';

const schema = z.object({
  email: z.string().email(),
  name: z.string().min(1, 'Name is required').max(120),
  initialPassword: z.string().min(8, 'Min 8 characters'),
});
type Values = z.infer<typeof schema>;

export default function CreateUserDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', name: '', initialPassword: '' },
  });
  const { execute, isLoading } = useHttpClient({ fn: createUser });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await execute(values);
      toast.success(`User ${values.email} created`);
      await qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      await qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
      form.reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(normalizeHttpError(e).message);
    }
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) form.reset(); onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create user</DialogTitle>
          <DialogDescription>
            You set the initial password. Share it with the new user out-of-band; they can change it after signing in.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl><Input type="email" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="initialPassword" render={({ field }) => (
              <FormItem>
                <FormLabel>Initial password</FormLabel>
                <FormControl><Input type="text" autoComplete="new-password" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={isLoading}>{isLoading ? 'Creating…' : 'Create'}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

### Task 15 — ResetPasswordDialog

**Files (create):** `client/src/pages/admin/ResetPasswordDialog.tsx`.

- [ ] **Step 15.1**

```tsx
// client/src/pages/admin/ResetPasswordDialog.tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { User } from '@/api/types';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import useHttpClient from '@/hooks/useHttpClient';
import { resetPassword } from '@/api/admin.api';
import { normalizeHttpError } from '@/lib/http-error';

const schema = z.object({ newPassword: z.string().min(8, 'Min 8 characters') });
type Values = z.infer<typeof schema>;

export default function ResetPasswordDialog({
  user, onOpenChange,
}: { user: User | null; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { newPassword: '' } });
  const { execute, isLoading } = useHttpClient({ fn: resetPassword });

  const onSubmit = form.handleSubmit(async (values) => {
    if (!user) return;
    try {
      await execute(user.id, values);
      toast.success(`Password reset for ${user.email}`);
      await qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      form.reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(normalizeHttpError(e).message);
    }
  });

  return (
    <Dialog open={!!user} onOpenChange={(v) => { if (!v) form.reset(); onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>{user?.email}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <FormField control={form.control} name="newPassword" render={({ field }) => (
              <FormItem>
                <FormLabel>New password</FormLabel>
                <FormControl><Input type="text" autoComplete="new-password" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={isLoading}>{isLoading ? 'Saving…' : 'Reset password'}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

### Task 16 — ToggleActiveConfirm

**Files (create):** `client/src/pages/admin/ToggleActiveConfirm.tsx`.

- [ ] **Step 16.1**

```tsx
// client/src/pages/admin/ToggleActiveConfirm.tsx
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { User } from '@/api/types';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import useHttpClient from '@/hooks/useHttpClient';
import { setActive } from '@/api/admin.api';
import { normalizeHttpError } from '@/lib/http-error';

export default function ToggleActiveConfirm({
  user, onOpenChange,
}: { user: User | null; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const { execute, isLoading } = useHttpClient({ fn: setActive });
  const next = user ? !user.isActive : true;

  const handleConfirm = async () => {
    if (!user) return;
    try {
      await execute(user.id, { isActive: next });
      toast.success(`${user.email} ${next ? 'enabled' : 'disabled'}`);
      await qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      await qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
      onOpenChange(false);
    } catch (e) {
      toast.error(normalizeHttpError(e).message);
    }
  };

  return (
    <AlertDialog open={!!user} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{next ? 'Enable' : 'Disable'} {user?.email}?</AlertDialogTitle>
          <AlertDialogDescription>
            {next
              ? 'The user will be able to log in again.'
              : 'The user will be unable to log in until re-enabled.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={isLoading} onClick={handleConfirm}>
            {isLoading ? 'Saving…' : next ? 'Enable' : 'Disable'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

### Task 17 — DeleteUserConfirm

**Files (create):** `client/src/pages/admin/DeleteUserConfirm.tsx`.

- [ ] **Step 17.1**

```tsx
// client/src/pages/admin/DeleteUserConfirm.tsx
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { User } from '@/api/types';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import useHttpClient from '@/hooks/useHttpClient';
import { deleteUser } from '@/api/admin.api';
import { normalizeHttpError } from '@/lib/http-error';

export default function DeleteUserConfirm({
  user, onOpenChange,
}: { user: User | null; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [typed, setTyped] = useState('');
  const { execute, isLoading } = useHttpClient({ fn: deleteUser });

  const canDelete = user && typed === user.email;

  const handleConfirm = async () => {
    if (!user) return;
    try {
      await execute(user.id);
      toast.success(`Deleted ${user.email}`);
      await qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      await qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
      setTyped('');
      onOpenChange(false);
    } catch (e) {
      toast.error(normalizeHttpError(e).message);
    }
  };

  return (
    <AlertDialog open={!!user} onOpenChange={(v) => { if (!v) setTyped(''); onOpenChange(v); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {user?.email}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the user and their audit log entries cannot be undone. Type the user's email to confirm.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="confirm-email">Email</Label>
          <Input id="confirm-email" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!canDelete || isLoading}
            onClick={handleConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isLoading ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

### Orchestrator step — Typecheck + build + commit Cluster 5

```bash
cd "C:/Users/yosefh/OneDrive - hms.co.il/Desktop/Clearance/client"
npm run typecheck
npm run build
git add src/pages/admin
git commit -m "feat(admin): users page with stats, list, create/reset/toggle/delete dialogs"
```

Both typecheck and build must exit 0 before commit.

---

## Cluster 6 — Final smoke + submodule bump + push (sequential)

### Task 18 — Final manual smoke

- [ ] **Step 18.1** — Start server (user) + client dev

```bash
cd "C:/Users/yosefh/OneDrive - hms.co.il/Desktop/Clearance/client"
npm run dev
```

- [ ] **Step 18.2** — Execute full smoke checklist

1. Visit `/` (logged out) → redirects to `/login`.
2. Log in with seeded admin. Land on `/`.
3. Navigate to `/admin/users` via TopBar. Table + 3 stats cards render.
4. Click "Create user" → dialog opens. Submit with a real email+name+password ≥ 8 chars. Toast "created". New row appears. Stats update.
5. On the new row's `…` menu → "Reset password" → enter a new password ≥ 8 chars → save → toast.
6. On same row → "Disable" → confirm → status badge flips to "Disabled".
7. On same row → "Enable" → confirm → status flips back.
8. On same row → "Delete" → type wrong email (button disabled), type correct email (button enables), confirm → row disappears. Stats decrement.
9. On the admin's own row, the `…` menu button is disabled.
10. Log out from user menu → `/login`. Hit `/admin/users` directly → redirects to `/login`.
11. Log in as a non-admin (create one via the admin flow first if needed) → hitting `/admin/users` → redirects to `/403`.

- [ ] **Step 18.3** — Stop dev server. No commit yet.

### Task 19 — Bump client submodule in main repo + Phase Status

**Files:**
- Modify (in main repo): client submodule pointer
- Modify (in main repo): `docs/vault/00-Index/Phase Status.md` if anything needs updating at this milestone (still `in-progress`; will flip to `in-review` on PR open, so leave as-is now)

- [ ] **Step 19.1** — Push client phase-1b branch

```bash
cd "C:/Users/yosefh/OneDrive - hms.co.il/Desktop/Clearance/client"
git log --oneline -10
git push -u origin feat/buildcheck-phase-1b
```

Expected: branch published.

- [ ] **Step 19.2** — Bump submodule pointer in main repo

```bash
cd "C:/Users/yosefh/OneDrive - hms.co.il/Desktop/Clearance"
git add client
git status --short
```

Expected: one staged change `M client` showing the new pointer.

- [ ] **Step 19.3** — Commit the bump

```bash
git commit -m "chore(submodule): bump client to phase 1b auth UI"
```

- [ ] **Step 19.4** — Push main repo phase-1b branch

```bash
git push -u origin feat/buildcheck-phase-1b
```

### Task 20 — Open PRs + flip Phase Status to in-review

- [ ] **Step 20.1** — Open client submodule PR (target: `feat/buildcheck-redesign`)

```bash
cd "C:/Users/yosefh/OneDrive - hms.co.il/Desktop/Clearance/client"
gh pr create --base feat/buildcheck-redesign --head feat/buildcheck-phase-1b --title "feat(auth): phase 1b client auth UI" --body "$(cat <<'EOF'
## Summary
- Adds login page, `/me`-backed `AuthContext`, protected + admin route gates
- Adds full-CRUD admin users page (list + stats + create + reset password + toggle active + delete)
- Introduces react-router v7, @tanstack/react-query, react-hook-form + zod, axios, sonner
- Adds required shadcn primitives (button/input/form/table/dialog/alert-dialog/dropdown-menu/badge/sonner)

## Test plan
- [x] `npm run typecheck` passes
- [x] `npm run build` passes
- [x] Manual smoke: login/logout, protected redirect, admin create/reset/toggle/delete, 403 for non-admin

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 20.2** — Open main repo PR (target: `integration/buildcheck`)

```bash
cd "C:/Users/yosefh/OneDrive - hms.co.il/Desktop/Clearance"
gh pr create --base integration/buildcheck --head feat/buildcheck-phase-1b --title "feat: phase 1b — client auth UI (submodule bump)" --body "$(cat <<'EOF'
## Summary
- Bumps client submodule to the phase-1b tip (client auth UI)
- Adds Phase 1b design spec
- Transitions Phase Status 1b → in-review

## Test plan
- [x] Client submodule PR passes CI
- [ ] Review design spec + code against the spec

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 20.3** — Update Phase Status → in-review with PR links

Edit `docs/vault/00-Index/Phase Status.md`:
- frontmatter: `current_status: in-review`, `updated: <today>`
- "Current" callout: `status **in-review**`
- Phase 1b row: Status cell → `in-review`, PR cell → `[Clearance#NNN](<url>)` (and client PR as a nested link if useful)

Then:

```bash
git add "docs/vault/00-Index/Phase Status.md"
git commit -m "docs(vault): phase 1b → in-review"
git push
```

---

## Self-review checklist (fill after implementation)

- [ ] Every design spec §1-§9 item maps to at least one task above
- [ ] No `TBD`/`TODO`/placeholder wording
- [ ] All types cross-reference correctly (`User`, `AdminStats`, `ListUsersResponse`)
- [ ] `npm run typecheck` and `npm run build` both exit 0 at final
- [ ] Smoke checklist §18.2 items 1-11 all pass
- [ ] Two PRs opened, Phase Status = in-review
