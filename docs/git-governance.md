# Git Governance and Release Workflow | Git-Governance und Release-Workflow

## Purpose | Zweck

**EN**  
This document defines the operational Git baseline for behebes.AI: controlled releases, clean history, and strict branch protection for production reliability.

**DE**  
Dieses Dokument definiert die operative Git-Basis fuer behebes.AI: kontrollierte Releases, saubere Historie und strikte Branch-Protection fuer einen verlaesslichen Produktivbetrieb.

## 1) Repository Model | Repository-Modell

1. Default branch: `main`
2. Release identity: annotated SemVer tags (`vMAJOR.MINOR.PATCH`)
3. Release source: only from clean, validated commits on `main`
4. No history rewrites on published states

## 2) Branching Standard | Branching-Standard

Use short-lived branches for implementation work:

- `feature/<topic>`
- `fix/<topic>`
- `chore/<topic>`
- `release/<version>`

`main` stays stable and releasable.

## 3) Commit Quality | Commit-Qualitaet

Rules:

1. One logical concern per commit.
2. Include migrations with matching code changes.
3. Avoid unrelated mixed commits.
4. Prefer explicit, scope-based messages:
   - `feat(admin): ...`
   - `fix(backend): ...`
   - `chore(docs): ...`

## 4) Release Protocol | Release-Protokoll

1. Ensure clean status:
   - `git status --short --branch`
2. Validate builds:
   - `npm --prefix backend run build`
   - `npm --prefix admin run build`
   - `npm --prefix frontend run build`
   - `npm --prefix ops run build`
3. Run update preflight in admin:
   - `POST /api/admin/system/update/preflight`
4. Create annotated tag:
   - `git tag -a vX.Y.Z -m "Release vX.Y.Z"`
5. Publish:
   - `git push origin main --follow-tags`
6. Create GitHub release notes for the tag.

## 5) Strict `main` Protection Baseline | Strikter `main`-Schutz

Target profile:

1. Pull requests required before merge.
2. At least 1 approval required.
3. Stale reviews dismissed on new commits.
4. Conversation resolution required.
5. Linear history enforced.
6. Force pushes blocked.
7. Branch deletion blocked.
8. Applies to admins too (no bypass).

## 6) GitHub CLI Governance Commands | GitHub-CLI-Governance-Befehle

Check repository and branch settings:

```bash
gh repo view --json nameWithOwner,visibility,defaultBranchRef
gh api repos/:owner/:repo/branches/main/protection
```

Set visibility to public:

```bash
gh repo edit --visibility public --accept-visibility-change-consequences
```

Apply strict branch protection for `main`:

```bash
gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  repos/:owner/:repo/branches/main/protection \
  -f required_status_checks.strict=true \
  -f enforce_admins=true \
  -f required_pull_request_reviews.dismiss_stale_reviews=true \
  -f required_pull_request_reviews.require_code_owner_reviews=false \
  -F required_pull_request_reviews.required_approving_review_count=1 \
  -f required_conversation_resolution=true \
  -f restrictions=
```

Enable linear history, disable force-push and deletion:

```bash
gh api --method PUT repos/:owner/:repo/branches/main/protection/required_linear_history -f enabled=true
gh api --method PUT repos/:owner/:repo/branches/main/protection/allow_force_pushes -f enabled=false
gh api --method PUT repos/:owner/:repo/branches/main/protection/allow_deletions -f enabled=false
```

## 7) Public Repository Hygiene | Public-Repository-Hygiene

Before/after switching to public:

1. Ensure local-only files are ignored (`.env`, notes, ad-hoc scripts).
2. Verify no secrets in tracked history.
3. Keep release tags and release notes in sync with deployed states.
4. Re-run build and smoke checks after tagging.

## 8) Operational Ownership | Operative Verantwortung

Project owner:

- Dominik Troester  
  Digitalbeauftragter, Verbandsgemeinde Otterbach-Otterberg

Operating principle:

- High ownership, high release discipline, full auditability.
