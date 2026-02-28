# OI App - Projektstruktur Übersicht

## 📁 Root Verzeichnis

```
oi_app/
├── 📄 package.json                # Root Workspace Konfiguration
├── 📄 Makefile                    # Development Commands
├── 📄 docker-compose.yml          # Container-Orchestration
├── 📄 .env.example                # Umgebungsvariablen Template
├── 📄 .gitignore                  # Git Exclusions
│
├── 📁 backend/                    # Express REST API
│   ├── 📄 package.json
│   ├── 📄 tsconfig.json
│   ├── 📄 Dockerfile
│   ├── 📄 .dockerignore
│   ├── 📁 src/
│   │   ├── index.ts               # Server Einstiegspunkt
│   │   ├── config.ts              # Umgebungsvariablen
│   │   ├── database.ts            # SQLite Schema
│   │   ├── 📁 routes/
│   │   ├── 📁 services/
│   │   ├── 📁 middleware/
│   │   └── 📁 models/
│   ├── 📁 knowledge/
│   │   └── categories.json        # KI-Wissensdatenbank
│   └── 📁 data/
│       └── oi_app.db              # SQLite Datenbank (erstellt beim Start)
│
├── 📁 frontend/                   # React PWA (Mobile-First)
│   ├── 📄 package.json
│   ├── 📄 tsconfig.json
│   ├── 📄 vite.config.ts
│   ├── 📄 tailwind.config.js
│   ├── 📄 postcss.config.js
│   ├── 📄 Dockerfile
│   ├── 📄 .dockerignore
│   ├── 📁 src/
│   │   ├── App.tsx
│   │   ├── index.css              # Tailwind Directives
│   │   ├── 📁 components/
│   │   │   ├── LocationMap.tsx    # Leaflet Karte
│   │   │   └── AddressSearch.tsx  # Nominatim Suche
│   │   └── 📁 pages/
│   ├── 📁 public/
│   │   ├── manifest.json          # PWA Manifest
│   │   └── sw.ts                  # Service Worker
│   └── index.html
│
├── 📁 admin/                      # React Dashboard (Desktop-First)
│   ├── 📄 package.json
│   ├── 📄 tsconfig.json
│   ├── 📄 vite.config.ts
│   ├── 📄 tailwind.config.js
│   ├── 📄 postcss.config.js
│   ├── 📄 Dockerfile
│   ├── 📄 .dockerignore
│   ├── 📁 src/
│   │   ├── App.tsx                # Router & Layout
│   │   ├── index.css              # Tailwind Directives
│   │   └── 📁 pages/
│   │       ├── Login.tsx
│   │       ├── Dashboard.tsx
│   │       ├── TicketDetail.tsx
│   │       ├── Knowledge.tsx
│   │       ├── Users.tsx
│   │       ├── Logs.tsx
│   │       └── Settings.tsx        # SMTP-Konfiguration
│   ├── 📁 public/
│   └── index.html
│
└── 📁 Documentation/
    ├── 📄 README.md               # Projektübersicht
    ├── 📄 QUICKSTART.md           # Schnellanleitung
    ├── 📄 DEVELOPMENT.md          # Entwicklerhandbuch
    ├── 📄 ROADMAP.md              # Planung & Roadmap
    ├── 📄 ITERATION-2-REPORT.md   # Diese Iteration
    └── validate-setup.sh          # Validierungsskript
```

## 🔧 Konfigurationsdateien

| Datei | Zweck |
|-------|-------|
| `package.json` | Root Workspace (3 Projekte) |
| `backend/package.json` | Backend Dependencies |
| `frontend/package.json` | Frontend Dependencies + Tailwind |
| `admin/package.json` | Admin Dependencies + Tailwind |
| `tsconfig.json` (3x) | TypeScript Compilation |
| `vite.config.ts` (2x) | Frontend/Admin Build Config |
| `tailwind.config.js` (2x) | Tailwind CSS Theme (Frontend + Admin) |
| `postcss.config.js` (2x) | PostCSS Plugin Chain |
| `docker-compose.yml` | Docker Service Orchestration |
| `Dockerfile` (3x) | Container Images |
| `.dockerignore` (3x) | Docker Build Exclusions |
| `.env.example` | Environment Template |
| `.gitignore` | Git Exclusions |
| `Makefile` | Development Commands |

## 📚 Dokumentation

| Datei | Beschreibung |
|-------|-------------|
| `README.md` | Technische Übersicht (Architektur, Stack, Features) |
| `QUICKSTART.md` | Schnellstart (Installation, Setup, Zugriff) |
| `DEVELOPMENT.md` | Entwicklerhandbuch (Dev-Setup, Testing, Debugging) |
| `ROADMAP.md` | Planung (Nächste Features, Priorities, Timeline) |
| `ITERATION-2-REPORT.md` | Abschlussreport dieser Iteration |
| `validate-setup.sh` | Setup-Validierungsskript |
| `Makefile` | Development-Commands + Help |

## 🗂️ Backend Struktur (src/)

