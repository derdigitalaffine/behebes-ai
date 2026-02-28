# OI App - Quick Start Guide

Vollständiger Leitfaden zum Starten der OI App lokal in der Entwicklungsumgebung.

## Systemanforderungen

- Node.js 18+ und npm 9+
- SQLite3 (nur falls lokal ohne MySQL getestet wird)
- Git (für Wissensdatenbank-Versionierung)

## Installation

```bash
# 1. Repository klonen
git clone <repo-url>
cd oi_app

# 2. Abhängigkeiten installieren
npm install

# 3. Umgebungsvariablen konfigurieren
cp .env.example .env.local
```

## Umgebungsvariablen (.env.local)

```env
# Backend
NODE_ENV=development
EXPRESS_PORT=3001
DATABASE_PATH=./data/oi_app.db
DATABASE_CLIENT=mysql
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=behebes
MYSQL_PASSWORD=behebes
MYSQL_DATABASE=behebes_ai
MYSQL_MIGRATE_FROM_SQLITE=true
MYSQL_MIGRATION_SQLITE_PATH=./data/oi_app.db
JWT_SECRET=your-secret-key-here
JWT_EXPIRY=24h

# OpenAI OAuth
OPENAI_CLIENT_ID=your-client-id
OPENAI_CLIENT_SECRET=your-client-secret
OPENAI_REDIRECT_URI=${VITE_API_URL}/api/auth/openai/callback

# SMTP (optional, konfigurierbar über Admin Panel)
SMTP_HOST=localhost
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM_EMAIL=noreply@example.com
SMTP_FROM_NAME=OI App

# Frontend
VITE_API_URL=${VITE_API_URL}
VITE_NOMINATIM_API=https://nominatim.openstreetmap.org

# Admin
VITE_API_URL=${VITE_API_URL}
```

## Starten der Entwicklungsumgebung

### Option 1: Alle Services gleichzeitig starten

```bash
npm run dev
```

Dies startet:
- **Frontend:** http://localhost:5173 (Bürgermeldungsformular)
- **Admin Panel:** http://localhost:5174 (Administration & Dashboard)
- **Backend:** ${VITE_API_URL} (REST API)

### Option 2: Services einzeln starten

```bash
# Terminal 1: Backend
npm run dev:backend

# Terminal 2: Frontend
npm run dev:frontend

# Terminal 3: Admin Panel
npm run dev:admin
```

## Zugriff auf die Anwendung

### 📱 Frontend (Bürgermeldungsformular)
- URL: http://localhost:5173
- Mobile-First PWA
- Enthält: Formular, Geolocation, Adresssuche (Nominatim), Kartenansicht (Leaflet)
- Keine Authentifizierung erforderlich

### 🛠️ Admin Panel
- URL: http://localhost:5174
- Desktop-First Dashboard
- **Anmeldedaten:**
  - Benutzername: `admin`
  - Passwort: `admin123`
  - Standardrolle: SUPERADMIN
- Funktionen: Ticket-Management, Wissensdatenbank-Editor, Benutzer-Verwaltung, SMTP-Konfiguration

### 🔌 Backend API
- Base URL: ${VITE_API_URL}/api
- REST API für Frontend & Admin
- Swagger/OpenAPI (optional): ${VITE_API_URL}/api-docs

## API Endpoints (Wichtigste)

### Authentifizierung
```bash
# Admin JWT-Login
POST /api/auth/admin/login
{
  "username": "admin",
  "password": "admin123"
}

# OpenAI OAuth-Flow
GET /api/auth/openai/login
GET /api/auth/openai/callback?code=...&state=...
```

### Bürgermeldungen
```bash
# Neue Meldung einreichen
POST /api/submissions
{
  "anonymized_text": "Straße ist kaputt",
  "latitude": 49.5,
  "longitude": 7.5,
  "address": "Hauptstraße 123",
  "postal_code": "67661",
  "city": "Otterbach"
}

# Meldungen abrufen (Admin)
GET /api/submissions?status=pending&limit=20
```

### Tickets
```bash
# Ticket-Liste (Admin)
GET /api/tickets?status=open&priority=high

# Ticket-Details
GET /api/tickets/:id

# Ticket aktualisieren
PATCH /api/tickets/:id
{
  "status": "resolved",
  "category": "Schlaglöcher",
  "priority": "low"
}
```

