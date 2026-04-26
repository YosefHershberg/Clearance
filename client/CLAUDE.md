# Clearance — Client

## Stack
- React 18, Vite, TypeScript
- React Router for routing
- TanStack Query for server state
- Vitest + Testing Library for unit tests
- Playwright for e2e tests

## Conventions
- Components go in src/components/
- Pages go in src/pages/
- API calls go in src/api/
- Use named exports for components
- No default exports except for pages

## Docker

The Dockerfile is **thin** — it only packages the pre-built `dist/` into an nginx image. Vite builds on the GitHub Actions runner.

To build locally you must build first:

```bash
npm ci
npm run build
docker build -t clearance-client .
docker run --rm -p 8080:80 clearance-client
```

SPA routing is handled in `nginx.conf` (fallback to `index.html`).

CI/CD lives in `.github/workflows/ci-cd.yml`. On push to `main` (and `v*.*.*` tags) it runs `test` → `docker` (build & push).
Image: `<DOCKERHUB_USERNAME>/clearance-client`.
Required repo secrets: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`.

## Knowledge Vault
Client-side docs live in the repo-wide Obsidian vault at `../docs/vault/`.

- Client MOC: `../docs/vault/00-Index/Client MOC.md`
- Component pages: `../docs/vault/20-Client/components/`
- API client: `../docs/vault/20-Client/api-client/Client API Client.md`
- Update the matching vault page when you add/change components, routes, or the API client
