# B0 — CI + Branch Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub Actions CI workflow that runs the 89-test suite + typecheck + build on every push and PR to `main`, then enable branch protection so `main` cannot be merged into unless the CI is green.

**Architecture:** Single-job GitHub Actions workflow with a Postgres 16 service container (standalone, no Neon in CI). Steps: install with `--frozen-lockfile --ignore-scripts` → typecheck → migrate → build → test. Two pre-install static greps enforce the Mini Shai-Hulud supply chain protocol. Branch protection on `main` enables `enforce_admins=true` so the rules apply to the solo developer too.

**Tech Stack:** GitHub Actions, `pnpm@10.26.1` (pinned via `packageManager` field), Node 24 (matches Vercel prod), Postgres 16 service container, `gh` CLI for the protection config.

**Source spec:** `docs/superpowers/specs/2026-06-03-b0-ci-and-branch-protection-design.md` is the design source of truth. Defer to it on any ambiguity.

---

## Files

| Path | Action | Responsibility |
|---|---|---|
| `.github/workflows/ci.yml` | Create | The CI workflow. Single job named `ci`. |
| Branch protection on `main` | Configure (remote) | Rule set on GitHub via `gh api`. No file in repo. |
| `scripts/_ci-verify-typecheck.ts` | Create temporarily, then delete | Throwaway file with intentional type error to verify the protection blocks failing PRs. Lives only in the disposable verification branch. |

---

## Task 1: Add the CI workflow file

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Confirm starting state on clean `main`**

```bash
git checkout main
git pull --ff-only
git status   # should show: nothing to commit, working tree clean (ignoring .superpowers/)
```

Expected: branch `main`, working tree clean (the `.superpowers/` untracked directory is fine — the user is gitignoring it on their side; do NOT add it to gitignore in this task).

- [ ] **Step 2: Create the feature branch**

```bash
git checkout -b feat/b0-ci-and-protection
```

Expected: `Switched to a new branch 'feat/b0-ci-and-protection'`.

- [ ] **Step 3: Create `.github/workflows/ci.yml`**

```bash
mkdir -p .github/workflows
```

Write the file `.github/workflows/ci.yml` with this exact content:

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

# Cancela runs en progreso de la misma ref cuando llega un push nuevo.
# Evita gastar minutos en builds obsoletos sin afectar el run final.
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # El nombre del check que GitHub registra para required status checks es la KEY
  # del job ("ci" en este caso), no el `name:` del workflow.
  # No agregamos `name: ci` adentro del job porque sería redundante y agrega
  # ambigüedad si después se agregan más jobs.
  ci:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    # Postgres efímero. Health check garantiza que el step de migrate
    # no se ejecute antes de que el container esté listo.
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: onetable_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd="pg_isready -U postgres"
          --health-interval=5s
          --health-timeout=5s
          --health-retries=10

    env:
      # Connection string al Postgres del service container.
      # NO se usan secrets de Neon — CI corre standalone, sin tocar producción.
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/onetable_test?schema=public
      # AUTH_SECRET dummy de 32 bytes en base64 (formato que documenta auth.ts:22).
      # Generado una sola vez con `openssl rand -base64 32` al cerrar B0; pineado
      # acá para reproducibilidad. NUNCA reusar este valor en otro environment.
      AUTH_SECRET: G0zzCIic/bXamnXRSeYLNL1GIsomqr2u19M/S0PeRZ8=
      AUTH_URL: http://localhost:3000
      # NO se setean DEMO_USER_EMAIL/PASSWORD: scripts/seed.ts:69-70 los tiene
      # hardcoded como constants exportadas, no los lee de process.env. Como
      # tampoco se corre seed en CI y los tests usan sus propios TEST_EMAIL
      # aislados, agregarlos sería superficie inerte.

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      # Static supply-chain checks contra estado commiteado.
      # Corren ANTES de install: si fallan, no se descarga ningún package.
      - name: Verify pinned package versions
        run: |
          if grep -E '"[\^~]' package.json; then
            echo "::error::Pins flexibles (^ o ~) en package.json. Protocolo Mini Shai-Hulud requiere pins exactos."
            exit 1
          fi
          echo "OK pins exact"

      - name: Check lockfile for Mini Shai-Hulud tokens
        run: |
          if grep -E "tanstack|squawk|uipath|mistral|cap-js|intercom-client|router_init|setup\.mjs|router_runtime" pnpm-lock.yaml | grep -v lightningcss; then
            echo "::error::Lockfile contiene un marker conocido de Mini Shai-Hulud."
            exit 1
          fi
          echo "OK lockfile clean"

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile --ignore-scripts

      - name: Typecheck
        run: pnpm typecheck

      - name: Apply migrations
        run: pnpm prisma migrate deploy

      - name: Build
        run: pnpm build

      - name: Test
        run: pnpm test
