# Git Branch Workflow — Post-v1 Strategy

**Date:** 2026-04-26
**Status:** Draft — awaiting user review before implementation
**Owner:** repo conventions; supersedes the retired `integration/buildcheck` strategy

## 1. Context

The BuildCheck v1 cut (PR #13) merged `integration/buildcheck` into `main` and ended the long-lived integration-branch strategy. Subsequent work (#14 inline-submodules, #15 monorepo CI/CD, #16 CI artifact path fix, #17 main protection docs) has used a flat one-PR-per-topic model against `main` directly, but no written convention captures the new flow. `CLAUDE.md` says "Git workflow: under review (the long-lived `integration/buildcheck` strategy retired with v1; new strategy TBD)."

Phase 5 (TAVA upload + OCR) is the first phase of the post-v1 redesign and has no branch yet. Before starting, the project needs a documented workflow that:

- Replaces the retired integration-branch model with a phase-direct-to-`main` flow
- Distinguishes phase work from unrelated side work that ships in parallel
- Gives a clean isolation pattern for in-phase sub-tasks without ceremony
- Stays compatible with the `main` branch protection rules (PR-only, linear history, required CI checks, branch-up-to-date-before-merge)
- Reflects the single-collaborator reality (force-push on private branches is safe)

Two stale memory files (`feedback_branch_strategy.md`, `feedback_merge_phase_into_integration.md`) and the `Phase Status.md` page still reference the retired model and must be updated alongside the new convention.

## 2. Decisions (from brainstorm)

| Decision | Choice | Rationale |
|---|---|---|
| Side-work classification | **C** — both A-style (folds into phase PR) and B-style (own PR to main), classified by scope | Matches existing post-v1 practice for unrelated work; gives a clean pattern for in-phase isolation without forcing every sub-task through PR ceremony |
| Phase branch freshness | **A** — rebase onto `main` periodically, force-push-with-lease | Solo collaborator → force-push downside doesn't apply; protection wants linear history, rebase is its natural fit; catches conflicts incrementally |
| Phase PR merge style | **C** — per-phase choice, default squash | Squash for tight phases keeps `main` log high-signal; rebase preserved as escape hatch for sprawling phases (e.g., 4a/4b/4c-style) where granular history is worth the noise |
| Side-branch prefix (local-only scratchpads) | `wip/` | Signals "never push this"; if a `wip/` branch ever wants to be pushed, that is a smell saying it should have been a B-style PR instead |
| Phase PR opened as | Draft, early | Gets CI on every push; communicates intent to anyone watching the repo; converts to "ready for review" when phase is done |
| Strategy doc location | **A** — inline in `CLAUDE.md` | Auto-loaded into agent context; lives next to existing "main branch protection" section; workflow is short enough to inline |

## 3. Branch taxonomy

Three branch types, distinguished by lifecycle and review.

### 3.1 Phase branches — `feat/<project>-phase-N`

Examples: `feat/buildcheck-phase-5`, `feat/buildcheck-phase-6`.

- **Created off:** `main` (always from clean, pulled `main` tip)
- **Pushed to:** `origin` (remote)
- **Cardinality:** one per phase
- **Tracking:** `Phase Status.md` row updated when branch is created
- **PR target:** `main`
- **PR opened as:** draft, early — first push triggers a draft PR via `gh pr create --draft`
- **Sync to main:** rebase onto `origin/main` at clean checkpoints (end of a sub-task, never mid-edit), `git push --force-with-lease`. Never plain `--force`.
- **Merge style:** squash (default) or rebase (per-phase choice). Squash for tight, single-concern phases; rebase for sprawling phases where the granular sub-task history is worth preserving on `main`.
- **Lifecycle end:** GitHub merges PR → deletes remote branch → locally `git branch -D feat/<project>-phase-N`. `Phase Status.md` updated to `merged` and `current_phase` bumped.

### 3.2 Side PRs — `<type>/<topic>`

Examples: `fix/sidecar-timeout`, `chore/dep-bumps`, `docs/api-index`.

For work that is **independent of any phase**: CI tweaks, unrelated bug fixes, doc updates, dep bumps, refactors, infrastructure. Same pattern as existing post-v1 PRs (#15, #16, #17).

- **Created off:** `main`
- **Pushed to:** `origin`
- **PR target:** `main`
- **Lifecycle:** PR → review → merge → delete remote + local
- **NOT tracked in `Phase Status.md`** — `git log main` and the GitHub PR list cover them
- **Interaction with active phase:** if a side PR lands while a phase is in flight, the phase branch rebases onto the new `main` tip at its next checkpoint

**Test for B vs A (next section):** "Would this make sense to merge to `main` without the phase being done?" If yes → side PR. If no → working scratchpad.

### 3.3 Working scratchpads — `wip/phase-N-<topic>`

Examples: `wip/phase-5-tava-pdf-extractor`, `wip/phase-6-claude-prompt-experiment`.

For sub-tasks **inside a phase** that benefit from local isolation — a tricky refactor, a parallel exploration, an experiment that might be thrown away.

- **Created off:** the current phase branch tip
- **Pushed to:** nowhere — local only
- **PR target:** none — no review, no separate CI
- **Merge back:** `git merge --ff-only` or `git rebase` into the phase branch when done
- **Lifecycle end:** `git branch -D wip/phase-N-<topic>` after merge-back
- **Commits ride along** in the phase PR's diff

The `wip/` prefix is the signal "never push this." If the work outgrows scratchpad scope and warrants its own review, promote it to a side PR (B-style) instead of pushing the `wip/` branch.

## 4. Phase lifecycle (mechanics)

### 4.1 Start phase N

```bash
git checkout main && git pull
git checkout -b feat/<project>-phase-N
# first commit on the branch updates Phase Status.md
git push -u origin feat/<project>-phase-N
gh pr create --draft --base main \
  --title "feat: phase N — <name>" \
  --body "<see PR template / spec link>"
```

`Phase Status.md` updates in the first commit on the phase branch:
- frontmatter `current_phase` = N, `current_status` = `in-progress`, `updated` = today
- log row updated (Status → `in-progress`, Branch → `feat/<project>-phase-N`, PR → draft URL)
- "Current" callout rewritten

### 4.2 During phase N

Direct commits on the phase branch, or via local `wip/phase-N-<topic>` scratchpads merged back. When `main` advances meaningfully (a side PR lands), at the next clean checkpoint:

```bash
git fetch
git rebase origin/main
git push --force-with-lease
```

Always `--force-with-lease`, never `--force`. Lease protects against unexpectedly losing commits if something else pushed to the phase branch (e.g., a GitHub web edit).

When the phase moves to PR review:
- `Phase Status.md` log row: Status → `in-review`

### 4.3 Land phase N

```bash
git fetch
git rebase origin/main          # one final rebase
git push --force-with-lease
gh pr ready                     # draft → ready for review
```

Wait for: CI green + branch up-to-date confirmed (branch protection enforces both before merge).

Choose merge style for this phase:
- **Squash** (default): `gh pr merge --squash --delete-branch`
- **Rebase** (sprawling phase, granular history worth preserving on `main`): `gh pr merge --rebase --delete-branch`

Locally:
```bash
git checkout main && git pull
git branch -D feat/<project>-phase-N
```

`Phase Status.md` updates (small follow-up commit on `main`, or fold into the phase PR before merging — per phase):
- frontmatter `current_phase` bumped to N+1, `current_status` = `not-started`
- log row N: Status → `merged`, PR link finalized
- "Current" callout updated to point at phase N+1

## 5. Side PR lifecycle (during or between phases)

```bash
git checkout main && git pull
git checkout -b <type>/<topic>
# commit
git push -u origin <type>/<topic>
gh pr create --base main --title "<type>: <description>" --body "..."
# review → merge → delete
```

After merge: `git checkout main && git pull && git branch -D <type>/<topic>`.

If a phase is in flight, the phase branch rebases onto the new `main` tip at its next checkpoint (per §4.2). No coordination needed beyond that.

## 6. Working scratchpad lifecycle (inside a phase)

```bash
# starting from feat/buildcheck-phase-5
git checkout -b wip/phase-5-tava-pdf-extractor
# ... work, experiment, throw away if needed

# when done:
git checkout feat/buildcheck-phase-5
git merge --ff-only wip/phase-5-tava-pdf-extractor
# (or `git rebase wip/phase-5-tava-pdf-extractor` if a clean rebase is preferred)
git branch -D wip/phase-5-tava-pdf-extractor
```

If the scratchpad cannot fast-forward (because the phase branch advanced in the meantime), rebase the scratchpad onto the phase tip first, then ff-merge.

If the work outgrows scratchpad scope (separate concern, useful on its own), promote to a side PR (§5) instead of pushing the `wip/` branch.

## 7. `Phase Status.md` updates

The page currently references retired concepts. Replace as follows.

**Frontmatter changes:**
- Remove `integration_branch: integration/buildcheck`
- Keep `current_phase`, `current_status`, `spec`, `updated`, `project`, `tags`, `type`, `title`

**Body changes:**
- Remove the line "Integration branch: `integration/buildcheck` (long-lived, off `main`)"
- Remove the line "Per-phase PRs target the integration branch; a single final PR merges integration → main at v1"
- Add a one-line pointer to the new branch workflow doc location (CLAUDE.md "Branch workflow" section)

**Status values** — replace with:
- `not-started` — next up, no branch yet
- `in-progress` — branch + draft PR exist, commits landing
- `in-review` — PR converted to ready-for-review on `main`
- `merged` — PR squash- or rebase-merged into `main`, branch deleted

(Drops `shipped` — was only for the integration → main cut at v1, no longer applicable.)

**Phase log columns** — unchanged (`#`, `Phase`, `Status`, `Branch`, `PR`, `Notes`); the "PR" column now references `main`-targeting PRs directly.

**Side PRs** — not tracked here. `git log main` and the GitHub PR list cover them.

## 8. Memory cleanup

Two memory files reference the retired strategy and must be updated.

- `feedback_branch_strategy.md` — **rewrite**. Drop integration-branch language; replace with the new flow (phase → main directly; B-style side PRs in parallel; A-style `wip/` scratchpads inside a phase). Preserve the "Why" framing (CLAUDE.md requires PR review + CI, so direct commits to `main` are blocked) and the original-incident pointer (Phase 1a → main retarget on 2026-04-19).
- `feedback_merge_phase_into_integration.md` — **delete**. The flow it describes (merge phase PR into `integration/buildcheck` before starting next phase) no longer exists.

`MEMORY.md` index — drop the `feedback_merge_phase_into_integration.md` line; update the `feedback_branch_strategy.md` description to match the rewrite.

## 9. `CLAUDE.md` update

Add a new "Branch workflow" subsection under "Conventions", placed after the existing "`main` branch protection" subsection. Contents (condensed from §3 + §4):

- Phase branches `feat/<project>-phase-N`: off `main`, draft PR early, rebase-onto-main at checkpoints with `--force-with-lease`, squash or rebase merge per phase, deleted on merge
- Side PRs `<type>/<topic>`: off `main`, own PR to `main`, deleted on merge — for any work independent of a phase
- Working scratchpads `wip/phase-N-<topic>`: local only, never pushed, folded into phase via ff-merge or rebase, deleted after — for in-phase isolation; if it wants to be pushed, promote to a side PR instead
- Sync rule: phase branches rebase onto `origin/main` at clean checkpoints (force-push-with-lease, never plain `--force`)
- Pointer to this spec for the long-form rationale

Also update the "BuildCheck redesign" section's "Git workflow" line: replace `under review (... TBD)` with `see "Branch workflow" above`.

## 10. Implementation summary

Files changed by this spec's implementation:

| File | Change |
|---|---|
| `CLAUDE.md` | Add "Branch workflow" subsection; update BuildCheck "Git workflow" line |
| `docs/vault/00-Index/Phase Status.md` | Frontmatter trim, body rewrite, status values, pointer to CLAUDE.md |
| `~/.claude/projects/.../memory/feedback_branch_strategy.md` | Rewrite for new flow |
| `~/.claude/projects/.../memory/feedback_merge_phase_into_integration.md` | Delete |
| `~/.claude/projects/.../memory/MEMORY.md` | Drop deleted entry; update branch-strategy description |

No code changes. All work is documentation + memory hygiene.

## 11. Out of scope

- Multi-collaborator workflow rules (force-push etiquette, PR approval requirements, dismiss-stale-reviews) — defer until a second collaborator is added; CLAUDE.md already flags this transition
- Hotfix-on-main process (e.g., fixing a bug discovered post-merge that needs to ship immediately, mid-phase) — covered implicitly by side PR (§5); no special "hotfix" branch type needed
- Release tagging / versioning conventions — not currently practiced; out of scope
- Cross-repo workflows — submodules were inlined in PR #14; the strategy is single-repo only
