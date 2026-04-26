# Clearance

## Architecture
Full-stack monorepo:
- `client/` — frontend (React + Vite + TypeScript)
- `server/` — backend (Node.js + Express + TypeScript)
- `sidecar/` — Python sidecar (FastAPI) for the DXF/PDF pipeline

## Conventions
- Use conventional commits: feat:, fix:, chore:, docs:
- Never commit secrets or .env files
- settings.local.json is gitignored (personal Claude overrides only)

### `main` branch protection (enforced on GitHub, including admins)
- Direct pushes to `main` are blocked — all changes ship via PR.
- Required status checks (must pass and branch must be up-to-date with `main`): `client · test`, `server · test (unit)`, `server · integration`, `sidecar · test`.
- Linear history required — use squash or rebase merges; merge commits are rejected.
- Force pushes and branch deletion are blocked.
- All PR conversations must be resolved before merge.
- **Approving reviews are not yet required** because the repo currently has a single collaborator (GitHub disallows self-approval). When a second reviewer is added, flip `required_approving_review_count` to `1` (and consider `dismiss_stale_reviews: true`) on the `main` protection rule.

### Branch workflow
Three branch types, all targeting `main`. Long-form rationale: `docs/superpowers/specs/2026-04-26-git-branch-workflow-design.md`.

- **Phase branches** — `feat/<project>-phase-N` (e.g., `feat/buildcheck-phase-5`). Off `main`, pushed to `origin`, draft PR opened early via `gh pr create --draft --base main` (gets CI on every push). Rebase onto `origin/main` at clean checkpoints (end of sub-task, never mid-edit) with `git push --force-with-lease` — never plain `--force`. When ready, `gh pr ready`, then squash-merge by default or rebase-merge for sprawling phases worth preserving as granular history. Delete remote + local on merge. Update `docs/vault/00-Index/Phase Status.md` on every transition.
- **Side PRs** — `<type>/<topic>` (e.g., `fix/...`, `chore/...`, `docs/...`). For any work independent of a phase: CI tweaks, unrelated bugs, doc updates, dep bumps. Off `main`, own PR to `main`, deleted on merge. May land while a phase is in flight; the phase branch rebases onto the new `main` tip at its next checkpoint. Not tracked in `Phase Status.md`.
- **Working scratchpads** — `wip/phase-N-<topic>`. Local only, never pushed. For sub-tasks inside a phase that benefit from isolation (tricky refactor, parallel exploration, throwaway experiment). Branched off the phase branch, ff-merged or rebased back when done, then `git branch -D`'d. Commits ride along in the phase PR. The `wip/` prefix signals "never push" — if it wants to be pushed, promote to a side PR instead.

The B-vs-A test for in-phase work: *"Would this make sense to merge to `main` without the phase being done?"* Yes → side PR. No → working scratchpad.

## Running and validating the dev stack
`DEVELOPMENT.md` (repo root) is the agent's operational guide for the local stack — read it before:
- Running the dev servers (`docker compose` flow, detached + background log tail — never foreground `up`).
- Debugging via logs (`docker compose logs -f` patterns, `server/logs/*.log` files).
- Validating client/UI changes end-to-end via the Claude in Chrome MCP tools against `http://localhost:5173`.
- Reproducing pipeline issues with `dummy_data/` fixtures.

## Knowledge Vault
An Obsidian knowledge graph lives at `docs/vault/`. Use it as the first stop for architecture, request lifecycle, API index, and end-to-end flows — it's kept in sync with the code and structured for cross-linking.

- Start at `docs/vault/00-Index/Home.md` (MOCs for Architecture, Client, Server, API, Data, Flows)
- When changing behavior, update the relevant vault page in the same PR
- Use the `obsidian:obsidian-markdown` skill for wikilinks/callouts/frontmatter and `obsidian:obsidian-cli` for vault queries

## BuildCheck redesign
A ground-up redesign of the app is in progress, broken into ~10 phases. v1 (phases 0–4c + design-system port) shipped to `main`; phases 5–10 are still planned. Always start by checking current phase state before proposing work.

- **Current phase + status:** `docs/vault/00-Index/Phase Status.md` — single source of truth; check first, update on every transition
- **Spec:** `docs/superpowers/specs/2026-04-19-buildcheck-full-redesign.md` (§13 = phase breakdown)
- **Git workflow:** see "Branch workflow" above. Each phase ships as a single `feat/buildcheck-phase-N` PR straight to `main`.
- **When a phase transitions** (branch created, PR opened, PR merged, next phase picked up): update `Phase Status.md` in the same commit.