```

- [ ] **Step 4: Sanity check the YAML locally**

```bash
cat .github/workflows/ci.yml | head -5
```

Expected output starts with:
```
name: ci

on:
  push:
    branches: [main]
```

If you have `actionlint` installed, also run:
```bash
actionlint .github/workflows/ci.yml 2>&1 || echo "actionlint not installed, skip"
```
Otherwise skip — the next task validates by actually running the workflow on GitHub.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
feat(ci): add github actions workflow for typecheck + build + test

Closes the B0 block of Fase 2 (design: docs/superpowers/specs/2026-06-03-b0-ci-and-branch-protection-design.md).

Single sequential job 'ci' that runs on push:main + pull_request:main:
- 2 pre-install supply-chain greps (pins exact + lockfile tokens)
- pnpm install --frozen-lockfile --ignore-scripts
- typecheck → migrate (postgres:16 service) → build → test (89 tests)

CI standalone: no Neon, no Vercel tokens, no GitHub secrets. AUTH_SECRET is
a fixed dummy generated once for reproducibility (NUNCA reusar en prod).
EOF
)"
```

Expected: one commit added to the branch.

- [ ] **Step 6: Push the branch**

```bash
git push -u origin feat/b0-ci-and-protection
```

Expected: branch pushed, GitHub returns a link to create a PR.

- [ ] **Step 7: Open the PR**

```bash
gh pr create --title "feat(ci): add github actions workflow + prepare branch protection" --body "$(cat <<'EOF'
## Summary

Implementation of B0 (Fase 2) — first half: the CI workflow.

Design source: \`docs/superpowers/specs/2026-06-03-b0-ci-and-branch-protection-design.md\`.

This PR creates \`.github/workflows/ci.yml\`. After this PR merges, GitHub
will have the check \`ci\` registered in its catalog of status checks, which
unblocks the second half of B0: activating branch protection on \`main\`
with \`ci\` as the required check.

The workflow YAML follows the design doc literal. Decisions baked in:
- Single sequential job, single Postgres 16 service container.
- install --frozen-lockfile --ignore-scripts → typecheck → migrate → build → test.
- 2 static supply-chain greps before install (pins + lockfile tokens).
- No \`db:seed\` step (tests are self-contained — see design §7.6).
- Node 24 (matches Vercel prod for project \`onetable\`).
- AUTH_SECRET is a fixed dummy generated with \`openssl rand -base64 32\`,
  pinned in the YAML for reproducibility (never reuse in another env).

## Test plan

- [ ] CI workflow runs successfully on this PR (the workflow tests itself).
- [ ] After merge, verify \`ci\` appears in branch protection status check dropdown.
- [ ] Next: activate branch protection (separate task, no PR).
- [ ] After protection active, verify with a disposable DRAFT PR that breaks CI on purpose.
EOF
)"
```

Expected: PR URL returned. Save it for the next task. If `gh` prompts for browser-based auth or default repo, accept the defaults.

---

## Task 2: Watch the first CI run and iterate to green

**Files:** None (verification only; iteration may modify `.github/workflows/ci.yml`).

- [ ] **Step 1: Watch the run**

```bash
gh pr checks --watch
```

Expected: the `ci` check goes from `pending` → `in_progress` → either `success` or `failure`. Wall-clock ~3-5 min when green.

- [ ] **Step 2: If green, skip to Task 3**

If the check shows `success`, the workflow is correct. Move on.

- [ ] **Step 3: If failed, identify which step failed**

```bash
gh run list --workflow=ci.yml --branch feat/b0-ci-and-protection --limit 1
gh run view --log-failed
```

Expected: the failed step is named in the output. Map to the design doc §8 risks:

| Failed step | Likely cause | Mitigation |
|---|---|---|
| Pre-install greps | A flexible pin or worm token landed in `package.json` / `pnpm-lock.yaml` between design close and impl. Fix the offending pin/dep before continuing. | Update the source manually; don't relax the grep. |
| Setup pnpm / Setup Node | network or version unavailable | Re-run; report if persistent. |
| Install dependencies | lockfile/package.json desync | Run `pnpm install --frozen-lockfile --ignore-scripts` locally to reproduce. Fix sync, commit, push. |
| Typecheck | a real TS error landed | Run `pnpm typecheck` locally to reproduce. Fix, commit, push. |
| Apply migrations | PG service container not ready, or schema/migration conflict | Check the run log for `pg_isready` retries; if PG started OK, then it's a migration issue — reproduce with `pnpm prisma migrate deploy` against a local PG 16 container. |
| Build | Next.js / Prisma client build issue | Run `pnpm build` locally. |
| Test | a real test failure | Run `pnpm test` locally to reproduce; fix, commit, push. |