### Admin Panel
```bash
# Dashboard-Statistiken
GET /api/admin/dashboard/stats

# SMTP-Konfiguration
GET /api/admin/config/smtp
PATCH /api/admin/config/smtp

# Benutzer
GET /api/admin/users
POST /api/admin/users
PATCH /api/admin/users/:id

# Logs
GET /api/admin/logs
```

## Datenbank

Die SQLite-Datenbank wird automatisch beim ersten Start erstellt:

```
data/oi_app.db
├── citizens (Bürgerdaten, PII)
├── submissions (Anonyme Meldungen mit Standort)
├── tickets (Verarbeitete Tickets nach KI-Analyse)
├── ai_logs (KI-Entscheidungen und Admin-Feedback)
├── admin_users (Admin-Konten)
├── oauth_tokens (OpenAI-Token)
├── knowledge_versions (Wissensdatenbank-Versionen)
└── escalations (Eskalationen)
```

## Wissensdatenbank

Die KI-Wissensdatenbank ist Git-versioniert:

```
backend/knowledge/categories.json
├── categories (6: Schlaglöcher, Abfall, Wasser, Grün, Verkehr, Sonstiges)
├── assignments (Zuweisungsregeln)
├── escalation_rules (Eskalationskriterien)
├── prompts (Custom KI-Prompts)
└── custom_rules (Geschäftslogik-Regeln)
```

Im Admin Panel: **Wissensdatenbank** → Kategorien & Zuweisungen bearbeiten → Automatisch gespeichert + Git-Commit

## Troubleshooting

### Backend startet nicht
```bash
# Ports freigeben
lsof -i :3001
kill -9 <PID>

# Dependencies neu installieren
npm install --workspace=backend
```

### Frontend-Fehlermeldungen
```bash
# Node-Module räumen auf
rm -rf node_modules frontend/node_modules
npm install

# Vite-Cache löschen
rm -rf frontend/.vite
npm run dev:frontend
```

### Adresssuche funktioniert nicht
- Nominatim API ist öffentlich, keine Authentifizierung nötig
- Prüfe: Browser-Konsole auf CORS-Fehler
- Nominatim-TOS beachten: Max. 1 Request/Sekunde (wird via 300ms Debounce eingehalten)

### SMTP-Test
```bash
curl -X GET ${VITE_API_URL}/api/admin/config/smtp \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Entwicklungs-Features

### Hot Reloading
- Frontend: Automatisches Reload bei Dateiänderungen
- Admin: Automatisches Reload bei Dateiänderungen
- Backend: Automatisches Reload bei Dateiänderungen (via nodemon)

### Logging
Backend loggt alle Requests mit Pino-Logger:
```bash
# Terminal-Ausgabe
[INFO] GET /api/submissions
[INFO] User authenticated: admin (SUPERADMIN)
[ERROR] Database error: CONSTRAINT violation
```

### TypeScript
Alle Projekte verwenden TypeScript mit striktem Modus:
```bash
npm run build  # Compilation testen
```

## Nächste Schritte

1. **OpenAI OAuth konfigurieren:**
   - https://platform.openai.com/ → API-Keys erstellen
   - `.env.local` mit Client ID + Secret aktualisieren

2. **SMTP konfigurieren:**
   - Admin Panel → Einstellungen → SMTP ausfüllen
   - Oder via `.env.local` setzen

3. **Knowledge Base anpassen:**
   - Admin Panel → Wissensdatenbank
   - Kategorien für lokale Anforderungen auswählen
   - Zuweisungsregeln definieren

4. **Production Deployment:**
   - Docker-Image erstellen: `docker-compose up`
   - SSL/TLS konfigurieren
   - PostgreSQL als DB (optional)
   - Reverse Proxy (Nginx/Apache)

## Support & Dokumentation

- **README.md** - Technische Übersicht
- **API-Dokumentation** - Endpoint-Details
- **Admin-Guide** - Benutzerhandbuch
- **Developer-Guide** - Architektur & Best Practices

---

**Version:** 1.0.0  
**Letztes Update:** 2024  
**Lizenz:** Apache 2.0
