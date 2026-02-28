# OI App - Nächste Schritte & Roadmap

## ✅ Aktueller Status (Iteration 2)

### Abgeschlossene Features:
- ✅ Full-Stack-Struktur (monorepo mit 3 services)
- ✅ Backend: Express + SQLite, OAuth, JWT-Auth
- ✅ Frontend PWA: Leaflet-Karte, Geolocation, Nominatim-Adresssuche
- ✅ Admin-Panel: Dashboard, TicketDetail, Wissensdatenbank-Editor
- ✅ Tailwind CSS & Lucide Icons integriert
- ✅ Default-Admin erstellt (admin/admin123)
- ✅ SMTP-Konfigurationsrouten im Backend
- ✅ SMTP-Settings-Seite im Admin-Panel
- ✅ docker-compose.yml für lokale Container-Entwicklung
- ✅ Umfassende Dokumentation (QUICKSTART.md, DEVELOPMENT.md)

---

## 🎯 Nächste Phase (3-5 Tage)

### 1. AI-Orchestrierung fertigstellen (High Priority)
- [ ] `backend/src/services/ai.ts`: GPT-4o Funktion Calling implementieren
- [ ] `backend/src/services/tools.ts`: Tool-Execution (curl, email, create_ticket)
- [ ] Integration mit Nodemailer für Email-Versand
- [ ] Integration mit RedMine API (optional)
- [ ] Response-Loop: GPT → Tool → Ergebnis → GPT (repeat)
- **Outcome:** Automatische KI-Ticket-Erstellung aus Bürgermeldungen

### 2. Knowledge Base API fertigstellen
- [ ] `backend/src/routes/knowledge.ts`: PATCH-Endpoint implementieren
- [ ] Git-Integration für Knowledge-Base-Versionierung
- [ ] Admin-Panel: Knowledge-Editor mit Save-Button
- [ ] Kategorien + Zuweisungsregeln Git-versioniert
- **Outcome:** Admin kann KI-Verhalten via UI anpassen

### 3. CSS/UI-Komponenten vollständig zu Tailwind migrieren
- [ ] `frontend/src/App.css` → Tailwind-Klassen in Components
- [ ] `frontend/src/components/*.css` → Tailwind
- [ ] `admin/src/App.css` → Tailwind Layout (Header, Nav, Main)
- [ ] `admin/src/pages/*.css` → Tailwind
- [ ] Alle Komponenten Lucide-Icons verwenden
- **Outcome:** Konsistentes, wartbares Design across alle Services

### 4. Lokale Dev-Environment testen & dokumentieren
- [ ] `npm run dev` alle 3 Services gleichzeitig testen
- [ ] Docker-Compose lokal testen
- [ ] QUICKSTART.md durchgehen & validieren
- [ ] Default-Admin-Credentials überprüfen
- **Outcome:** Reibungslose Entwicklung für neue Entwickler

### 5. E2E-Testing Setup
- [ ] Playwright/Cypress für Frontend-Tests
- [ ] Jest für Backend-Unit-Tests
- [ ] Test-Cases für User-Flows:
  - Bürgermeldung einreichen
  - Admin-Login
  - Ticket-Status ändern
  - Knowledge-Base bearbeiten

---

## 📅 Folgende Phase (Nach AI-Implementation)

### Phase 3a: Email-Integration
- [ ] Nodemailer mit SMTP konfiguriert
- [ ] Email-Templates (HTML)
- [ ] Versand an Admin bei neuen Tickets
- [ ] Versand an Bürger bei Ticketupdates

### Phase 3b: RedMine-Integration
- [ ] RedMine API-Authentifizierung
- [ ] Automatisches Erstellen von RedMine-Issues
- [ ] Bi-direktionale Synchronisation (optional)

### Phase 3c: Advanced Admin Features
- [ ] User-Management UI (nicht nur Stubs)
- [ ] Rollen-basierter Zugriff (SUPERADMIN/MODERATOR/VIEWER)
- [ ] Audit-Logging (wer änderte was)
- [ ] Bulk-Ticketoperationen

### Phase 3d: Analytics & Reporting
- [ ] Dashboard-Statistiken erweitern
- [ ] Reports exportieren (PDF/Excel)
- [ ] KI-Performance-Metriken

---

## 🚀 Production Roadmap

### Vor Deployment:
1. **Security-Audit:**
   - [ ] JWT-Secret in Secrets-Manager (nicht env)
   - [ ] CORS korrekt konfigurieren
   - [ ] Rate-Limiting erhöhen
   - [ ] SSL/TLS erzwingen
   - [ ] CSRF-Protection prüfen

2. **Performance:**
   - [ ] Database-Indizes optimieren
   - [ ] API-Caching (Redis optional)
   - [ ] Frontend-Bundle-Size checken
   - [ ] Admin-Panel-Performance

3. **Monitoring & Logging:**
   - [ ] Centralized Logging (ELK, Grafana)
   - [ ] Error-Tracking (Sentry)
   - [ ] Performance-Monitoring (New Relic)
   - [ ] Health-Checks

4. **Infrastructure:**
   - [ ] Kubernetes-Deployment (optional)
   - [ ] Database-Backup-Strategy
   - [ ] CDN für Static Assets
   - [ ] WAF/DDoS-Protection

---

## 🎓 Development Best Practices

### Branch-Strategie:
```
main (production)
  ↑
staging (pre-production)
  ↑
develop (integration)
  ↑
feature/* (feature branches)
```

### Commits:
```
feat: Neue KI-Tool implementieren
fix: Nominatim-Fehler beheben
docs: DEVELOPMENT.md aktualisiert
style: Tailwind-Klassen konsistentmachen
refactor: Admin-Service vereinfachen
test: E2E-Tests für Meldungsformular
```

### Code-Review Checklist:
- [ ] TypeScript: Keine `any` Types
- [ ] Tests: Min 80% Coverage
- [ ] Security: Keine Secrets in Code
- [ ] Performance: Keine N+1 Queries
- [ ] Accessibility: WCAG 2.1 AA
- [ ] Documentation: Code + User-Docs

---

## 📊 Erfolgskritierien (MVP)

- ✅ Bürger können Meldungen einreichen (PWA funktioniert)
- ✅ Admin kann Tickets verwalten (Dashboard funktioniert)
- ✅ KI verarbeitet Meldungen automatisch (GPT-4o)
- ✅ Admin kann KI-Verhalten anpassen (Knowledge Base)
- ✅ SMTP funktioniert (Email-Versand)
- ✅ Lokale Entwicklung reibungslos (docker-compose)
- ✅ Dokumentation vollständig (QUICKSTART + DEVELOPMENT)

---

## 🆘 Support & Kontakt

- **Issues:** GitHub Issues (Bugs, Features)
- **Docs:** DEVELOPMENT.md + QUICKSTART.md
- **Code:** Siehe Beispiele in `backend/src/routes/`

---

## 📌 Quick-Reference: Nächstes Ziel

**Priorität 1:** AI-Orchestrierung fertig (KI kann echte Tickets erstellen)  
**Priorität 2:** Knowledge-API fertig (Admin kann KI steuern)  
**Priorität 3:** UI-Konsistenz (Tailwind/Icons überall)  
**Priorität 4:** Testing & Docs (Alles getestet & dokumentiert)

Nach diesen 4 Punkten → **MVP ist Ready für Alpha-Tester** ✨

---

**Version:** 1.0.0-dev  
**Status:** In-Progress  
**Team:** Dominik Tröster, VG Otterbach Otterberg  
**Lizenz:** Apache 2.0