```
backend/src/
├── index.ts                       # Server-Startup
├── config.ts                      # Environment-Loading
├── database.ts                    # SQLite Schema
├── routes/
│   ├── auth.ts                    # OAuth + JWT Login
│   ├── submissions.ts             # POST Meldungen
│   ├── tickets.ts                 # GET/PATCH Tickets
│   ├── admin.ts                   # Admin CRUD + SMTP Config
│   └── knowledge.ts               # Knowledge Base (TODO: PATCH)
├── services/
│   ├── admin.ts                   # Admin Business Logic
│   ├── openai.ts                  # OAuth Token Management
│   ├── ai.ts                      # GPT-4o Orchestration (TODO)
│   └── tools.ts                   # Tool Execution (TODO)
├── middleware/
│   └── auth.ts                    # JWT Verify + Role-Based
└── models/
    └── types.ts                   # TypeScript Interfaces
```

## 🎨 Frontend Komponenten (src/)

```
frontend/src/
├── App.tsx                        # Main App + Form
├── App.css                        # Custom CSS (TODO: migrate to Tailwind)
├── index.css                      # Tailwind Directives
└── components/
    ├── LocationMap.tsx            # Leaflet Map + Geolocation
    ├── LocationMap.css            # Map Styles (TODO: Tailwind)
    ├── AddressSearch.tsx          # Nominatim Address Search
    └── AddressSearch.css          # Search Styles (TODO: Tailwind)
```

## 🖥️ Admin Komponenten (src/)

```
admin/src/
├── App.tsx                        # Router + Layout
├── App.css                        # Admin Layout (TODO: Tailwind)
├── index.css                      # Tailwind Directives
└── pages/
    ├── Login.tsx                  # JWT Login Form
    ├── Login.css                  # Login Styles (TODO: Tailwind)
    ├── Dashboard.tsx              # Stats + Ticket List
    ├── Dashboard.css              # Dashboard Styles (TODO: Tailwind)
    ├── TicketDetail.tsx           # Ticket Management
    ├── TicketDetail.css           # Ticket Styles (TODO: Tailwind)
    ├── Knowledge.tsx              # Knowledge Editor (SUPERADMIN)
    ├── Users.tsx                  # User Management (SUPERADMIN)
    ├── Logs.tsx                   # AI Decision Logs
    └── Settings.tsx               # SMTP Configuration ✅ NEU!
```

## 🗄️ Datenbank (SQLite)

```
data/oi_app.db
├── citizens                       # PII (id, email, name, image_path)
├── submissions                    # Meldungen (anonymized_text, location, status)
├── tickets                        # Verarbeitete Tickets (category, priority, status)
├── ai_logs                        # KI-Entscheidungen & Feedback
├── admin_users                    # Admin-Konten (id, username, password_hash, role)
├── oauth_tokens                   # OpenAI Token Management
├── knowledge_versions            # Wissensdatenbank-Versionen (Git-tracked)
└── escalations                   # Eskalations-Verwaltung
```

## 📊 Services & Ports

| Service | Port | URL | Purpose |
|---------|------|-----|---------|
| Backend | 3001 | `${VITE_API_URL}/api` | REST API |
| Frontend | 5173 | `http://localhost:5173` | Meldungsformular (PWA) |
| Admin | 5174 | `http://localhost:5174` | Admin Dashboard |

## 🎯 Wichtigste Dateien zum Bearbeiten

### Für Frontend-Änderungen:
- `frontend/src/App.tsx` - Formular & Struktur
- `frontend/src/components/LocationMap.tsx` - Karte
- `frontend/src/components/AddressSearch.tsx` - Adresssuche
- `frontend/tailwind.config.js` - Design-Variablen

### Für Admin-Änderungen:
- `admin/src/App.tsx` - Router & Navigation
- `admin/src/pages/Dashboard.tsx` - Übersicht
- `admin/src/pages/TicketDetail.tsx` - Ticket-Verwaltung
- `admin/src/pages/Settings.tsx` - SMTP-Config
- `admin/tailwind.config.js` - Design-Variablen

### Für Backend-Änderungen:
- `backend/src/index.ts` - Server-Setup
- `backend/src/routes/*.ts` - API-Endpoints
- `backend/src/services/*.ts` - Business-Logik
- `backend/knowledge/categories.json` - KI-Konfiguration

### Für Umgebungs-Konfiguration:
- `.env.local` - Lokale Secrets (nicht committen!)
- `.env.example` - Template für neue Devs

## 🚀 Quick-Navigation

```
📖 Schnellanleitung?           → QUICKSTART.md
🛠️ Entwicklung Setup?           → DEVELOPMENT.md
📋 Was ist geplant?            → ROADMAP.md
✅ Was wurde gemacht?          → ITERATION-2-REPORT.md
🔍 Setup prüfen?               → bash validate-setup.sh
⚡ Befehle?                    → make help oder Makefile

🌐 Frontend öffnen?            → http://localhost:5173
👤 Admin öffnen?               → http://localhost:5174 (admin/admin123)
🔌 Backend API?                → ${VITE_API_URL}/api
```

## 📝 Nächste Schritte für neue Devs

1. **Projektstruktur verstehen** ← Du bist hier!
2. Lese [QUICKSTART.md](QUICKSTART.md) (5 Min)
3. Lese [DEVELOPMENT.md](DEVELOPMENT.md) (15 Min)
4. Führe Setup aus: `bash validate-setup.sh` (1 Min)
5. Starte Services: `npm run dev` (1 Min)
6. Entwickle: Öffne Editor + Browser, code away! 🚀

---

**Version:** 1.0.0-dev  
**Lizenz:** Apache 2.0  
**Letztes Update:** 2024
