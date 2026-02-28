**Vision: Bürger-Meldungsplattform (PWA) — vollständige Beschreibung**

Dieses Dokument beschreibt die vollständige Produktvision, die technische Architektur und die detaillierten Funktionalitäten der Bürger-Meldungsplattform in ihrer letzten Ausbaustufe. Es richtet sich an Entwickler, Produktverantwortliche und Administratoren, die Implementierung, Betrieb, Datenschutzanforderungen und Erweiterungen verstehen müssen.

**Zielsetzung:**
- Bürger*innen ermöglichen, lokale Probleme (z. B. Schlaglöcher, Abfall, Wasserschäden, Verkehr) einfach per PWA (Web-App) zu melden.
- Unterstützung von zwei Erfassungsmodi: klassisches Formular und geführter Chat-Assistent (LLM-gestützt) zur strukturierten Extraktion von Feldern.
- Starke Datenschutzgarantien: PII (Name, E‑Mail, Telefonnummer etc.) verbleibt im Backend und wird niemals in unkontrollierter Form an LLMs weitergegeben.
- Double-opt-in: Jede Meldung wird erst nach Bestätigung per E‑Mail final als Ticket angelegt.
- Bildanhänge werden als Attachments gespeichert, dürfen niemals verarbeitet oder an LLMs weitergereicht werden.
- Admin-Panel zur Verwaltung von Tickets, Knowledge Base, AI-Provider-Konfiguration und System-Einstellungen.
- Lokale Entwickler- und Deploy-Experience (dev-manager, Docker, Makefile, Validierungsskripte).

**Zielgruppen:**
- Bürger*innen, die Probleme melden möchten.
- Sachbearbeiter*innen und Admins der Kommune, die Meldungen bearbeiten.
- Entwickelnde und Betreiber (DevOps) der Plattform.

**Kernfunktionen (Enduser):**
- PWA-Formular:
  - Standortauswahl per interaktiver Karte (Leaflet) oder Adresssuche (Nominatim).
  - Pflichtfelder: Problemkategorie, Beschreibung; optionale Felder: Foto, ergänzende Felder.
  - Pflichtangaben von Name und E‑Mail für double-opt-in.
  - Upload von Bildern (max. Größenbegrenzung) — werden als Attachments gespeichert.
- Chat-Assistent (optional):
  - Konversation zur Erfassung aller notwendigen Felder.
  - Server-seitige PII-Filterung vor jedem LLM-Request.
  - Automatische Extraktion strukturierter Felder (Kategorie, Beschreibung, Standort, Priorität, ggf. Kontaktwunsch).
  - Abschließender Schritt: Double-opt-in E‑Mail wird an eingegebene Adresse gesendet; Ticket wird erst nach Verifikation erstellt.
- E‑Mail Double-Opt-In:
  - Erzeugung eines kryptographisch starken, zeitlich begrenzten Tokens.
  - Versand via konfigurierbaren SMTP (Nodemailer).
  - Verifikations-Endpoint, der Token prüft und Ticket endgültig anlegt sowie Benachrichtigungen (Admin) auslöst.

**Admin-Funktionen:**
- JWT-gesicherter Admin-Login (24h Tokens) mit Rolle SUPERADMIN für AI-Konfiguration.
- Dashboard: offene Meldungen, Filter, Priorisierung.
- Ticket-Detail-Ansicht: Historie, Attachments, Kommentare, Statuswechsel.
- Knowledge Base: Git-verwaltete JSON-Datei, Versionsverwaltung, einfache Editoren-Seite.
- AI Provider Settings: Wechsel zwischen `openai` und `askcodi`, Auswahl von Model, Provider-spezifische Keys.
- System Settings: SMTP, OAuth für OpenAI, Default Admin Reset.
- Logs & Audit: ai_interactions (anonymisierte), admin_actions, ticket_events.

