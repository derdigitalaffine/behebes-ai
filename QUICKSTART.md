# QUICKSTART | behebes.AI (DE/EN)

This guide provides a production-oriented quickstart for the current container landscape (`docker-compose.yml` and `docker-compose.prod.yml`).  
Diese Anleitung bietet einen produktionsnahen Schnellstart fuer die aktuelle Container-Landschaft (`docker-compose.yml` und `docker-compose.prod.yml`).

## 1) Prerequisites | Voraussetzungen

**EN**
- Linux/macOS host with Docker Compose v2 or Podman Compose
- Git
- Ports available:
  - `PROXY_PORT` (default `8384`)
  - internal service ports are container-local

**DE**
- Linux/macOS-Host mit Docker Compose v2 oder Podman Compose
- Git
- Verfuegbare Ports:
  - `PROXY_PORT` (Standard `8384`)
  - interne Service-Ports bleiben container-intern

## 2) Clone and Prepare | Klonen und vorbereiten

```bash
git clone <REPOSITORY_URL> behebes-ai
cd behebes-ai
cp .env.example .env.local
```

Review `.env.local` and set at least:
- `JWT_SECRET`
- MySQL credentials (`MYSQL_*`)
- callback/admin/frontend URLs (`FRONTEND_URL`, `ADMIN_URL`, `CORS_ALLOWED_ORIGINS`)
- optional provider credentials (LLM, SMTP/IMAP, XMPP)

## 3) Start Stack (Development-like) | Stack starten (entwicklungsnah)

### Option A: Podman

```bash
podman-compose -f docker-compose.yml up -d --build
```

### Option B: Docker

```bash
docker compose -f docker-compose.yml up -d --build
```

Open:
- Citizen frontend: `http://localhost:${PROXY_PORT:-8384}`
- Admin frontend: `http://localhost:${PROXY_PORT:-8384}/admin`
- Ops frontend: `http://localhost:${PROXY_PORT:-8384}/ops`
- API docs (Swagger): `http://localhost:${PROXY_PORT:-8384}/api/docs`

## 4) Start Stack (Production-oriented) | Stack starten (produktionsnah)

### Option A: Podman

```bash
podman-compose -f docker-compose.prod.yml up -d --build
```

### Option B: Docker

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

## 5) Verify Health | Health pruefen

```bash
# compose status
podman-compose -f docker-compose.yml ps
# or: docker compose -f docker-compose.yml ps

# backend health
curl -fsS http://localhost:${PROXY_PORT:-8384}/api/health
```

Expected backend response contains `ok`/healthy state.

## 6) Logs and Troubleshooting | Logs und Fehleranalyse

```bash
# all logs
podman-compose -f docker-compose.yml logs -f

# backend only
podman-compose -f docker-compose.yml logs -f backend
```

For Docker, replace `podman-compose` with `docker compose`.

## 7) No-Cache Rebuild | No-Cache-Rebuild

Use this if browser/app versions look stale or after deep dependency changes.

```bash
# Podman
podman-compose -f docker-compose.prod.yml build --no-cache
podman-compose -f docker-compose.prod.yml up -d

# Docker
docker compose -f docker-compose.prod.yml build --no-cache
docker compose -f docker-compose.prod.yml up -d
```

## 8) Stop and Cleanup | Stoppen und aufraeumen

```bash
# keep volumes
podman-compose -f docker-compose.yml down

# with volume cleanup (destructive)
podman-compose -f docker-compose.yml down -v
```

`down -v` removes MySQL data volume. Use only if intentional.

## 9) Core Runtime Components | Kernkomponenten zur Laufzeit

- `mysql` (state)
- `backend` (API + business logic)
- `frontend` (citizen app)
- `admin` (admin control center)
- `ops` (mobile staff app)
- `xmpp` (team messenger transport)
- `proxy` (single ingress)

## 10) Operational References | Betriebsreferenzen

- Release and update process: `docs/versioning-and-updates.md`
- Git governance and release workflow: `docs/git-governance.md`
- Main platform overview: `README.md`
