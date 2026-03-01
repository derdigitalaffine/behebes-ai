# RLP Extension: Imports, Responsibility, Internal Tasks

## EN

This document describes the `rlp` implementation package that introduces:

1. Tenant-aware CSV imports for users and organization units.
2. Responsibility query endpoints with confidence-ranked candidates.
3. User invite endpoints for password setup by mail or link.
4. Extended internal processing behavior with assignment policies and OPS-side form handling.

### API Overview

- Imports
  - `POST /api/admin/imports`
  - `POST /api/admin/imports/:id/upload`
  - `POST /api/admin/imports/:id/preview`
  - `POST /api/admin/imports/:id/execute`
  - `GET /api/admin/imports/:id`
  - `GET /api/admin/imports/:id/report`
  - `POST /api/admin/imports/:id/cancel`
  - `POST /api/admin/imports/:id/assist/mapping`
  - `POST /api/admin/imports/:id/assist/keywords`
  - `POST /api/admin/imports/:id/assist/scope-assignment`
- Responsibility
  - `GET /api/admin/responsibility/config`
  - `PATCH /api/admin/responsibility/config`
  - `POST /api/admin/responsibility/query`
  - `POST /api/admin/responsibility/simulate`
- Invites
  - `POST /api/admin/users/:userId/invite`
  - `POST /api/admin/users/invite/batch`

### Data Model

Migration `202603010100_imports_responsibility_invites` creates and extends:

- New tables:
  - `import_jobs`
  - `import_job_files`
  - `import_job_conflicts`
  - `import_job_events`
  - `responsibility_queries`
  - `user_invites`
- Added columns:
  - `admin_users.profile_data_json`
  - `admin_users.external_person_id`
  - `workflow_internal_tasks.allow_reject`
  - `workflow_internal_tasks.cycle_index`
  - `workflow_internal_tasks.max_cycles`
  - `workflow_internal_tasks.assignment_update_mode`
  - `workflow_internal_tasks.assignment_source`
  - `org_units.external_ref` (if table exists)

## DE

Dieses Dokument beschreibt das `rlp`-Umsetzungspaket mit folgenden Erweiterungen:

1. Mandantenfähige CSV-Importe für Benutzer und Organisationseinheiten.
2. Zuständigkeitsabfragen mit Konfidenz-basierten Kandidatenlisten.
3. Einladungsendpunkte für Passwort-Setzung per E-Mail oder Link.
4. Erweiterte interne Bearbeitung mit Zuweisungsregeln und OPS-Formularverarbeitung.

### Betriebs-Hinweise

- Alle Endpunkte sind serverseitig an Rollen/Scopes gebunden.
- Import-Läufe sind asynchron, abbrechbar und protokolliert.
- OPS rendert interne Aufgabenformulare dynamisch aus dem `formSchema`.

