# Verbandsgemeinde Otterbach Otterberg - Bürgermeldungs-System mit AI

**Projekt-Leiter:** Dominik Tröster, Verbandsgemeinde Otterbach Otterberg

Ein vollständiges PWA-System für Bürgermeldungen (Schäden, Anliegen, Beschwerde) mit KI-gestützter Automatisierung, Ticketing und Integration zu externen Systemen (RedMine/Jira).

## Features

- **PWA Frontend**: Responsive Web-App mit Offline-Unterstützung
- **KI-Orchestrierung**: OpenAI GPT-4o ODER AskCodi (Multi-Provider Gateway) mit Function Calling
  - OpenAI: Direkter Zugang zu GPT-Modellen
  - AskCodi: Flexible Model-Auswahl (GPT, Claude, Gemini, Open-Source) ohne Vendor Lock-in
- **Provider-Wechsel**: Admin kann KI-Backend im laufenden Betrieb wechseln (Admin Panel → KI-Provider)
- **Datenschutz**: Bürgerdaten (Email, Bild) bleiben im Backend, KI erhält nur anonymisierte Texte
- **Wissensdatenbank**: Admin definiert KI-Verhalten (Kategorien, Zuständigkeiten, Eskalationen)
- **Learning Loop**: KI verbessert sich mit jedem Admin-Feedback
- **Admin-Panel**: Vollständige Kontrolle über Tickets, Benutzer, KI-Einstellungen
- **Automatisierung**: Email-Versand (SMTP), RedMine/Jira-API, externe Webhooks via cURL
- **Git-Management**: Alle Konfigurationen versionskontrolliert, Audit-Trail

## Tech Stack

### Backend
- **Runtime**: Node.js 22+
- **Framework**: Express.js
- **Datenbank**: SQLite
- **KI**: OpenAI GPT-4o (via OAuth) ODER AskCodi (LLM Gateway)
- **Email**: Nodemailer (SMTP/IMAP)
- **HTTP Client**: Axios (für cURL-Tools)
- **Auth**: JWT + Local Admin Users

### Frontend
- **Framework**: React 19+
- **Bundler**: Vite + Turbopack
- **PWA**: Service Worker, Web App Manifest
- **Offline**: LocalStorage + Background Sync

### Admin
- **Framework**: React
- **Port**: 5174 (separate Vite dev server)

## Projekt-Struktur

```
oi_app/
├── LICENSE                 (Apache 2.0)
├── README.md
├── .gitignore
├── package.json           (Workspace root)
├── backend/
│   ├── package.json
│   ├── src/
│   │   ├── index.ts       (Express server entry)
│   │   ├── config.ts      (Environment config)
│   │   ├── database.ts    (SQLite setup)
│   │   ├── routes/
│   │   │   ├── auth.ts    (OAuth, Admin Login)
│   │   │   ├── submissions.ts (Citizen API)
│   │   │   ├── tickets.ts  (Ticket Management)
│   │   │   ├── admin.ts    (Admin Panel API)
│   │   │   └── knowledge.ts (Wissensdatenbank)
│   │   ├── services/
│   │   │   ├── openai.ts  (GPT-4o Integration)
│   │   │   ├── email.ts   (SMTP/IMAP)
│   │   │   ├── tools.ts   (Function Calling Tools)
│   │   │   ├── redmine.ts (RedMine API)
│   │   │   └── learning.ts (KI-Learning-Loop)
│   │   ├── models/
│   │   │   ├── types.ts   (Interfaces)
│   │   │   └── schemas.ts (Database schemas)
│   │   └── middleware/
│   │       ├── auth.ts
│   │       └── errors.ts
│   └── knowledge/
│       ├── categories.json
│       ├── assignments.json
│       ├── escalation.json
│       ├── prompts.json
│       └── rules.json
├── frontend/
│   ├── package.json
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── SubmitForm.tsx
│   │   │   ├── Confirmation.tsx
│   │   │   └── OfflineNotice.tsx
│   │   ├── services/
│   │   │   ├── api.ts
│   │   │   └── sync.ts
│   │   ├── sw.ts          (Service Worker)
│   │   └── manifest.json  (PWA Manifest)
│   └── public/
├── admin/
│   ├── package.json
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Login.tsx
│   │   │   ├── Dashboard.tsx
│   │   │   ├── TicketDetail.tsx
│   │   │   ├── Users.tsx
│   │   │   ├── Knowledge.tsx
│   │   │   ├── Logs.tsx
│   │   │   └── Settings.tsx
│   │   └── services/
│   │       └── api.ts
│   └── public/
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DATENSCHUTZ.md
│   ├── ADMIN-GUIDE.md
│   └── AI-LEARNING.md
└── docker-compose.yml
```

## Schnellstart (Lokal)

```bash
# 1. Repository klonen
git clone <repo> oi_app
cd oi_app

# 2. Dependencies installieren
npm install

# 3. Environment einrichten
cp .env.example .env
# Editiere .env mit OpenAI OAuth Credentials, SMTP-Einstellungen

# 4. Backend starten (localhost:3001)
cd backend && npm run dev

# 5. Frontend starten (localhost:5173)
cd ../frontend && npm run dev

# 6. Admin-Panel starten (localhost:5174)
cd ../admin && npm run dev
```

## Betrieb: Versionierung und Updates

- Release-/Tagging- und Updateprozess: [docs/versioning-and-updates.md](docs/versioning-and-updates.md)
- API-gestützter Update-Advisor im Admin:
  - `GET /api/admin/system/update/status`
  - `POST /api/admin/system/update/preflight`
  - `GET /api/admin/system/update/runbook`
  - `GET /api/admin/system/update/history`

## Environment Variables

```env
# OpenAI OAuth
OPENAI_OAUTH_CLIENT_ID=xxx
OPENAI_OAUTH_CLIENT_SECRET=xxx

# Admin Users (seed für erste Erstellung)
ADMIN_DEFAULT_USERNAME=admin
ADMIN_DEFAULT_PASSWORD=change-me-in-production

# Email (SMTP)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=notifications@example.com
SMTP_PASS=xxx
SMTP_FROM=Meldungssystem <noreply@example.com>

# RedMine (optional)
REDMINE_API_URL=https://redmine.example.com
REDMINE_API_KEY=xxx

# JWT
JWT_SECRET=your-secret-key-change-in-production

# Server
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:5173
ADMIN_URL=http://localhost:5174

# DB-Migrationsmodus (Übergangsphase)
DB_LEGACY_SCHEMA_BOOTSTRAP=true
```

## Lizenz

Apache License 2.0 - siehe [LICENSE](LICENSE)

**© Dominik Tröster, Verbandsgemeinde Otterbach Otterberg**
