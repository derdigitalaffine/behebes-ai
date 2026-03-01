# Git Governance and Release Workflow | Git-Governance und Release-Workflow

## Purpose | Zweck

**EN**  
This document defines the professional Git operating model for behebes.AI: branch discipline, commit quality, release tagging, and safe update rollout.

**DE**  
Dieses Dokument definiert das professionelle Git-Betriebsmodell fuer behebes.AI: Branch-Disziplin, Commit-Qualitaet, Release-Tagging und sicheren Update-Rollout.

## 1) Repository Strategy | Repository-Strategie

- Default branch: `main`
- Protected production history: no destructive rewrites on published branches
- Annotated SemVer tags for releases: `vMAJOR.MINOR.PATCH`

## 2) Branching Model | Branching-Modell

**EN**
- `main`: release-ready state only
- short-lived feature/fix branches for substantial changes
- merge back via reviewed commits

**DE**
- `main`: nur releasefaehiger Zustand
- kurzlebige Feature-/Fix-Branches fuer groessere Aenderungen
- Rueckfuehrung per geprueften Commits

Recommended branch naming:
- `feature/<topic>`
- `fix/<topic>`
- `chore/<topic>`
- `release/<version>`

## 3) Commit Quality Standard | Commit-Qualitaetsstandard

Use clear, action-oriented commit subjects.

Examples:
- `feat(admin): add update status build metadata`
- `fix(frontend): stabilize tenant redirect handling`
- `chore(repo): remove local-only artifacts from tracking`

Rules:
- one logical change per commit
- include migration/schema changes with matching app changes
- avoid mixed commits across unrelated concerns

## 4) Release Process | Release-Prozess

1. Ensure `main` is clean and build-green.
2. Run release checks:
   - backend, frontend, admin, ops builds
3. Execute update preflight in admin (`/api/admin/system/update/preflight`).
4. Create release commit if needed.
5. Create annotated tag:

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z"
```

6. Push branch and tags:

```bash
git push origin main
git push origin --tags
```

## 5) Required Validation Gates | Verbindliche Validierungstore

Before every release:
- build checks pass
- migration consistency is intact
- backup freshness gate is green
- update runbook is available and reviewed

Reference:
- `docs/versioning-and-updates.md`

## 6) Migration and Schema Safety | Migrations- und Schema-Sicherheit

- schema changes must be versioned in `backend/src/db/migrations/definitions`
- `schema_migrations` is the source of truth for execution state
- avoid ad-hoc production SQL changes outside migration flow

## 7) Incident and Rollback Policy | Incident- und Rollback-Policy

**EN**
- if health checks fail post-deploy: rollback to last stable tag
- if migrations fail: stop rollout, fix root cause, redeploy deterministically

**DE**
- bei fehlschlagenden Health-Checks nach Deployment: Rollback auf letzten stabilen Tag
- bei Migrationsfehlern: Rollout stoppen, Ursache beheben, reproduzierbar neu deployen

## 8) Ownership and Approval | Verantwortlichkeit und Freigabe

Project ownership:
- Dominik Troester (Digitalbeauftragter, Verbandsgemeinde Otterbach-Otterberg)

Operational principle:
- high-trust ownership, high-discipline release process
- every release must remain auditable and reproducible

## 9) Minimal Command Reference | Kompakte Befehlsreferenz

```bash
# current state
git status --short --branch

# sync and inspect
git fetch --all --tags
git log --oneline --decorate -n 20

# release tag
git tag -a vX.Y.Z -m "Release vX.Y.Z"

# publish
git push origin main
git push origin --tags
```
