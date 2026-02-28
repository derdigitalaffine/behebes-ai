# OI App - Entwicklungshandbuch

Dokumentation für Entwickler und DevOps zur lokalen Entwicklung und Bereitstellung der OI App.

## 📁 Projektstruktur

```
oi_app/
├── backend/               # Express REST API + SQLite
│   ├── src/
│   │   ├── index.ts      # Server-Einstiegspunkt
│   │   ├── config.ts     # Konfigurationsverwaltung
│   │   ├── database.ts   # SQLite-Schema
│   │   ├── routes/       # API-Endpoints
│   │   ├── services/     # Business-Logik
│   │   └── middleware/   # Auth, Logger, etc.
│   ├── knowledge/        # JSON-Wissensdatenbank
│   ├── Dockerfile        # Container-Image
│   └── package.json
├── frontend/              # React + Vite (PWA, Mobile-First)
│   ├── src/
│   │   ├── App.tsx       # Hauptkomponente
│   │   ├── components/   # Reusable UI-Komponenten
│   │   └── pages/        # Seiten/Routes
│   ├── public/           # Static Assets + Web App Manifest
│   ├── Dockerfile        # Container-Image
│   └── package.json
├── admin/                 # React + Vite (Desktop-First Dashboard)
│   ├── src/
│   │   ├── App.tsx       # Router + Layout
│   │   └── pages/        # Dashboard, Tickets, Knowledge, etc.
│   ├── Dockerfile        # Container-Image
│   └── package.json
├── docker-compose.yml     # Container-Orchestration (Dev)
├── package.json           # Root Monorepo
├── QUICKSTART.md         # Schnellanleitung
└── README.md             # Projektübersicht
```

## 🛠️ Entwicklung lokal (ohne Docker)

### Schritt 1: Repository klonen & Dependencies installieren

```bash
# Clone
git clone <repo-url>
cd oi_app

# Workspace Installation
npm install

# Check: Alle 3 Workspaces sollten node_modules haben
ls -la backend/node_modules frontend/node_modules admin/node_modules
```

### Schritt 2: Umgebungsvariablen setzen

```bash
# .env.local erstellen
cp .env.example .env.local

# Editor öffnen und folgende Felder ausfüllen:
# - OPENAI_CLIENT_ID / SECRET (falls OpenAI-Integration benötigt)
# - SMTP_* Variablen (für Email-Versand)

vim .env.local
```

### Schritt 3: Datenbank initialisieren

```bash
# Backend-DB automatisch erstellen (beim ersten Start)
npm run dev:backend

# Oder manuell:
npm run db:init --workspace=backend
```

Die SQLite-DB wird unter `data/oi_app.db` erstellt mit:
- 8 Tabellen (citizens, submissions, tickets, ai_logs, admin_users, oauth_tokens, knowledge_versions, escalations)
- Vollständiges Schema mit Indizes
- Default-Admin: `admin` / `admin123` (automatisch erstellt beim Start)

### Schritt 4: Services starten

**Option A: Alle Services gleichzeitig (empfohlen)**

```bash
npm run dev
```

**Option B: Services einzeln in separaten Terminals**

```bash
# Terminal 1: Backend (Port 3001)
npm run dev:backend

# Terminal 2: Frontend (Port 5173)
npm run dev:frontend

# Terminal 3: Admin (Port 5174)
npm run dev:admin
```

### Schritt 5: Im Browser öffnen

```
Frontend:  http://localhost:5173
Admin:     http://localhost:5174 (admin / admin123)
Backend:   ${VITE_API_URL}/api
```

## 🐳 Entwicklung mit Docker (Container-basiert)

### Voraussetzungen

- Docker 20.10+
- Docker Compose 2.0+

```bash
# Version prüfen
docker --version
docker-compose --version
```

### Container-basierte Entwicklung starten

```bash
# Alle Services als Container starten
docker-compose up --build

# Output beispielhaft:
# backend    | [INFO] Server started on ${VITE_API_URL}
# frontend   | [INFO] Dev server running at http://localhost:5173
# admin      | [INFO] Dev server running at http://localhost:5174
```

### Container-basierte Entwicklung stoppen

```bash
# Graceful Shutdown
docker-compose down

# Mit Volume-Cleanup
docker-compose down -v
```

### Debugging in Docker

```bash
# Logs eines Services anschauen
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f admin

# In einen Container shell geben
docker-compose exec backend sh
docker-compose exec backend npm run dev

# Image neu bauen (nach Code-Änderungen)
docker-compose build backend
docker-compose up backend
```

## 🧪 Testing & Validierung

### Frontend testen

```bash
# Meldungsformular öffnen
open http://localhost:5173

# Test-Schritte:
# 1. Formular mit Testdaten ausfüllen
# 2. Karte öffnen → Geolocation prüfen
# 3. Adresssuche testen (z.B. "Otterbach")
# 4. Submit → Backend sollte Meldung erhalten
```

### Backend testen

```bash
# Health Check
curl ${VITE_API_URL}/api/health

# Admin Login
curl -X POST ${VITE_API_URL}/api/auth/admin/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "admin123"
  }'

# Meldung einreichen
curl -X POST ${VITE_API_URL}/api/submissions \
  -H "Content-Type: application/json" \
  -d '{
    "anonymized_text": "Test Schlagloch",
    "latitude": 49.5,
    "longitude": 7.5,
    "address": "Hauptstraße 123",
    "postal_code": "67661",
    "city": "Otterbach"
  }'

# Tickets abrufen
curl -H "Authorization: Bearer $TOKEN" \
  ${VITE_API_URL}/api/tickets
```

