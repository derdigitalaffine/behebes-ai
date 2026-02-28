# AskCodi AI Provider Integration

AskCodi ist ein OpenAI-kompatibler LLM-Gateway, der Zugriff auf mehrere AI-Modelle bietet (GPT, Claude, Gemini, etc.) ohne Vendor Lock-in.

## Setup

### 1. API-Schlüssel abrufen

1. Gehe zu https://www.askcodi.com
2. Registriere oder melde dich an
3. Erstelle eine Workspace/Project
4. Generiere einen API-Schlüssel unter "API Keys"
5. Kopiere den Schlüssel (wird nur einmal angezeigt)

### 2. Umgebungsvariable setzen

```bash
# .env.local
AI_PROVIDER=askcodi
AI_MODEL=gpt-4o
ASKCODI_API_KEY=your-api-key-here
ASKCODI_BASE_URL=https://api.askcodi.com/v1
```

### 3. Im Admin-Panel umschalten

1. Admin einloggen (admin/admin123)
2. Navigiere zu "KI-Provider"
3. Wähle "AskCodi" als Provider
4. Wähle dein Modell (gpt-4o, claude-opus, gemini-pro, etc.)
5. Speichern

## Verfügbare Modelle

### OpenAI Models
- gpt-4o
- gpt-4
- gpt-3.5-turbo

### Anthropic Models
- claude-opus
- claude-sonnet
- claude-haiku

### Google Models
- gemini-pro
- gemini-flash

### Open-Source Models
- llama-2
- mistral
- CodeLlama

## Vorteile gegenüber OpenAI

| Aspekt | OpenAI | AskCodi |
|--------|--------|---------|
| **Modelle** | Nur GPT | GPT, Claude, Gemini, Llama, etc. |
| **Flexibility** | Gebunden an OpenAI | Einfacher Wechsel zwischen Providern |
| **Custom Modelle** | Nein | Ja - eigene Agents/Prompts |
| **Guardrails** | Nein | Ja - PII-Masking, Custom Rules |
| **Kosten** | OpenAI Preise | Pass-through Preise (keine Markup) |

## Konfiguration im Code

Die Integration ist vollständig transparent. Kein Code-Wechsel nötig:

```typescript
// Backend wählt automatisch den richtigen Provider
const client = createAIClient(config); // OpenAI oder AskCodi
const response = await client.chat.completions.create({
  model: config.aiModel,
  messages: [...],
});
```

## Pricing

**AskCodi:**
- Free Tier: 100,000 Tokens (einmalig)
- Flexible Plans: $20-$200/month
- Enterprise: Custom Pricing

**Wichtig:** AskCodi ist ein Pass-through Service - du bezahlst genau was die Underlying-Provider kosten (keine zusätzlichen Markup-Gebühren).

## Troubleshooting

### "ASKCODI_API_KEY is required"
- Überprüfe .env.local: `ASKCODI_API_KEY` muss gesetzt sein
- API-Schlüssel bei https://askcodi.com generiert?

### Model nicht verfügbar
- Überprüfe verfügbare Modelle im Admin Panel
- Nicht alle Modelle sind auf allen Workspaces verfügbar

### Rate Limiting
- AskCodi Free Tier: 5 Requests/minute
- Upgradiere für höhere Limits

## Dokumentation

- **AskCodi Docs:** https://api.askcodi.com/docs
- **AskCodi Product:** https://www.askcodi.com/documentation
- **API Key Generation:** https://www.askcodi.com/documentation/generate-askcodi-api-key
- **Support:** https://discord.gg/ek8faeHfcK

## Migration von OpenAI zu AskCodi

1. AskCodi API-Schlüssel generieren (siehe oben)
2. `.env.local` aktualisieren:
   ```
   AI_PROVIDER=askcodi
   ASKCODI_API_KEY=your-key
   ```
3. Admin Panel → KI-Provider → AskCodi wählen
4. Fertig! Keine Code-Änderungen nötig.

## Zurück zu OpenAI

1. `.env.local`:
   ```
   AI_PROVIDER=openai
   ```
2. Admin Panel → KI-Provider → OpenAI wählen
3. Fertig!

---

**Version:** 1.0.0  
**Letzte Aktualisierung:** 2026-02-10
