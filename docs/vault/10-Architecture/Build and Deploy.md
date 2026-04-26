---
title: Build and Deploy
type: doc
layer: shared
tags:
  - architecture
  - build
  - ci-cd
source:
  - client/package.json
  - server/package.json
  - server/.github/workflows/ci-cd.yml
  - client/.github/workflows/ci-cd.yml
  - server/Dockerfile
  - client/Dockerfile
---

# Build and Deploy

## Client scripts ([client/package.json](../../../client/package.json))

| Script | Command | Notes |
| --- | --- | --- |
| `dev` | `vite` | Vite dev server |
| `build` | `tsc -b && vite build` | Type-check then bundle |
| `preview` | `vite preview` | Serve `dist/` |
| `lint` | `eslint .` | |
| `typecheck` | `tsc --noEmit` | |
| `test` | `vitest run` | |
| `test:e2e` | `playwright test` | No Playwright dep installed yet — flag |

## Server scripts ([server/package.json](../../../server/package.json))

| Script | Command | Notes |
| --- | --- | --- |
| `dev` | `nodemon src/index.ts` | |
| `start` | `node dist/src/index.js` | Production entrypoint — expects prior `build` |
| `start:test` | `NODE_ENV=test node dist/src/index.js` | Expects prior `build` |
| `build` | `tsc` | |
| `typecheck` | `tsc --noEmit` | |
| `test` | `jest` | Unit tests (ts-jest preset) |
| `test:integration` | `jest --config jest.integration.config.js` | Integration tests |

## CI/CD

Each submodule has a single `ci-cd.yml` workflow:

- [server/.github/workflows/ci-cd.yml](../../../server/.github/workflows/ci-cd.yml) — `test` → `integration` → `docker` (Docker Hub push) · **live**
- [client/.github/workflows/ci-cd.yml](../../../client/.github/workflows/ci-cd.yml) — `test` → `docker` (Docker Hub push) · **staged, not yet pushed**

### Division of labor

All Node work (`npm ci`, lint, typecheck, test, `tsc`, `prisma generate`, `vite build`) runs on the GHA runner. Dockerfiles are thin — they only `COPY` pre-built artifacts (`dist/`, prod-only `node_modules`, generated Prisma client) into the final image. No `npm ci` or compilation inside `docker build`.

### Triggers

- `pull_request` → test + integration only
- `push` to `main` or `v*.*.*` tag → full pipeline including Docker push
- `workflow_dispatch` → manual re-run

### Jobs (server)

```mermaid
graph LR
    test[test<br/>npm ci · prisma generate · lint · typecheck · jest · tsc]
    integ[integration<br/>postgres service · jest --passWithNoTests]
    docker[docker<br/>download artifact · npm ci --omit=dev · buildx · push]
    test --> docker
    integ --> docker
```

The `test` job uploads `dist/`, `src/generated/`, `prisma/`, and lockfiles as an artifact. The `docker` job downloads that artifact, runs `npm ci --omit=dev` for the prod `node_modules`, then builds the thin image.

### Images published

- `yosefhershberg/clearance-server` — **live** on Docker Hub
- `yosefhershberg/clearance-client` — pending

Tags produced by [docker/metadata-action](https://github.com/docker/metadata-action):

| Tag | When |
| --- | --- |
| `latest` | push to default branch |
| `main` | push to branch `main` |
| `sha-<shortsha>` | every push |
| `v1.2.3`, `1.2` | on `v*.*.*` semver tags |

### Required repo secrets (per submodule)

| Secret | Purpose |
| --- | --- |
| `DOCKERHUB_USERNAME` | Docker Hub login (plain username, no path) |
| `DOCKERHUB_TOKEN` | Docker Hub personal access token with Read/Write/Delete scope |

Set via `gh secret set DOCKERHUB_USERNAME --repo YosefHershberg/Clearance-{server,client}`.

### Branch protection (`Clearance-server` → `main`)

- Required status checks: `test (20.x)`, `integration`
- 1 approving review required
- No force pushes, no deletions
- `docker` job is intentionally **not** required — it only runs on `push` events, never on PRs

### Known CI quirk — DIRECT_URL

[server/prisma.config.ts](../../../server/prisma.config.ts) calls `env("DIRECT_URL")` at config-load time, so `npx prisma generate` throws `PrismaConfigEnvError` in any context without the variable set. Workflow steps that invoke Prisma set a harmless throwaway URL:

```yaml
env:
  DIRECT_URL: postgresql://dummy:dummy@localhost:5432/dummy
```

`prisma generate` only reads the schema and never connects, so a URL-shaped placeholder is enough. Real migrations (`prisma migrate deploy`) still need a real `DIRECT_URL` — don't run those in CI without a proper secret.

## Env

Server env is validated at startup by [[env]]. Required: `PORT`, `DATABASE_URL`, `CORS_ORIGIN`.

`DIRECT_URL` is consumed only by [Prisma Config](../30-Server/Prisma%20Config.md) (for migrations) and the CI `prisma generate` steps.
