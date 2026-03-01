# Chat Presence & Calls (Admin + OPS)

## Scope

This document describes the current production model for chat presence, multi-client call routing, and realtime event synchronization in `behebes.AI`.

## Architektur | Architecture

### EN
- XMPP remains the primary user-to-user transport.
- Presence is hybrid:
  - realtime via XMPP resource state
  - fallback via backend heartbeats (`admin_chat_presence_heartbeats`)
- Call routing is `parallel_first_accept`:
  - incoming call can ring on multiple active resources
  - first successful claim wins
  - other clients stop ringing after state sync

### DE
- XMPP bleibt der primäre User-zu-User-Transport.
- Presence nutzt ein Hybridmodell:
  - Echtzeit über XMPP-Resource-Status
  - Fallback über Backend-Heartbeats (`admin_chat_presence_heartbeats`)
- Call-Routing ist `parallel_first_accept`:
  - eingehender Anruf klingelt auf mehreren aktiven Ressourcen
  - der erste erfolgreiche Claim gewinnt
  - andere Clients stoppen das Klingeln nach State-Sync

## API Endpoints

### Bootstrap
- `GET /api/admin/chat/bootstrap`
  - includes: `features.multiClientSync`, `features.firstCatchRouting`, `features.presenceHybrid`
  - includes call policy and reliability hints:
    - `calls.enabled`
    - `calls.routingMode`
    - `xmpp.rtc.bestEffortOnly`
    - `xmpp.rtc.turnConfigured`
    - `xmpp.rtc.reliabilityHints[]`

### Presence
- `GET /api/admin/chat/presence/self`
- `PATCH /api/admin/chat/presence/self`
- `POST /api/admin/chat/presence/heartbeat`
- `GET /api/admin/chat/presence/snapshot`

### Calls
- `POST /api/admin/chat/calls/:callId/claim`
- `POST /api/admin/chat/calls/:callId/release`
- `POST /api/admin/chat/calls/:callId/media`
- `GET /api/admin/chat/calls/:callId/state`

### Realtime topics (SSE)
- `GET /api/admin/realtime/stream?topics=...`
- supported topics:
  - `tickets`
  - `workflows`
  - `ai_queue`
  - `email_queue`
  - `chat_presence`
  - `chat_calls`

## Datenmodell | Data Model

- `admin_chat_presence_heartbeats`
  - resource-level liveness for fallback presence snapshots
- `admin_chat_call_sessions`
  - call claim state, winner resource, lifecycle and expiry

Migration: `202603011530_create_chat_presence_heartbeats_and_call_sessions`
Additional migration: `202603011700_extend_chat_call_sessions_for_media_and_first_catch`

## Konfiguration | Configuration

Environment flags:
- `XMPP_ENABLED=true|false`
- `XMPP_CALLS_ENABLED=true|false`

TURN/STUN quality still depends on:
- configured ICE servers
- public reachability
- browser media policy (especially iOS/PWA)

## Betriebsnotizen | Operational Notes

### EN
- If TURN is incomplete or not publicly reachable, call mode is best-effort.
- Use `bootstrap -> xmpp.rtc.reliabilityHints` for UX messaging in clients.

### DE
- Wenn TURN unvollständig oder nicht öffentlich erreichbar ist, laufen Anrufe im Best-Effort-Modus.
- Für UX-Hinweise in den Clients die `bootstrap -> xmpp.rtc.reliabilityHints` verwenden.
