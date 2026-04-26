# Clearance — Server

## Commands

```bash
npm run dev          # nodemon + tsx (watch mode)
npm run build        # prisma generate + tsc → dist/
npm start            # node dist/src/index.js (production)
npm test             # Jest (unit tests)
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint with auto-fix
```

## Docker

The Dockerfile is **thin** — it only packages pre-built artifacts. All `npm ci`, `tsc`, `prisma generate`, and tests run on the GitHub Actions runner.

To build locally you must build first:

```bash
npm ci
npm run build
npm ci --omit=dev   # fresh prod-only node_modules
docker build -t clearance-server .
docker run --rm -p 3001:3001 --env-file .env clearance-server
```

CI/CD lives in `.github/workflows/ci-cd.yml`. On push to `main` (and `v*.*.*` tags) it runs `test` → `integration` → `docker` (build & push).
Image: `yosefhershberg/clearance-server` (Docker Hub).
Required repo secrets: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` (Docker Hub access token, not password).

Branch protection on `main` requires the `test (20.x)` and `integration` checks to pass.

**CI quirk:** `prisma.config.ts` calls `env("DIRECT_URL")` at load time, so any CI step that runs `prisma generate` must pass a dummy `DIRECT_URL` (a URL-shaped placeholder — `generate` doesn't connect). See [[../docs/vault/10-Architecture/Build and Deploy#Known CI quirk — DIRECT_URL]].

## Architecture

**Layered/Clean Architecture:**
```
Controller → Service → Data Access (*.da.ts) → PostgreSQL (Prisma)
```

Each request flows through:
1. Morgan + Helmet + CORS + Rate limiter
2. `express.json()` body parser
3. Zod `validate()` middleware (per route)
4. Controller → Service → Data Access

**Key Directories:**
- `src/api/controllers/` — HTTP handlers (req/res logic only)
- `src/api/services/` — Business logic
- `src/api/data-access/` — Prisma queries (`*.da.ts`)
- `src/api/routes/` — Express route definitions
- `src/api/schemas/` — Zod validation schemas
- `src/api/webhooks/` — Webhook handlers (bypass auth)
- `src/config/` — External clients (Prisma, logger, rate limiter)
- `src/lib/` — Shared classes (HttpError)
- `src/types/` — TypeScript type definitions
- `src/utils/` — Env validation, helper functions

**File naming conventions:**
- Routes: `<domain>.routes.ts`
- Controllers: `<domain>.controller.ts`
- Services: `<domain>.service.ts`
- Data access: `<domain>.da.ts`
- Schemas: `<domain>.schema.ts`

## Database

**PostgreSQL via Prisma v7 with PrismaPg driver adapter.**

Schema in `prisma/schema.prisma`. Generated client outputs to `src/generated/prisma/` (gitignored — regenerated at build time via `npx prisma generate`).

Prisma config in `prisma.config.ts` — uses `DATABASE_URL` (pooler) for runtime, `DIRECT_URL` (direct) for migrations.

```bash
npm run db:generate   # generate Prisma client
npm run db:migrate    # run migrations
npm run db:push       # push schema without migration
npm run db:studio     # open Prisma Studio
npm run db:seed       # seed data
npm run db:reset      # reset database
```

## Validation Pattern

All routes use Zod schemas with `validate()` middleware:

```typescript
router.post('/create', validate(createSchema), createHandler);
```

Schemas validate `{ body, query, params }` together.

**Error response format:**
```json
{ "error": "Invalid data", "details": [{ "message": "field is Invalid" }] }
```

## Environment Variables

Validated at startup via Zod in `src/utils/env.ts`. Server fails fast if any are missing.

Required: `PORT`, `DATABASE_URL`, `CORS_ORIGIN`

Not validated by env.ts (read directly from `process.env`): `DIRECT_URL` (Prisma migrations)

## Conventions

- Use conventional commits: `feat:`, `fix:`, `chore:`, `docs:`
- Never commit secrets or `.env` files
- All endpoints return `{ data }` or `{ error }` format
- Controllers handle HTTP concerns only — delegate logic to services
- Services contain business logic — delegate DB queries to data-access
- Data-access files are the only layer that touches Prisma directly
- The Prisma schema is the single source of truth for DB model types

## Testing

Jest + ts-jest for unit tests. Separate config (`jest.integration.config.js`) for integration tests.

```bash
npm test                    # unit tests
npm run test:integration    # integration tests
```

## Knowledge Vault
Server-side docs live in the repo-wide Obsidian vault at `../docs/vault/`.

- Server MOC: `../docs/vault/00-Index/Server MOC.md`
- API MOC (every endpoint): `../docs/vault/00-Index/API MOC.md` + `../docs/vault/35-API/`
- Data MOC (Prisma schema, DB): `../docs/vault/00-Index/Data MOC.md` + `../docs/vault/40-Data/`
- Flows (auth, request lifecycle): `../docs/vault/50-Flows/`, `../docs/vault/10-Architecture/Request Lifecycle.md`
- Update the matching vault page when you add/change routes, controllers, services, middleware, or schema