**Technische Architektur — Überblick:**
- Backend: Node.js + Express, TypeScript.
- Datenbank: SQLite (leichtgewichtig für lokale/Dev); DB-Access via query helpers/ORM-light.
- Frontend: React (Vite), TypeScript, TailwindCSS + Lucide (UI-Icons), PWA-ServiceWorker.
- Mapping: Leaflet + react-leaflet; Geocoding via Nominatim.
- AI-Orchestrierung: Provider-agnostische Schicht (ai-client factory) unterstützt OpenAI und AskCodi (LLM‑Gateway).
- Mail: Nodemailer (SMTP-konfigurierbar).
- Auth: JWT für Admin-UI; kein JWT für öffentliche Endpunkte (CAPTCHA/ratelimit optional).
- Deployment & Dev: Docker, docker-compose, Makefile, `dev-manager.sh` für lokale Workflows.

**Komponenten & Dateien (Schlüssel):**
- backend/
  - src/config.ts — zentrale Konfigs, ENV-Variablen (AI_PROVIDER, AI_MODEL, ASKCODI_*, SMTP_*).
  - src/routes/* — /api/submissions, /api/chat/*, /api/admin/*, /api/auth/*, /api/verify.
  - src/services/ai-client.ts — erstellt OpenAI- oder AskCodi-kompatible Clients.
  - src/services/ai.ts — Orchestrierung, prompt templates, tools.
  - src/models/types.ts — ChatSession, ChatMessage, Submission, Ticket, AdminUser.
  - src/services/pii-filter.ts — PII-Erkennung/Maskierung.
  - src/services/mail.ts — Nodemailer-Wrap für Double-Opt-In.
  - migrations/*.sql — DB-Schema.
- frontend/
  - src/App.tsx — Formular + Chat-Entrypoint + Map-Komponenten.
  - src/components/LocationMap.tsx, AddressSearch.tsx — Karten- und Suchkomponenten.
  - src/services/api.ts — axios-Wrapper mit Basis-URL.
- admin/
  - src/pages/AIProvider.tsx — Auswahl von Provider/Model.
  - src/pages/Tickets.tsx, KnowledgeEditor.tsx, Settings.tsx
- infra/
  - docker-compose.yml, Dockerfile.backend, Dockerfile.frontend
  - Makefile, dev-manager.sh, validate-setup.sh

**Datenmodell (Kurzfassung):**
- ChatSession(id, email, status[pending,verified,completed], createdAt, updatedAt, verificationTokenHash, verificationExpiry)
- ChatMessage(id, sessionId, role[user|assistant|system], content, createdAt)
- Submission(temp) (linked to ChatSession or form submission) stores anonymized content + attachments + rawPII (encrypted at-rest optional)
- Ticket(id, submissionId, status, assignedTo, createdAt, notifiedAdmins)
- AdminUser(id, username, passwordHash, role)
- ai_logs(id, sessionId?, promptHash, provider, model, responseSummary, createdAt)

Hinweis: Roh-PII sollte niemals im LLM-Prompt auftauchen; Speicherung (falls nötig) muss verschlüsselt und nur für admin-interne Nutzung zugänglich sein.

**API-Contract (wichtigste Endpoints):**
- POST /api/submissions — klassisches Formular-Submit (antwortet 201 mit { ticketId | pendingVerificationId }).
- POST /api/chat/start — startet ChatSession (erfordert E‑Mail), returns sessionId.
- POST /api/chat/message — sendet user message, Backend filtert PII, sendet anonymisierte Anfrage an LLM, speichert assistant reply.
- POST /api/chat/finish — extrahiert strukturierte Felder aus Konversation, erzeugt Submission in pending_verification, sendet Verifikations-E‑Mail.
- GET /api/verify?token=... — validiert Token, erstellt Ticket, setzt Session/Ticket-Status auf verified/created.
- GET/PATCH /api/admin/config/ai — admin only: read/update AI provider & models.
- POST /api/admin/auth/login — returns JWT for admin UI.

(Beachte: alle LLM-Requests laufen serverseitig über `ai-client`; clientseitig niemals API-Keys oder private Konfigurationen.)

**Chat-Flow (Sequenz, technisch):**
1. User klickt "Chat-Assistent" und gibt E‑Mail (für Double-Opt-In) ein → Backend `POST /api/chat/start` erzeugt `ChatSession` mit `status: pending` und `verificationToken` (hashed storage), returns `sessionId`.
2. Frontend sendet Nachrichten an `POST /api/chat/message`.
   - Backend empfängt message, führt PII-Filter (siehe unten) aus.
   - Backend ergänzt system prompt mit non-PII Kontext (z. B. Standortkoordinaten, falls vorhanden, Auswahl von knowledge snippets aus knowledge-base) und ruft `ai-client.chat()` mit anonymized content.
   - Antwort wird gespeichert (`ChatMessage` role=assistant) und an Frontend weitergereicht.
3. Wenn Nutzer `finish` anfordert (oder nach bestimmter Intents-Erkennung), `POST /api/chat/finish` wird aufgerufen.
   - Backend fordert LLM an, die Konversation in strukturierte Felder zu überführen (function-calling-like oder prompt-engineered extraction), aber die LLM-Antwort enthält keine PII.
   - Backend speichert Submission in `pending_verification` und sendet Double-Opt-In E‑Mail mit Link `/api/verify?token=...`.
4. User klickt Verifizierungslink → `GET /api/verify` prüft Token, erstellt Ticket (Ticket-Row), sendet Admin-Notification, setzt `ChatSession.status = completed`.

**Double-Opt-In: Implementation (Pseudocode)**
- on createVerification(sessionId, email):
  - token = crypto.randomBytes(32).toString('hex');
  - storeHash = HMAC_SHA256(token, serverSecret);
  - save to ChatSession { verificationTokenHash: storeHash, verificationExpiry: Date.now()+24h }
  - sendEmail(email, verificationLinkWithToken)
- on verify(token):
  - hash = HMAC_SHA256(token, serverSecret);
  - find session where verificationTokenHash == hash and expiry > now
  - if found: create Ticket from pending Submission; mark session verified/completed.

**PII-Filter / Tunneling (Konzept & Regeln):**
- Grundsatz: Nie rohe PII an einen LLM-Provider senden.
- Was gilt als PII: Vor-/Nachname, E‑Mail-Adressen, Telefonnummern, Wohnadresse der melderPersönlichkeit (ausgenommen ist der gemeldete Standort-Adresspunkt, der für die Meldung erforderlich ist), personalisierte IDs, Geburtsdaten.
- Vorgehen zur Filterung:
  1. Auf Empfang (form oder chat) prüft serverseitig `pii-filter` und entfernt/ersetzt PII durch Platzhalter (z. B. [PERSON], [EMAIL], [PHONE]).
  2. Bei Chat: user messages → applyPIIFilter(message) → pass filtered text to LLM + system prompt that sagt: "Behandle [PERSON], [EMAIL] etc. als durch Platzhalter ersetzt; antworte ohne diese Daten.".
  3. Roh-PII wird in DB (falls benötigt) verschlüsselt-at-rest gespeichert oder in einem separaten, stark eingeschränkten Datenstore gehalten, auf den nur authorisierte Admins Zugriff haben.
- Beispiel Implementation-Strategie (Regex + Named-Entity-Hinting):
  - einfache Patterns: email regex, phone regex, id-number patterns.
  - ergänzend: NER via lightweight model (optional offline) oder heuristics.
  - alle Ersetzungen werden protokolliert (pii_logs) ohne die Originalwerte im LLM-Protokoll.

**Bilder & Anhänge:**
- Bilder werden beim Upload als Blob gespeichert (Dateisystem, S3-kompatibel oder DB BLOB) und mit Ticket verknüpft.
- Bilder werden niemals an LLMs geschickt; preprocessing (z. B. OCR) ist nur mit ausdrücklicher Admin-Freigabe und separater Policy zulässig.

**Knowledge Base & AI Verhalten:**
- Knowledge Base ist eine Git-verwaltete JSON-Struktur mit Regeln, FAQs, lokale Policy und Antwort-Snippets.
- Bei LLM-Requests wird relevante Knowledge extrahiert (lokale search / similarity) und als system prompt beigegeben, damit LLM-Antworten konform zur lokalen Policy sind.
- Admin kann Knowledge via Admin-UI editieren; Änderungen werden committet/pulled in Repo Workflow.

**Sicherheit & Betriebsregeln:**
- Secrets via ENV (dotenv) oder besser: Vault in Prod.
- Admin-Passwords nur gehashed (bcrypt/argon2), JWTs signiert und mit Ablauf.
- Rate-limiting für öffentliche Endpoints (IP-basiert), optional CAPTCHA auf Form.
- Audit-Logging für Admin-Aktionen und ai_interactions (anonymisierte Hashes).

**Dev & Deploy:**
- Lokale Entwicklung:
  - `dev-manager.sh install` → installiert deps, prüft ENV.
  - `dev-manager.sh start` → startet backend (3001), frontend (5173), admin (5174) im dev-mode.
- Container / Prod:
  - `docker-compose.yml` für schnelle Staging-Setups (db + backend + frontend)
  - Umgebung: setze AI_PROVIDER, AI_MODEL, ASKCODI_BASE_URL/KEY (falls AskCodi), SMTP_*.
- Health & Monitoring: basic health endpoints /metrics, stderr/stdout logs, optional Prometheus + Grafana.

**Test-Strategie:**
- Unit tests: PII-Filter, email/token lifecycle, DB-layer.
- Integration tests: chat flow -> extraction -> pending_verification -> verify -> ticket created.
- E2E: UI-Form + Chat flows with mocked SMTP (or local mailcatcher).

**Skalierbarkeit & Erweiterungen:**
- DB: SQLite → Postgres für Prod-Scale.
- AI-Providers: Adapter-Muster erlaubt weitere Gateways.
- Attachment-Storage: switch S3 for scalable storage.
- Add role-based access control, multi-tenant support, SSO for admins.

**Offene Punkte / ToDos (kurzpriorisiert):**
- Vollständige Implementation der Chat-Endpoints (`/api/chat/*`) und Tests für Extraktion.
- Implementieren und covern des PII-Filters mit Unit-Tests.
- Double-opt-in End-to-End Tests (inkl. SMTP-Validation).
- Admin UI: Knowledge-Editor Git-Workflow (commit/push) absichern.
- Produktions-Harden: migrate zu Postgres, secrets-rotation, CSP/HSTS für Frontend.

**Appendix: Beispiel-Prompts (anonymisierte Form)**
- System Prompt (Chat extraction):
  "You are an assistant that extracts a standardized report object from a user conversation. Replace any placeholders like [PERSON], [EMAIL], [PHONE] with those tokens; do not attempt to guess real PII. Return JSON with fields: category, description, latitude, longitude, address, postal_code, city, priority, attachments[]. If a field is missing, set it to null."

**Nächste Schritte (Empfohlene Reihenfolge):**
1. Wiederherstellen / Finalisieren von `frontend/src/App.tsx` (Form + Chat entrypoint) — erledigt/teilweise.
2. Implementieren der Backend-Chat-Endpunkte und `pii-filter`-Bibliothek.
3. Implementieren Double-Opt-In (Token + Mailer) und E2E-Test.
4. Admin: vollständige AI Provider Konfiguration und Knowledge-Editor Tests.
5. Security-Hardening + Deploy-Checklist für Produktionsumgebung.

---

Datei erzeugt: vision.md — dieses Dokument ist die Grundlage für Roadmap, PR-Reviews und Architekturentscheidungen. Soll ich jetzt die ToDos aus dem Plan konkret anpacken (z. B. PII-Filter implementieren oder Chat-Endpoints anlegen)?