- [ ] **Step 4: Apply the fix and push**

After each fix:
```bash
git add <modified files>
git commit -m "fix(ci): <one-line description of the fix>"
git push
```

The `concurrency` block in the workflow cancels the previous run; the new push triggers a fresh CI run.

- [ ] **Step 5: Repeat Steps 1-4 until green**

No commit needed here — just iterate.

---

## Task 3: Merge the workflow PR

**Files:** None (remote operation).

- [ ] **Step 1: Confirm the PR is green**

```bash
gh pr checks
```

Expected: the `ci` check shows ✓.

- [ ] **Step 2: Merge the PR**

```bash
gh pr merge --squash --delete-branch
```

Use `--squash` to keep the main history linear (the design doc didn't require linear history as a branch protection rule, but squashing keeps the commit history tidy on `main`).

Expected: PR closed, merged, branch deleted.

- [ ] **Step 3: Verify `main` now has the workflow**

```bash
git checkout main
git pull --ff-only
ls .github/workflows/
```

Expected output:
```
ci.yml
```

- [ ] **Step 4: Wait for the post-merge CI run on `main`**

```bash
gh run list --workflow=ci.yml --branch main --limit 1
```

Expected: a run for the merge commit shows `success`. This is the first time the `ci` check appears under `main`'s context, which is what makes it eligible for the required-check dropdown in branch protection.

If this run fails (it shouldn't if the PR run passed), debug as in Task 2 Step 3, push a fix to a new feature branch and PR it.

---

## Task 4: Activate branch protection on `main`

**Files:** None (remote configuration via `gh api`).

- [ ] **Step 1: Apply branch protection via `gh api`**

```bash
gh api -X PUT repos/SnakeJazzzz/OneTable/branches/main/protection \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["ci"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
EOF
```

Expected: JSON response describing the new protection state. Look for `"enforce_admins": {"enabled": true}` in the output — this is the critical "Do not allow bypassing" toggle from the design doc §3.1.

- [ ] **Step 2: Verify with `gh api` GET**

```bash
gh api repos/SnakeJazzzz/OneTable/branches/main/protection | jq '{required_status_checks, enforce_admins, allow_force_pushes, allow_deletions}'
```

Expected output (the key fields):
```json
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["ci"],
    "checks": [...]
  },
  "enforce_admins": { "enabled": true },
  "allow_force_pushes": { "enabled": false },
  "allow_deletions": { "enabled": false }
}
```

If `enforce_admins.enabled` is not `true`, the rule doesn't apply to the repo admin — re-run Step 1.

- [ ] **Step 3: Spot-check in the GitHub UI**

Open `https://github.com/SnakeJazzzz/OneTable/settings/branches` in the browser. Confirm the rule for `main` is listed, "Require status checks" is on with `ci` as the required check, and "Do not allow bypassing the above settings" is checked.

This is the only step in B0 that's UI-only. The rest is scriptable. Skip if you trust the API.

---

## Task 5: Verify the protection blocks merge with a disposable DRAFT PR

**Files:**
- Create (temporarily): `scripts/_ci-verify-typecheck.ts`

The point of this task is to PROVE the protection works. The verification PR is intentionally broken and never merges.

- [ ] **Step 1: Create the disposable verification branch**

```bash
git checkout main
git pull --ff-only
git checkout -b chore/verify-branch-protection
```

- [ ] **Step 2: Introduce an intentional type error**

Create the file `scripts/_ci-verify-typecheck.ts` with this content (single intentional type error, designed to be obvious and easy to spot):

```typescript
// Throwaway file — exists ONLY to verify that branch protection blocks merge
// when CI fails. Lives in the chore/verify-branch-protection branch and is
// deleted when the disposable verification PR is closed.
//
// Do NOT merge this file into main.

const _typecheckTrap: number = "intentional type error to verify CI blocks merge";
export { _typecheckTrap };
```

This file is picked up by `tsc --noEmit` (per `tsconfig.json` include `**/*.ts`), but NOT by vitest (which only matches `tests/**/*.test.ts`). So `pnpm typecheck` will fail immediately; other steps won't be reached.

- [ ] **Step 3: Confirm locally that typecheck fails**

```bash
pnpm typecheck 2>&1 | tail -5
```

Expected: a non-zero exit with a type error like `Type 'string' is not assignable to type 'number'`.

- [ ] **Step 4: Commit + push**

```bash
git add scripts/_ci-verify-typecheck.ts
git commit -m "chore: intentional type error to verify branch protection (will be closed without merge)"
git push -u origin chore/verify-branch-protection
```

- [ ] **Step 5: Open a DRAFT PR**

```bash
gh pr create --draft --title "chore: verify branch protection (DRAFT — will be closed without merge)" --body "$(cat <<'EOF'
Disposable PR to verify B0's branch protection works correctly.

This PR contains an intentional type error in \`scripts/_ci-verify-typecheck.ts\`
that will cause the CI \`ci\` check to fail. The expected outcome is that the
merge button in this PR is blocked with "Required status check 'ci' failing".

After confirming the block, this PR will be **closed without merging** and
the branch deleted. The intentional error never reaches \`main\`.

If a future incident requires re-verifying branch protection, recreate this
PR by running Task 5 of the B0 implementation plan
(\`docs/superpowers/plans/2026-06-03-b0-ci-and-branch-protection.md\`).
EOF
)"
```

Expected: PR URL returned. Save it.

- [ ] **Step 6: Watch CI fail**

```bash
gh pr checks --watch
```

Expected: the `ci` check goes to `failure` within ~30 seconds (typecheck fails fast — by design, see spec §2 step order rationale).

- [ ] **Step 7: Verify the merge UI is blocked**

Open the PR URL in the browser. Look for the merge box at the bottom. Expected message:

> Required statuses must pass before merging
> The following required status check has not passed: ci

The merge button should be greyed out or labeled "Merge blocked". Crucially, as the repo admin, you should NOT see a "Merge anyway" option — that's the `enforce_admins=true` working.

If the merge button is enabled despite the failing check, re-run Task 4 Step 1 — `enforce_admins` was not set correctly.

- [ ] **Step 8: Close the PR without merging + delete branch**

```bash
gh pr close --delete-branch
```

Expected: PR marked closed, branch deleted both locally and on origin. The intentional error file goes with the branch.

- [ ] **Step 9: Confirm clean state on `main`**

```bash
git checkout main
git pull --ff-only
ls scripts/_ci-verify-typecheck.ts 2>&1
```

Expected:
```
ls: scripts/_ci-verify-typecheck.ts: No such file or directory
```

The temporary file is gone from `main`. B0 is complete.

- [ ] **Step 10: Final sanity check**

```bash
git log --oneline -5
gh api repos/SnakeJazzzz/OneTable/branches/main/protection | jq '.enforce_admins.enabled'
```

Expected:
- The log shows the `feat(ci): ...` commit on `main`.
- The `jq` output is `true`.

---

## Self-review

**Spec coverage (against `docs/superpowers/specs/2026-06-03-b0-ci-and-branch-protection-design.md`):**

| Spec section | Covered in plan |
|---|---|
| §1 Overview + sequence | Task 1-5 follow the exact sequence (workflow first, merge, then protection, then verify). |
| §2 Workflow YAML | Task 1 Step 3 contains the full YAML verbatim. |
| §3 Branch protection settings | Task 4 Step 1 uses the exact `gh api` payload from spec §3.2. |
| §4 Env / secrets | Workflow `env` block in Task 1 Step 3 contains exactly the env vars from spec §4 (no `DEMO_USER_*`, no Neon). |
| §5.1 Implementation flow | Tasks 1-4 cover all 9 steps. |
| §5.2 PR DRAFT verification | Task 5 covers all 5 sub-steps with concrete code (the disposable typecheck-trap file). |
| §6 Verification checklist | Task 5 Step 10 plus the post-task confirmations across all tasks. |
| §7 Out of scope | Plan doesn't expand any §7 item. Good. |
| §8 Risks + mitigations | Task 2 Step 3 maps each failure mode to a mitigation row. |

**Placeholder scan:** Zero TBDs, TODOs, "implement later", or "similar to Task N". All code blocks contain the actual content the engineer needs.

**Type consistency:** The check name `ci` is used consistently across the workflow (`jobs.ci:`), the branch protection payload (`"contexts": ["ci"]`), and verification commands. The file path `.github/workflows/ci.yml` is consistent everywhere. The branch name `feat/b0-ci-and-protection` and the verification branch `chore/verify-branch-protection` are used consistently.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-03-b0-ci-and-branch-protection.md`. Two execution options:

**1. Subagent-Driven (recommended)** — A fresh subagent per task, with review checkpoints between tasks. Fast iteration; each subagent doesn't carry the prior context, so the review is independent. Best for catching drift early.

**2. Inline Execution** — Execute the tasks in this session using `superpowers:executing-plans`. Batch execution with checkpoints for review. Best when you want continuity of context (e.g., to handle iterative debugging of the first CI run without re-handing off).

Which approach?