### Admin Panel testen

```bash
# Login öffnen
open http://localhost:5174

# Credentials:
# Username: admin
# Password: admin123

# Test-Schritte:
# 1. Dashboard: Statistiken anschauen
# 2. Tickets: Neue Meldungen prüfen
# 3. Wissensdatenbank: Kategorien bearbeiten
# 4. Einstellungen: SMTP-Config setzen
```

## 📊 Datenbank-Verwaltung

### SQLite-DB direkt öffnen

```bash
# DB öffnen
sqlite3 data/oi_app.db

# Tabellen auflisten
.tables

# Meldungen anschauen
SELECT * FROM submissions LIMIT 5;

# Admin-Benutzer
SELECT * FROM admin_users;

# AI-Logs
SELECT * FROM ai_logs;

# Beenden
.quit
```

### DB-Backup erstellen

```bash
# Backup
cp data/oi_app.db backups/oi_app.db.$(date +%Y%m%d_%H%M%S)

# Oder SQLite-Export
sqlite3 data/oi_app.db ".dump" > data/backup.sql
```

### DB zurücksetzen (⚠️ Achtung: Löscht alle Daten)

```bash
# Datenbank löschen
rm data/oi_app.db

# Neu erstellen beim nächsten Backend-Start
npm run dev:backend
```

## 🔐 Authentifizierung & Secrets

### JWT-Token erzeugen (Debugging)

```bash
# Admin-Token holen
TOKEN=$(curl -s -X POST ${VITE_API_URL}/api/auth/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | jq -r '.token')

# Token verwenden
curl -H "Authorization: Bearer $TOKEN" \
  ${VITE_API_URL}/api/admin/dashboard/stats
```

### OpenAI OAuth einrichten

1. https://platform.openai.com → API Keys
2. OAuth App erstellen:
   - Client ID: `OPENAI_CLIENT_ID`
   - Client Secret: `OPENAI_CLIENT_SECRET`
   - Redirect URI: `${VITE_API_URL}/api/auth/openai/callback`
3. `.env.local` aktualisieren:
   ```
   OPENAI_CLIENT_ID=xxx
   OPENAI_CLIENT_SECRET=yyy
   ```

## 📝 TypeScript & Build

### TypeScript compilieren

```bash
# Einzeln
npm run build --workspace=backend

# Alle gleichzeitig
npm run build

# Watch-Mode (Auto-Compile)
npm run dev
```

### Type-Checking ohne Build

```bash
# Backend
npx tsc --noEmit --workspace=backend

# Frontend (über Vite)
npm run dev:frontend
```

## 🚀 Production Build

### Frontend & Admin bauen

```bash
# Frontend Build (dist/)
npm run build --workspace=frontend

# Admin Build (dist/)
npm run build --workspace=admin

# Backend Build (dist/)
npm run build --workspace=backend
```

### Production-Server starten

```bash
# Backend (compiled)
npm run start --workspace=backend

# Frontend (serve dist/)
npx serve -s frontend/dist -l 3000

# Admin (serve dist/)
npx serve -s admin/dist -l 3001
```

### Docker Production-Image

```bash
# Image bauen
docker build -f backend/Dockerfile -t oi-app-backend:latest .
docker build -f frontend/Dockerfile -t oi-app-frontend:latest .
docker build -f admin/Dockerfile -t oi-app-admin:latest .

# Registry pushen (optional)
docker tag oi-app-backend:latest registry.example.com/oi-app-backend:latest
docker push registry.example.com/oi-app-backend:latest
```

## 🐛 Troubleshooting

### Port bereits in Verwendung

```bash
# Port freigeben
lsof -i :3001
kill -9 <PID>

# Oder anderen Port verwenden
EXPRESS_PORT=3002 npm run dev:backend
```

### Module-nicht-gefunden Fehler

```bash
# node_modules räumen auf
rm -rf node_modules backend/node_modules frontend/node_modules admin/node_modules

# Neu installieren
npm install
```

### Vite-Fehler bei Frontend/Admin

```bash
# Cache löschen
rm -rf frontend/.vite admin/.vite

# Neu starten
npm run dev:frontend
npm run dev:admin
```

### Nominatim API nicht erreichbar

```bash
# Public API überprüfen
curl https://nominatim.openstreetmap.org/search.php?q=Berlin&format=json

# Falls blockiert: Lokalen Nominatim-Server starten (Docker)
docker run -p 8080:8080 mediagis/nominatim:latest
```

### Datenbankfehler

```bash
# DB-Schema überprüfen
sqlite3 data/oi_app.db ".schema"

# DB reparieren
sqlite3 data/oi_app.db "PRAGMA integrity_check;"

# Neu initialisieren
rm data/oi_app.db
npm run dev:backend
```

## 📚 Weitere Ressourcen

- **QUICKSTART.md** - Schnellanleitung
- **README.md** - Technische Übersicht
- **API-Dokumentation** - Endpoint-Specs
- **Wissensdatenbank** - backend/knowledge/categories.json

## 🔗 Wichtige Links (Lokal)

| Service | URL | User | Pass |
|---------|-----|------|------|
| Frontend (PWA) | http://localhost:5173 | — | — |
| Admin Dashboard | http://localhost:5174 | admin | admin123 |
| Backend API | ${VITE_API_URL}/api | — | — |
| SQLite DB | data/oi_app.db | — | — |

---

**Version:** 1.0.0  
**Letztes Update:** 2024  
**Lizenz:** Apache 2.0
