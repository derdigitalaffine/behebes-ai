/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 */

import { loadConfig } from './config.js';

const config = loadConfig();
const securedAdmin: Array<Record<string, string[]>> = [{ bearerAuth: [] }, { apiKeyAuth: [] }];

export const openApiSpec: Record<string, any> = {
  openapi: '3.0.3',
  info: {
    title: 'behebes.AI API',
    version: '1.1.0',
    description: [
      'Ausführliche API-Dokumentation für behebes.AI.',
      '',
      '## Authentifizierung',
      '- Admin-Login via `POST /api/auth/admin/login` (JWT).',
      '- Alternative für Automation: API-Token in Header `x-api-key` oder als `Bearer`-Token.',
      '',
      '## Hinweise',
      '- Einige Endpunkte liefern dynamische Strukturen; diese sind in Swagger als `additionalProperties` markiert.',
      '- Für Streaming-Endpunkte (SSE) siehe `GET /api/admin/realtime/stream`.',
    ].join('\n'),
    contact: {
      name: 'behebes.AI',
    },
    license: {
      name: 'Apache-2.0',
    },
  },
  servers: [
    { url: '/', description: 'Aktueller Host hinter Reverse-Proxy' },
    { url: `http://localhost:${config.port}`, description: 'Lokale Backend-Instanz' },
  ],
  tags: [
    { name: 'System', description: 'Health, Dokumentation und generelle Infrastruktur-Endpunkte' },
    { name: 'Admin Auth', description: 'Admin-Login, Logout, API-Tokens' },
    { name: 'Citizen Auth', description: 'Bürger-Magic-Link-Authentifizierung und Sessionstatus' },
    { name: 'Citizen Messages', description: 'In-App-Nachrichten und Push-Verwaltung für Bürgerkonten' },
    { name: 'Citizen Tickets', description: 'Ticketzugriff für angemeldete Bürgerkonten' },
    { name: 'Submissions', description: 'Öffentliche Ticket-Erstellung und Statusabfrage per Token' },
    { name: 'Validations', description: 'Double-Opt-In und manuelle Verifikation von Tickets' },
    { name: 'Workflow Public', description: 'Öffentliche Workflow-Callback-Endpunkte (Bestätigung/Datennachforderung)' },
    { name: 'Workflow Admin', description: 'Workflow-Steuerung und manuelle Eingriffe im Adminbereich' },
    { name: 'Admin Config', description: 'Zentrale Systemkonfiguration für General, Prompts und Workflows' },
    { name: 'Public Config', description: 'Öffentliche Konfiguration inkl. tenant-aware Routing' },
    { name: 'Platform', description: 'Öffentliches Platformportal inkl. Newsblog' },
    { name: 'Tickets', description: 'Staff-Ticket-Endpoints für Backoffice und Dashboard' },
    { name: 'Sessions', description: 'Admin-Session-Verwaltung' },
    { name: 'Realtime', description: 'Server-Sent Events für Admin-Live-Updates' },
    { name: 'Admin Chat', description: 'Messenger- und XMPP-Bootstrap für Admin/Ops' },
    { name: 'LLM Hub', description: 'LLM-Providerverbindungen, Modellkatalog und Task-Routing' },
    { name: 'AI Queue', description: 'KI-Queue, Monitoring und Testläufe' },
    { name: 'Admin Push', description: 'WebPush für Staff-Clients (Ops/Admin)' },
    { name: 'Ops Mobile', description: 'Mobile-First Dashboard-Aggregationen für das Ops-Frontend' },
    { name: 'Admin Imports', description: 'CSV-Importjobs für Benutzer, Organisationsstruktur und Leistungen' },
    { name: 'Services', description: 'Leistungsverwaltung inklusive Verknüpfungen zu Orga, Mitarbeitenden und Formularen' },
    { name: 'Keywording', description: 'Mehrstufige, leistungsbasierte KI-Verschlagwortung für Orga-Einheiten und Mitarbeitende' },
    { name: 'Responsibility', description: 'Verwaltungs-Zuständigkeitsprüfung und Konfiguration' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Admin JWT aus /api/auth/admin/login',
      },
      apiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
        description: 'Admin API-Token für automatisierte Integrationen',
      },
    },
    responses: {
      UnauthorizedError: {
        description: 'Authentifizierung fehlt oder ist ungültig.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            example: { error: 'Authentifizierung erforderlich' },
          },
        },
      },
      ForbiddenError: {
        description: 'Authentifiziert, aber nicht ausreichend berechtigt.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            example: { error: 'Admin-Rechte erforderlich' },
          },
        },
      },
      NotFoundError: {
        description: 'Die angeforderte Ressource wurde nicht gefunden.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            example: { message: 'Nicht gefunden' },
          },
        },
      },
      ValidationError: {
        description: 'Ungültige Eingabeparameter.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            example: { message: 'Ungültige Eingabe' },
          },
        },
      },
      InternalError: {
        description: 'Interner Verarbeitungsfehler.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiError' },
            example: { message: 'Interner Fehler' },
          },
        },
      },
    },
    schemas: {
      HealthStatus: {
        type: 'object',
        required: ['status', 'timestamp'],
        properties: {
          status: { type: 'string', example: 'ok' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      ApiError: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          message: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      MessageResponse: {
        type: 'object',
        properties: {
          message: { type: 'string' },
        },
      },
      AdminUserShort: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          username: { type: 'string' },
          role: { type: 'string', example: 'ADMIN' },
          email: { type: 'string' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
        },
      },
      AdminLoginRequest: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', example: 'admin' },
          password: { type: 'string', format: 'password', example: 'admin123' },
          remember: { type: 'boolean', example: true },
        },
      },
      AdminLoginResponse: {
        type: 'object',
        required: ['token', 'user'],
        properties: {
          token: { type: 'string' },
          sessionId: { type: 'string', nullable: true },
          user: { $ref: '#/components/schemas/AdminUserShort' },
        },
      },
      CitizenMagicLinkRequest: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' },
          frontendToken: { type: 'string', description: 'Optionales Frontend-Profil-Token' },
          purpose: { type: 'string', enum: ['login', 'ticket_status', 'generic'] },
          redirectPath: { type: 'string', example: '/me' },
        },
      },
      CitizenSessionResponse: {
        type: 'object',
        properties: {
          authenticated: { type: 'boolean' },
          email: { type: 'string' },
          emailNormalized: { type: 'string' },
          accountId: { type: 'string' },
          expiresAt: { type: 'string', format: 'date-time' },
          frontendProfileId: { type: 'string' },
          frontendProfileName: { type: 'string' },
          frontendToken: { type: 'string' },
          citizenAuthEnabled: { type: 'boolean' },
          authenticatedIntakeWorkflowTemplateId: { type: 'string', nullable: true },
          pushAvailable: { type: 'boolean' },
          pushPublicKey: { type: 'string', nullable: true },
        },
      },
      PublicConfigResponse: {
        type: 'object',
        properties: {
          maintenanceMode: { type: 'boolean' },
          maintenanceMessage: { type: 'string' },
          defaultLanguage: { type: 'string' },
          languages: { type: 'array', items: { type: 'string' } },
          restrictLocations: { type: 'boolean' },
          allowedLocations: { type: 'array', items: { type: 'string' } },
          appName: { type: 'string' },
          routing: {
            type: 'object',
            properties: {
              rootMode: { type: 'string', enum: ['platform', 'tenant'] },
              rootTenantId: { type: 'string' },
              platformPath: { type: 'string', example: '/plattform' },
              tenantBasePath: { type: 'string', example: '/c' },
              resolvedTenantSlug: { type: 'string' },
              canonicalBasePath: { type: 'string' },
              tenantMismatch: { type: 'boolean' },
            },
          },
        },
      },
      AdminPushSubscriptionPayload: {
        type: 'object',
        properties: {
          subscription: {
            type: 'object',
            additionalProperties: true,
            properties: {
              endpoint: { type: 'string' },
              keys: {
                type: 'object',
                properties: {
                  p256dh: { type: 'string' },
                  auth: { type: 'string' },
                },
              },
            },
          },
        },
      },
      OpsDashboardSummary: {
        type: 'object',
        properties: {
          generatedAt: { type: 'string', format: 'date-time' },
          role: { type: 'string' },
          filters: {
            type: 'object',
            properties: {
              tenantId: { type: 'string', nullable: true },
              orgUnitId: { type: 'string', nullable: true },
              timeRange: { type: 'string', enum: ['24h', '7d', '30d'] },
            },
          },
          me: {
            type: 'object',
            properties: {
              openTickets: { type: 'integer' },
              overdueTickets: { type: 'integer' },
              openTasks: { type: 'integer' },
              unreadChatCount: { type: 'integer' },
              openNotifications: { type: 'integer' },
            },
          },
          team: {
            type: 'object',
            properties: {
              openTickets: { type: 'integer' },
              processingTickets: { type: 'integer' },
            },
          },
          recent: {
            type: 'object',
            properties: {
              tickets: { type: 'array', items: { type: 'object', additionalProperties: true } },
              workflowHotspots: { type: 'array', items: { type: 'object', additionalProperties: true } },
              tasks: { type: 'array', items: { type: 'object', additionalProperties: true } },
            },
          },
        },
      },
      ChatPresenceSettings: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['online', 'away', 'dnd', 'offline', 'custom'] },
          label: { type: 'string' },
          color: { type: 'string', nullable: true },
          emoji: { type: 'string', nullable: true },
          expiresAt: { type: 'string', format: 'date-time', nullable: true },
          updatedAt: { type: 'string', format: 'date-time', nullable: true },
          source: { type: 'string', enum: ['xmpp', 'fallback'], nullable: true },
          lastSeenAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      ChatPresenceSnapshotEntry: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          status: { type: 'string', enum: ['online', 'away', 'dnd', 'offline', 'custom'] },
          label: { type: 'string' },
          color: { type: 'string' },
          emoji: { type: 'string', nullable: true },
          source: { type: 'string', enum: ['xmpp', 'fallback'] },
          lastSeenAt: { type: 'string', format: 'date-time', nullable: true },
          resources: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                resource: { type: 'string' },
                transport: { type: 'string', enum: ['xmpp', 'sse', 'poll', 'hybrid'] },
                appKind: { type: 'string', enum: ['admin', 'ops'] },
                lastSeenAt: { type: 'string', format: 'date-time', nullable: true },
              },
            },
          },
        },
      },
      ChatCallSessionState: {
        type: 'object',
        properties: {
          callId: { type: 'string' },
          won: { type: 'boolean', nullable: true },
          state: {
            type: 'string',
            enum: ['proposed', 'ringing', 'claimed', 'connecting', 'active', 'ended', 'failed', 'cancelled', 'timeout', 'rejected'],
          },
          claimedByUserId: { type: 'string', nullable: true },
          claimedByResource: { type: 'string', nullable: true },
          callerUserId: { type: 'string', nullable: true },
          calleeUserId: { type: 'string', nullable: true },
          expiresAt: { type: 'string', format: 'date-time', nullable: true },
          endedAt: { type: 'string', format: 'date-time', nullable: true },
          updatedAt: { type: 'string', format: 'date-time', nullable: true },
          routingMode: { type: 'string', example: 'parallel_first_accept' },
          reason: { type: 'string', nullable: true },
          resource: { type: 'string', nullable: true },
        },
      },
      ChatBootstrapResponse: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          features: {
            type: 'object',
            properties: {
              multiClientSync: { type: 'boolean' },
              firstCatchRouting: { type: 'boolean' },
              presenceHybrid: { type: 'boolean' },
            },
          },
          xmpp: {
            type: 'object',
            properties: {
              domain: { type: 'string' },
              mucService: { type: 'string' },
              websocketUrl: { type: 'string' },
              jid: { type: 'string' },
              username: { type: 'string' },
              password: { type: 'string' },
              resource: { type: 'string' },
              rtc: {
                type: 'object',
                properties: {
                  iceServers: { type: 'array', items: { type: 'object', additionalProperties: true } },
                  bestEffortOnly: { type: 'boolean' },
                  turnConfigured: { type: 'boolean' },
                  reliabilityHints: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
          me: { type: 'object', additionalProperties: true },
          settings: {
            type: 'object',
            properties: {
              emailNotificationsDefault: { type: 'boolean' },
              presence: { $ref: '#/components/schemas/ChatPresenceSettings' },
            },
          },
          calls: {
            type: 'object',
            properties: {
              enabled: { type: 'boolean' },
              routingMode: { type: 'string', example: 'parallel_first_accept' },
              policyReason: { type: 'string' },
            },
          },
          assistant: { type: 'object', additionalProperties: true },
          systemUser: { type: 'object', additionalProperties: true },
          contacts: { type: 'array', items: { type: 'object', additionalProperties: true } },
          directory: {
            type: 'object',
            properties: {
              orgUnits: { type: 'array', items: { type: 'object', additionalProperties: true } },
              contactScopes: { type: 'object', additionalProperties: true },
            },
          },
          groups: {
            type: 'object',
            properties: {
              org: { type: 'array', items: { type: 'object', additionalProperties: true } },
              custom: { type: 'array', items: { type: 'object', additionalProperties: true } },
            },
          },
        },
      },
      SystemUpdateStatus: {
        type: 'object',
        properties: {
          currentVersion: { type: 'string' },
          latestTagVersion: { type: 'string', nullable: true },
          build: {
            type: 'object',
            properties: {
              appVersion: { type: 'string' },
              envBuildId: { type: 'string', nullable: true },
              envBuildTime: { type: 'string', nullable: true },
              envCommitRef: { type: 'string', nullable: true },
            },
          },
          checkedAt: { type: 'string', format: 'date-time' },
          runtimeType: { type: 'string', enum: ['docker-compose', 'node'] },
          git: {
            type: 'object',
            properties: {
              available: { type: 'boolean' },
              branch: { type: 'string', nullable: true },
              headCommit: { type: 'string', nullable: true },
              describe: { type: 'string', nullable: true },
              dirty: { type: 'boolean' },
            },
          },
          backup: {
            type: 'object',
            properties: {
              available: { type: 'boolean' },
              latestPath: { type: 'string', nullable: true },
              latestAt: { type: 'string', format: 'date-time', nullable: true },
              ageHours: { type: 'number', nullable: true },
              artifactCount: { type: 'integer' },
              requiredMaxAgeHours: { type: 'integer' },
              isFresh: { type: 'boolean' },
            },
          },
          migrations: {
            type: 'object',
            properties: {
              schemaMigrationsTable: { type: 'boolean' },
              appliedCount: { type: 'integer' },
              migrationFilesCount: { type: 'integer' },
              pendingCount: { type: 'integer' },
              consistent: { type: 'boolean' },
            },
          },
        },
      },
      SystemUpdatePreflightReport: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['status_check', 'preflight'], nullable: true },
          ok: { type: 'boolean' },
          blockedReasons: { type: 'array', items: { type: 'string' } },
          durationMs: { type: 'integer' },
          checkedAt: { type: 'string', format: 'date-time' },
          checks: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              properties: {
                ok: { type: 'boolean' },
                detail: { type: 'string' },
              },
            },
          },
          status: { $ref: '#/components/schemas/SystemUpdateStatus' },
        },
      },
      SystemUpdateRunbook: {
        type: 'object',
        properties: {
          runtimeType: { type: 'string', enum: ['docker-compose', 'node'] },
          targetTag: { type: 'string', nullable: true },
          generatedAt: { type: 'string', format: 'date-time' },
          commands: { type: 'array', items: { type: 'string' } },
          notes: { type: 'array', items: { type: 'string' } },
        },
      },
      SystemUpdateHistoryEntry: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          adminUserId: { type: 'string', nullable: true },
          username: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time', nullable: true },
          report: { $ref: '#/components/schemas/SystemUpdatePreflightReport' },
        },
      },
      ImportJob: {
        type: 'object',
        additionalProperties: true,
        properties: {
          id: { type: 'string' },
          tenantId: { type: 'string', nullable: true },
          kind: { type: 'string', enum: ['users', 'org_units'] },
          status: {
            type: 'string',
            enum: ['draft', 'uploaded', 'preview_ready', 'running', 'completed', 'failed', 'cancelled'],
          },
          processedRows: { type: 'integer' },
          totalRows: { type: 'integer' },
          preview: { type: 'object', additionalProperties: true },
          report: { type: 'object', additionalProperties: true },
          events: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      },
      ResponsibilityCandidate: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['org_unit', 'user'] },
          id: { type: 'string' },
          name: { type: 'string' },
          confidence: { type: 'number' },
          reasoning: { type: 'string' },
          matchedKeywords: { type: 'array', items: { type: 'string' } },
        },
      },
      ResponsibilityDecision: {
        type: 'object',
        additionalProperties: true,
        properties: {
          query: { type: 'string' },
          tenantId: { type: 'string', nullable: true },
          candidates: { type: 'array', items: { $ref: '#/components/schemas/ResponsibilityCandidate' } },
          fallbackUsed: { type: 'boolean' },
          source: { type: 'string' },
        },
      },
      TicketSummary: {
        type: 'object',
        additionalProperties: true,
        properties: {
          id: { type: 'string' },
          status: { type: 'string', example: 'open' },
          priority: { type: 'string', example: 'medium' },
          category: { type: 'string' },
          tenantId: { type: 'string' },
          owningOrgUnitId: { type: 'string' },
          assignedTo: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      TicketListResponse: {
        type: 'array',
        items: { $ref: '#/components/schemas/TicketSummary' },
      },
      CitizenTicketSummary: {
        type: 'object',
        properties: {
          ticketId: { type: 'string' },
          category: { type: 'string' },
          priority: { type: 'string' },
          status: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          address: { type: 'string' },
          postalCode: { type: 'string' },
          city: { type: 'string' },
          latitude: { type: 'number', nullable: true },
          longitude: { type: 'number', nullable: true },
          redmineIssueId: { type: 'integer', nullable: true },
          assignedTo: { type: 'string', nullable: true },
          responsibilityAuthority: { type: 'string', nullable: true },
          citizenName: { type: 'string' },
        },
      },
      CitizenTicketListResponse: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/CitizenTicketSummary' },
          },
          nextCursor: { type: 'string', nullable: true },
          limit: { type: 'integer' },
        },
      },
      AdminSessionItem: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          adminUserId: { type: 'string' },
          username: { type: 'string' },
          role: { type: 'string' },
          ipAddress: { type: 'string' },
          userAgent: { type: 'string' },
          rememberMe: { type: 'boolean' },
          issuedAt: { type: 'string', format: 'date-time' },
          lastSeenAt: { type: 'string', format: 'date-time' },
          expiresAt: { type: 'string', format: 'date-time' },
          loggedOutAt: { type: 'string', format: 'date-time', nullable: true },
          isActive: { type: 'boolean' },
          logoutReason: { type: 'string', nullable: true },
          sessionCookie: { type: 'string' },
          isExpired: { type: 'boolean' },
        },
      },
      AdminSessionListResponse: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/AdminSessionItem' },
          },
          total: { type: 'integer' },
          counts: {
            type: 'object',
            properties: {
              active: { type: 'integer' },
              inactive: { type: 'integer' },
            },
          },
          status: { type: 'string', enum: ['active', 'all', 'inactive'] },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
      },
      LlmConnection: {
        type: 'object',
        additionalProperties: true,
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          baseUrl: { type: 'string', example: 'https://api.openai.com/v1' },
          authMode: { type: 'string', enum: ['api_key', 'oauth'] },
          apiKey: { type: 'string', description: 'Wird maskiert zurückgegeben (***).' },
          oauthTokenId: { type: 'string' },
          enabled: { type: 'boolean' },
          defaultModel: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      LlmConnectionListResponse: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/LlmConnection' },
          },
        },
      },
      LlmConnectionUpsertResponse: {
        type: 'object',
        properties: {
          item: { $ref: '#/components/schemas/LlmConnection' },
          message: { type: 'string' },
        },
      },
      LlmModel: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          vision: { type: 'boolean' },
          contextWindow: { type: 'integer' },
          raw: {
            type: 'object',
            additionalProperties: true,
          },
        },
      },
      LlmModelListResponse: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/LlmModel' },
          },
          refreshed: { type: 'boolean' },
          message: { type: 'string' },
        },
      },
      LlmTaskRoutingResponse: {
        type: 'object',
        properties: {
          routing: {
            type: 'object',
            additionalProperties: true,
          },
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                taskKey: { type: 'string' },
                requiresVision: { type: 'boolean' },
              },
            },
          },
          message: { type: 'string' },
        },
      },
      AiQueueEntry: {
        type: 'object',
        additionalProperties: true,
        properties: {
          id: { type: 'string' },
          purpose: { type: 'string' },
          taskType: { type: 'string' },
          status: {
            type: 'string',
            enum: ['pending', 'retry', 'processing', 'done', 'failed', 'cancelled'],
          },
          providerName: { type: 'string' },
          model: { type: 'string' },
          attempts: { type: 'integer' },
          maxAttempts: { type: 'integer' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      AiQueueListResponse: {
        type: 'object',
        additionalProperties: true,
        properties: {
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/AiQueueEntry' },
          },
          counts: {
            type: 'object',
            additionalProperties: { type: 'integer' },
          },
          total: { type: 'integer' },
          status: { type: 'string' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
      },
      AiQueueTestRunRequest: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: { type: 'string' },
          purpose: { type: 'string', example: 'admin_ai_queue_test_run' },
          taskKey: { type: 'string' },
          connectionId: { type: 'string' },
          modelId: { type: 'string' },
          waitTimeoutMs: { type: 'integer', minimum: 1000, maximum: 900000 },
        },
      },
      AiQueueTestRunResponse: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          output: { type: 'object', additionalProperties: true },
          provider: { type: 'string' },
          connectionId: { type: 'string' },
          model: { type: 'string' },
          taskKey: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      AdminApiToken: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          tokenPrefix: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          expiresAt: { type: 'string', format: 'date-time', nullable: true },
          lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
          revokedAt: { type: 'string', format: 'date-time', nullable: true },
          revokeReason: { type: 'string', nullable: true },
          isExpired: { type: 'boolean' },
          isActive: { type: 'boolean' },
        },
      },
      AdminApiTokenListResponse: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/AdminApiToken' },
          },
          counts: {
            type: 'object',
            properties: {
              active: { type: 'integer' },
              revoked: { type: 'integer' },
              expired: { type: 'integer' },
              total: { type: 'integer' },
            },
          },
          status: { type: 'string', enum: ['active', 'revoked', 'all'] },
        },
      },
      AdminApiTokenCreateRequest: {
        type: 'object',
        properties: {
          label: { type: 'string', maxLength: 120 },
          expiresAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      AdminApiTokenCreateResponse: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          token: { type: 'string', description: 'Nur in dieser Antwort sichtbar.' },
          item: { $ref: '#/components/schemas/AdminApiToken' },
        },
      },
      PlatformBlogPost: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          slug: { type: 'string' },
          title: { type: 'string' },
          excerpt: { type: 'string' },
          contentMd: { type: 'string' },
          status: { type: 'string', enum: ['draft', 'scheduled', 'published', 'archived'] },
          effectiveStatus: { type: 'string', enum: ['draft', 'scheduled', 'published', 'archived'] },
          isPublished: { type: 'boolean' },
          publishedAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time', nullable: true },
          updatedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      PlatformBlogListResponse: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/PlatformBlogPost' },
          },
          total: { type: 'integer' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
      },
      PlatformBlogSingleResponse: {
        type: 'object',
        properties: {
          item: { $ref: '#/components/schemas/PlatformBlogPost' },
        },
      },
      PlatformBlogMutationRequest: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 240 },
          slug: { type: 'string', maxLength: 160 },
          excerpt: { type: 'string', maxLength: 700 },
          contentMd: { type: 'string' },
          status: { type: 'string', enum: ['draft', 'scheduled', 'published', 'archived'] },
          publishedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      PlatformBlogMutationResponse: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          item: { $ref: '#/components/schemas/PlatformBlogPost' },
        },
      },
      RealtimeReadyEvent: {
        type: 'object',
        properties: {
          connectedAt: { type: 'string', format: 'date-time' },
          topics: {
            type: 'array',
            items: { type: 'string', enum: ['tickets', 'workflows', 'ai_queue', 'email_queue'] },
          },
        },
      },
      RealtimeUpdateEvent: {
        type: 'object',
        additionalProperties: true,
        properties: {
          topic: { type: 'string', enum: ['tickets', 'workflows', 'ai_queue', 'email_queue'] },
          type: { type: 'string' },
          at: { type: 'string', format: 'date-time' },
        },
      },
      SubmissionCreateRequest: {
        type: 'object',
        required: ['name', 'email', 'description'],
        properties: {
          name: { type: 'string', example: 'Max Mustermann' },
          email: { type: 'string', format: 'email', example: 'max@example.org' },
          issueType: { type: 'string', example: 'Schlagloch' },
          description: { type: 'string', minLength: 10 },
          latitude: { type: 'number', nullable: true },
          longitude: { type: 'number', nullable: true },
          address: { type: 'string', nullable: true },
          postalCode: { type: 'string', nullable: true },
          city: { type: 'string', nullable: true },
          frontendToken: { type: 'string', nullable: true },
          language: { type: 'string', nullable: true },
          languageName: { type: 'string', nullable: true },
          imageBase64: {
            type: 'string',
            nullable: true,
            description: 'Legacy-Single-Image als Data-URL.',
          },
          images: {
            type: 'array',
            nullable: true,
            items: {
              type: 'object',
              properties: {
                dataUrl: { type: 'string' },
                fileName: { type: 'string' },
              },
            },
          },
        },
      },
      SubmissionCreateResponse: {
        type: 'object',
        properties: {
          ticketId: { type: 'string' },
          workflowIntakeQueued: { type: 'boolean' },
          imageUploadFallbackUsed: { type: 'boolean' },
          imageUploadFallbackCode: { type: 'string', nullable: true },
          message: { type: 'string' },
        },
      },
      SubmissionStatusResponse: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ticketId: { type: 'string' },
          status: { type: 'string' },
          category: { type: 'string' },
          priority: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time', nullable: true },
          workflowInfo: { type: 'string' },
        },
      },
      ValidationSendRequest: {
        type: 'object',
        required: ['ticketId', 'submissionId', 'citizenEmail'],
        properties: {
          ticketId: { type: 'string' },
          submissionId: { type: 'string' },
          citizenEmail: { type: 'string', format: 'email' },
          citizenName: { type: 'string' },
          language: { type: 'string' },
          languageName: { type: 'string' },
        },
      },
      ValidationVerifyResponse: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          ticketId: { type: 'string' },
          processingQueued: { type: 'boolean' },
          autoLoginApplied: { type: 'boolean' },
        },
      },
      ValidationStatusResponse: {
        type: 'object',
        properties: {
          ticketId: { type: 'string' },
          isValidated: { type: 'boolean' },
          validatedAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time', nullable: true },
          expiresAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      CitizenMessageItem: {
        type: 'object',
        additionalProperties: true,
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
          read: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      CitizenMessageListResponse: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { $ref: '#/components/schemas/CitizenMessageItem' },
          },
          total: { type: 'integer' },
          unreadCount: { type: 'integer' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
      },
      WorkflowDecisionRequest: {
        type: 'object',
        properties: {
          decision: { type: 'string', enum: ['approve', 'reject'], default: 'approve' },
          defer: { type: 'boolean', default: false },
        },
      },
      WorkflowConfigResponse: {
        type: 'object',
        additionalProperties: true,
        properties: {
          enabled: { type: 'boolean' },
          defaultExecutionMode: { type: 'string' },
          autoTriggerOnEmailVerified: { type: 'boolean' },
          templates: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
            },
          },
        },
      },
      PromptConfigResponse: {
        type: 'object',
        properties: {
          prompts: {
            type: 'object',
            additionalProperties: { type: 'string' },
          },
          sources: {
            type: 'object',
            additionalProperties: { type: 'string' },
          },
        },
      },
      GeneralSettingsResponse: {
        type: 'object',
        additionalProperties: true,
        properties: {
          callbackMode: { type: 'string', enum: ['auto', 'custom'] },
          callbackUrl: { type: 'string' },
          appName: { type: 'string' },
          maintenanceMode: { type: 'boolean' },
          maintenanceMessage: { type: 'string' },
          routing: { $ref: '#/components/schemas/PublicConfigResponse/properties/routing' },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        operationId: 'getSystemHealth',
        summary: 'Interner Health-Check.',
        responses: {
          '200': {
            description: 'Backend ist erreichbar.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthStatus' },
              },
            },
          },
        },
      },
    },
    '/api/health': {
      get: {
        tags: ['System'],
        operationId: 'getApiHealth',
        summary: 'Öffentlicher API-Health-Check.',
        responses: {
          '200': {
            description: 'API ist erreichbar.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthStatus' },
              },
            },
          },
        },
      },
    },
    '/api/docs.json': {
      get: {
        tags: ['System'],
        operationId: 'getOpenApiSpec',
        summary: 'OpenAPI-Spezifikation als JSON.',
        responses: {
          '200': {
            description: 'Vollständige OpenAPI-Spezifikation.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: true,
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/admin/login': {
      post: {
        tags: ['Admin Auth'],
        operationId: 'adminLogin',
        summary: 'Admin-Login mit Benutzername/Passwort.',
        description: 'Liefert JWT für Bearer-Auth. Optional mit langlebiger Session (`remember=true`).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AdminLoginRequest' },
              example: {
                username: 'admin',
                password: 'admin123',
                remember: true,
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Login erfolgreich.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AdminLoginResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '429': {
            description: 'Zu viele Login-Versuche (Rate-Limit).',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiError' },
              },
            },
          },
        },
      },
    },
    '/api/auth/admin/logout': {
      post: {
        tags: ['Admin Auth'],
        operationId: 'adminLogout',
        summary: 'Aktuelle Admin-Session abmelden.',
        security: securedAdmin,
        responses: {
          '200': {
            description: 'Logout erfolgreich.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MessageResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
        },
      },
    },
    '/api/citizen/auth/request-link': {
      post: {
        tags: ['Citizen Auth'],
        operationId: 'requestCitizenMagicLink',
        summary: 'Magic-Link für Bürger-Anmeldung anfordern.',
        description: 'Antwort ist immer generisch (`202`), um E-Mail-Enumeration zu vermeiden.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CitizenMagicLinkRequest' },
            },
          },
        },
        responses: {
          '202': {
            description: 'Anfrage angenommen.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MessageResponse' },
              },
            },
          },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/citizen/auth/verify': {
      get: {
        tags: ['Citizen Auth'],
        operationId: 'verifyCitizenMagicLink',
        summary: 'Magic-Link verifizieren und Session setzen.',
        description: 'Leitet auf Login oder Zielseite innerhalb des kanonischen Tenant-Pfades um.',
        parameters: [
          { in: 'query', name: 'token', required: true, schema: { type: 'string' } },
          { in: 'query', name: 'frontendToken', required: false, schema: { type: 'string' } },
          { in: 'query', name: 'profileToken', required: false, schema: { type: 'string' } },
        ],
        responses: {
          '302': {
            description: 'Redirect auf Login- oder Zielseite.',
          },
        },
      },
    },
    '/api/citizen/auth/session': {
      get: {
        tags: ['Citizen Auth'],
        operationId: 'getCitizenAuthSession',
        summary: 'Sessionstatus des aktuellen Bürgerkontos.',
        parameters: [
          { in: 'query', name: 'frontendToken', required: false, schema: { type: 'string' } },
          { in: 'query', name: 'profileToken', required: false, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Sessionstatus inkl. Push-Verfügbarkeit.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CitizenSessionResponse' },
              },
            },
          },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/citizen/auth/logout': {
      post: {
        tags: ['Citizen Auth'],
        operationId: 'logoutCitizenAuthSession',
        summary: 'Bürger-Session beenden.',
        responses: {
          '200': {
            description: 'Session beendet.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/citizen/tickets': {
      get: {
        tags: ['Citizen Tickets'],
        operationId: 'listCitizenTickets',
        summary: 'Tickets des angemeldeten Bürgerkontos laden.',
        parameters: [
          { in: 'query', name: 'status', required: false, schema: { type: 'string' } },
          { in: 'query', name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 50 } },
          { in: 'query', name: 'cursor', required: false, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Ticketliste mit Cursor-Pagination.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CitizenTicketListResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/citizen/tickets/{ticketId}': {
      get: {
        tags: ['Citizen Tickets'],
        operationId: 'getCitizenTicket',
        summary: 'Einzelnes Ticket eines Bürgerkontos abrufen.',
        parameters: [
          {
            in: 'path',
            name: 'ticketId',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Ticketdetails.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: true,
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/citizen/tickets/{ticketId}/history': {
      get: {
        tags: ['Citizen Tickets'],
        operationId: 'getCitizenTicketHistory',
        summary: 'Öffentliche Historie eines Bürger-Tickets laden.',
        parameters: [
          { in: 'path', name: 'ticketId', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Historie inklusive öffentlicher Kommentare und Workflow-Meilensteinen.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    ticketId: { type: 'string' },
                    status: { type: 'string' },
                    comments: {
                      type: 'array',
                      items: { type: 'object', additionalProperties: true },
                    },
                    milestones: {
                      type: 'array',
                      items: { type: 'object', additionalProperties: true },
                    },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/citizen/tickets/{ticketId}/images/{imageId}': {
      get: {
        tags: ['Citizen Tickets'],
        operationId: 'getCitizenTicketImage',
        summary: 'Ticketbild für berechtigtes Bürgerkonto laden.',
        parameters: [
          { in: 'path', name: 'ticketId', required: true, schema: { type: 'string' } },
          { in: 'path', name: 'imageId', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Binäre Bilddaten.',
            content: {
              'image/*': {
                schema: {
                  type: 'string',
                  format: 'binary',
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/api/citizen/messages': {
      get: {
        tags: ['Citizen Messages'],
        operationId: 'listCitizenMessages',
        summary: 'Nachrichten des aktuellen Bürgerkontos abrufen.',
        parameters: [
          {
            in: 'query',
            name: 'status',
            required: false,
            schema: { type: 'string', enum: ['all', 'read', 'unread'], default: 'all' },
          },
          { in: 'query', name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100 } },
          { in: 'query', name: 'offset', required: false, schema: { type: 'integer', minimum: 0 } },
        ],
        responses: {
          '200': {
            description: 'Nachrichtenliste mit Pagination.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CitizenMessageListResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/citizen/messages/unread-count': {
      get: {
        tags: ['Citizen Messages'],
        operationId: 'getCitizenUnreadCount',
        summary: 'Anzahl ungelesener Bürger-Nachrichten.',
        responses: {
          '200': {
            description: 'Unread Counter.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    unreadCount: { type: 'integer' },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/citizen/messages/{messageId}': {
      patch: {
        tags: ['Citizen Messages'],
        operationId: 'updateCitizenMessageReadState',
        summary: 'Gelesen/Ungelesen-Status einer Nachricht setzen.',
        parameters: [
          { in: 'path', name: 'messageId', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  read: { type: 'boolean', default: true },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Status aktualisiert.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    unreadCount: { type: 'integer' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/api/citizen/messages/read-all': {
      post: {
        tags: ['Citizen Messages'],
        operationId: 'markAllCitizenMessagesRead',
        summary: 'Alle Nachrichten des Bürgerkontos als gelesen markieren.',
        responses: {
          '200': {
            description: 'Markierung abgeschlossen.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    changed: { type: 'integer' },
                    unreadCount: { type: 'integer' },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/citizen/push/subscribe': {
      post: {
        tags: ['Citizen Messages'],
        operationId: 'subscribeCitizenPush',
        summary: 'Push-Subscription für aktuelles Bürgerkonto registrieren.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  subscription: {
                    type: 'object',
                    additionalProperties: true,
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Subscription gespeichert.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    id: { type: 'string' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '409': {
            description: 'Push ist aktuell deaktiviert.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiError' },
              },
            },
          },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/citizen/push/unsubscribe': {
      post: {
        tags: ['Citizen Messages'],
        operationId: 'unsubscribeCitizenPush',
        summary: 'Push-Subscription (optional endpoint-spezifisch) entfernen.',
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  endpoint: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Subscription entfernt.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    revoked: { type: 'integer' },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/push/public-key': {
      get: {
        tags: ['Admin Push'],
        operationId: 'getAdminPushPublicKey',
        summary: 'Liefert den VAPID Public Key und Availability-Status für Staff Push.',
        security: securedAdmin,
        responses: {
          '200': {
            description: 'Push-Konfiguration geladen.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    available: { type: 'boolean' },
                    publicKey: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
        },
      },
    },
    '/api/admin/push/subscribe': {
      post: {
        tags: ['Admin Push'],
        operationId: 'subscribeAdminPush',
        summary: 'Registriert/aktualisiert eine Staff Push-Subscription.',
        security: securedAdmin,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AdminPushSubscriptionPayload' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Subscription gespeichert.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    id: { type: 'string' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '409': {
            description: 'Push ist serverseitig deaktiviert.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiError' },
              },
            },
          },
        },
      },
    },
    '/api/admin/push/unsubscribe': {
      post: {
        tags: ['Admin Push'],
        operationId: 'unsubscribeAdminPush',
        summary: 'Widerruft eine spezifische oder alle Staff Push-Subscriptions.',
        security: securedAdmin,
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  endpoint: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Subscription(s) widerrufen.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    revoked: { type: 'integer' },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
        },
      },
    },
    '/api/admin/push/test': {
      post: {
        tags: ['Admin Push'],
        operationId: 'testAdminPush',
        summary: 'Löst eine Test-Push-Nachricht für den aktuell angemeldeten User aus.',
        security: securedAdmin,
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  body: { type: 'string' },
                  url: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Testversand ausgeführt.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    attempted: { type: 'integer' },
                    succeeded: { type: 'integer' },
                    failed: { type: 'integer' },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
        },
      },
    },
    '/api/admin/chat/bootstrap': {
      get: {
        tags: ['Admin Chat'],
        operationId: 'getAdminChatBootstrap',
        summary: 'Lädt Chat/XMPP-Bootstrapdaten für Admin- und Ops-Messenger.',
        security: securedAdmin,
        responses: {
          '200': {
            description: 'Bootstrap erfolgreich geladen.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ChatBootstrapResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
    },
    '/api/admin/chat/presence/self': {
      get: {
        tags: ['Admin Chat'],
        operationId: 'getAdminChatPresenceSelf',
        summary: 'Lädt den eigenen Presence-Status inklusive Hybrid-Quelle.',
        security: securedAdmin,
        responses: {
          '200': {
            description: 'Presence-Status geladen.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    presence: { $ref: '#/components/schemas/ChatPresenceSettings' },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
        },
      },
      patch: {
        tags: ['Admin Chat'],
        operationId: 'updateAdminChatPresenceSelf',
        summary: 'Aktualisiert den eigenen Presence-Status.',
        security: securedAdmin,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: { type: 'string', enum: ['online', 'away', 'dnd', 'offline', 'custom'] },
                  label: { type: 'string' },
                  color: { type: 'string' },
                  emoji: { type: 'string' },
                  expiresAt: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Presence-Status gespeichert.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string' },
                    presence: { $ref: '#/components/schemas/ChatPresenceSettings' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
        },
      },
    },
    '/api/admin/chat/presence/heartbeat': {
      post: {
        tags: ['Admin Chat'],
        operationId: 'createAdminChatPresenceHeartbeat',
        summary: 'Schreibt einen resource-spezifischen Presence-Heartbeat für Hybrid-Resync.',
        security: securedAdmin,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['resource'],
                properties: {
                  resource: { type: 'string', example: 'ops-iphone14pro' },
                  transport: { type: 'string', enum: ['xmpp', 'sse', 'poll', 'hybrid'] },
                  appKind: { type: 'string', enum: ['admin', 'ops'] },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Heartbeat gespeichert.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    resource: { type: 'string' },
                    transport: { type: 'string' },
                    appKind: { type: 'string' },
                    source: { type: 'string', enum: ['xmpp', 'fallback'] },
                    lastSeenAt: { type: 'string', format: 'date-time', nullable: true },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
        },
      },
    },
    '/api/admin/chat/presence/snapshot': {
      get: {
        tags: ['Admin Chat'],
        operationId: 'getAdminChatPresenceSnapshot',
        summary: 'Lädt einen konsolidierten Presence-Snapshot pro Kontakt.',
        security: securedAdmin,
        parameters: [
          {
            in: 'query',
            name: 'contactIds',
            required: false,
            description: 'Kommagetrennte Liste von Admin-User-IDs. Ohne Angabe wird ein globaler Snapshot geliefert.',
            schema: { type: 'string', example: 'admin_1,admin_2,admin_3' },
          },
        ],
        responses: {
          '200': {
            description: 'Snapshot geladen.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/ChatPresenceSnapshotEntry' },
                    },
                    byUserId: {
                      type: 'object',
                      additionalProperties: { $ref: '#/components/schemas/ChatPresenceSnapshotEntry' },
                    },
                    generatedAt: { type: 'string', format: 'date-time' },
                    ttlMs: { type: 'integer' },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
        },
      },
    },
    '/api/admin/chat/calls/{callId}/claim': {
      post: {
        tags: ['Admin Chat'],
        operationId: 'claimAdminChatCall',
        summary: 'Versucht den atomaren Claim einer parallel klingelnden Call-Session (first-accept-wins).',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'callId', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  callerUserId: { type: 'string' },
                  resource: { type: 'string' },
                  appKind: { type: 'string', enum: ['admin', 'ops'] },
                  transport: { type: 'string', enum: ['xmpp', 'sse', 'poll', 'hybrid'] },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Claim bewertet.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ChatCallSessionState' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
    },
    '/api/admin/chat/calls/{callId}/release': {
      post: {
        tags: ['Admin Chat'],
        operationId: 'releaseAdminChatCall',
        summary: 'Beendet/Freigibt eine Call-Session und signalisiert das Ergebnis an alle Clients.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'callId', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  state: {
                    type: 'string',
                    enum: ['ended', 'failed', 'cancelled', 'timeout', 'rejected'],
                    default: 'ended',
                  },
                  reason: { type: 'string' },
                  resource: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Call-Session freigegeben.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ChatCallSessionState' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/api/admin/chat/calls/{callId}/state': {
      get: {
        tags: ['Admin Chat'],
        operationId: 'getAdminChatCallState',
        summary: 'Liefert den aktuellen Status einer Call-Session für Resync/Diagnose.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'callId', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Call-State geladen.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ChatCallSessionState' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/api/admin/system/update/status': {
      get: {
        tags: ['System'],
        operationId: 'getSystemUpdateStatus',
        summary: 'Liefert den konsolidierten Status für geführte System-Updates.',
        security: securedAdmin,
        parameters: [
          {
            in: 'query',
            name: 'record',
            schema: { type: 'boolean', default: false },
            description:
              'Optional: schreibt einen auditierbaren Status-Check in die Update-Historie (kind=status_check).',
          },
        ],
        responses: {
          '200': {
            description: 'Update-Status geladen.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SystemUpdateStatus' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/system/update/preflight': {
      post: {
        tags: ['System'],
        operationId: 'runSystemUpdatePreflight',
        summary: 'Führt Pflichtprüfungen vor einem manuellen System-Update aus.',
        security: securedAdmin,
        responses: {
          '200': {
            description: 'Preflight durchgeführt.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SystemUpdatePreflightReport' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/system/update/runbook': {
      get: {
        tags: ['System'],
        operationId: 'getSystemUpdateRunbook',
        summary: 'Erzeugt ein manuelles Update-Runbook mit konkreten Kommandos.',
        security: securedAdmin,
        parameters: [
          {
            in: 'query',
            name: 'targetTag',
            schema: { type: 'string' },
            description: 'Optionaler Ziel-Tag/Branch für den Runbook-Output.',
          },
        ],
        responses: {
          '200': {
            description: 'Runbook geladen.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SystemUpdateRunbook' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/system/update/history': {
      get: {
        tags: ['System'],
        operationId: 'getSystemUpdateHistory',
        summary: 'Auditierbare Historie der ausgeführten Update-Preflight-Läufe.',
        security: securedAdmin,
        parameters: [
          {
            in: 'query',
            name: 'limit',
            schema: { type: 'integer', minimum: 1, maximum: 200, default: 30 },
          },
        ],
        responses: {
          '200': {
            description: 'Historie geladen.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/SystemUpdateHistoryEntry' },
                    },
                    count: { type: 'integer' },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/maintenance/backup': {
      get: {
        tags: ['System'],
        operationId: 'downloadMaintenanceBackup',
        summary: 'Erzeugt einen SQL-Dump und speichert parallel ein Backup-Artefakt im Serververzeichnis `backups/`.',
        security: securedAdmin,
        responses: {
          '200': {
            description: 'Backup erfolgreich erzeugt.',
            headers: {
              'Content-Disposition': {
                description: 'Dateiname des SQL-Dumps.',
                schema: { type: 'string' },
              },
              'X-Backup-Artifact-Stored': {
                description: 'Zeigt an, ob das Server-Artefakt unter `backups/` gespeichert wurde.',
                schema: { type: 'string', enum: ['true', 'false'] },
              },
              'X-Backup-Artifact-Path': {
                description: 'Relativer Pfad des serverseitig gespeicherten Backup-Artefakts (falls vorhanden).',
                schema: { type: 'string' },
              },
            },
            content: {
              'application/sql': {
                schema: {
                  type: 'string',
                  format: 'binary',
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/mobile/dashboard': {
      get: {
        tags: ['Ops Mobile'],
        operationId: 'getOpsDashboardSummary',
        summary: 'Aggregiertes mobiles Operations-Dashboard für Staff-Clients.',
        security: securedAdmin,
        parameters: [
          { in: 'query', name: 'tenantId', schema: { type: 'string' }, description: 'Optionaler Mandantenfilter' },
          { in: 'query', name: 'orgUnitId', schema: { type: 'string' }, description: 'Optionaler Org-Filter' },
          {
            in: 'query',
            name: 'timeRange',
            schema: { type: 'string', enum: ['24h', '7d', '30d'], default: '7d' },
          },
        ],
        responses: {
          '200': {
            description: 'Dashboard-Aggregation erfolgreich geladen.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/OpsDashboardSummary' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
    },
    '/api/admin/imports': {
      post: {
        tags: ['Admin Imports'],
        operationId: 'createImportJob',
        summary: 'Erstellt einen neuen Importjob für Benutzer, Organisationsstruktur oder Leistungen.',
        security: securedAdmin,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['kind'],
                properties: {
                  kind: { type: 'string', enum: ['users', 'org_units', 'services'] },
                  tenantId: { type: 'string' },
                  options: { type: 'object', additionalProperties: true },
                  mapping: { type: 'object', additionalProperties: true },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Importjob angelegt.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ImportJob' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
    },
    '/api/admin/imports/{id}': {
      get: {
        tags: ['Admin Imports'],
        operationId: 'getImportJob',
        summary: 'Lädt den Importjob inklusive Fortschritt, Vorschau und Ereignissen.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Importjob geladen.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ImportJob' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/api/admin/imports/{id}/upload': {
      post: {
        tags: ['Admin Imports'],
        operationId: 'uploadImportFile',
        summary: 'Lädt eine CSV-Datei zu einem Importjob hoch.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: {
                  file: { type: 'string', format: 'binary' },
                  encoding: { type: 'string', enum: ['utf-8', 'windows-1252'] },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Datei hochgeladen und geparst.',
            content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
    },
    '/api/admin/imports/{id}/preview': {
      post: {
        tags: ['Admin Imports'],
        operationId: 'previewImportJob',
        summary: 'Erzeugt eine Importvorschau inklusive Konflikten.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Importvorschau erstellt.',
            content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/api/admin/imports/{id}/execute': {
      post: {
        tags: ['Admin Imports'],
        operationId: 'executeImportJob',
        summary: 'Startet den asynchronen Importlauf.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          '202': {
            description: 'Importausführung gestartet.',
            content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/api/admin/imports/{id}/report': {
      get: {
        tags: ['Admin Imports'],
        operationId: 'getImportJobReport',
        summary: 'Lädt den Abschlussbericht eines Importjobs.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Importreport geladen.',
            content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/api/admin/imports/{id}/cancel': {
      post: {
        tags: ['Admin Imports'],
        operationId: 'cancelImportJob',
        summary: 'Bricht einen laufenden Importjob ab.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Importjob abgebrochen.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/MessageResponse' } } },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/api/admin/imports/{id}/assist/mapping': {
      post: {
        tags: ['Admin Imports'],
        operationId: 'assistImportMapping',
        summary: 'Regel- bzw. KI-Assistenz für Feldmapping.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Mapping-Vorschlag erzeugt.',
            content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
    },
    '/api/admin/imports/{id}/assist/keywords': {
      post: {
        tags: ['Admin Imports'],
        operationId: 'assistImportKeywords',
        summary: 'Regel- bzw. KI-Assistenz für Schlagwortableitung.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Schlagwortvorschlag erzeugt.',
            content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
    },
    '/api/admin/imports/{id}/assist/scope-assignment': {
      post: {
        tags: ['Admin Imports'],
        operationId: 'assistImportScopeAssignment',
        summary: 'Regel- bzw. KI-Assistenz für Scope-/Zuordnungslogik.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Scope-Vorschlag erzeugt.',
            content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
    },
    '/api/admin/services': {
      get: {
        tags: ['Services'],
        operationId: 'listServices',
        summary: 'Listet Leistungen eines Mandanten.',
        security: securedAdmin,
        parameters: [
          { in: 'query', name: 'tenantId', schema: { type: 'string' } },
          { in: 'query', name: 'q', schema: { type: 'string' } },
          { in: 'query', name: 'activeOnly', schema: { type: 'string', enum: ['0', '1'] } },
          { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 500 } },
          { in: 'query', name: 'offset', schema: { type: 'integer', minimum: 0 } },
        ],
        responses: {
          '200': { description: 'Leistungen geladen.', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
      post: {
        tags: ['Services'],
        operationId: 'createService',
        summary: 'Erstellt eine neue Leistung.',
        security: securedAdmin,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
        },
        responses: {
          '201': { description: 'Leistung erstellt.', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
    },
    '/api/admin/services/{serviceId}': {
      patch: {
        tags: ['Services'],
        operationId: 'updateService',
        summary: 'Aktualisiert eine bestehende Leistung.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'serviceId', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
        },
        responses: {
          '200': { description: 'Leistung aktualisiert.', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
      delete: {
        tags: ['Services'],
        operationId: 'deactivateService',
        summary: 'Deaktiviert eine Leistung (Soft-Delete).',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'serviceId', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Leistung deaktiviert.', content: { 'application/json': { schema: { $ref: '#/components/schemas/MessageResponse' } } } },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/api/admin/services/{serviceId}/links': {
      get: {
        tags: ['Services'],
        operationId: 'getServiceLinks',
        summary: 'Lädt Verknüpfungen (Orga, Nutzer, Formulare) einer Leistung.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'serviceId', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Verknüpfungen geladen.', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
      put: {
        tags: ['Services'],
        operationId: 'setServiceLinks',
        summary: 'Setzt Verknüpfungen (Orga, Nutzer, Formulare) einer Leistung.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'serviceId', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
        },
        responses: {
          '200': { description: 'Verknüpfungen gespeichert.', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/api/admin/keywording/jobs': {
      post: {
        tags: ['Keywording'],
        operationId: 'createKeywordingJob',
        summary: 'Erstellt einen Keywording-Job.',
        security: securedAdmin,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['tenantId'],
                properties: {
                  tenantId: { type: 'string' },
                  sourceScope: { type: 'string', enum: ['services_all', 'services_filtered', 'services_recent_import'] },
                  targetScope: { type: 'string', enum: ['org_units', 'users', 'both'] },
                  includeExistingKeywords: { type: 'boolean' },
                  applyMode: { type: 'string', enum: ['review', 'auto_if_confident'] },
                  minSuggestConfidence: { type: 'number', minimum: 0, maximum: 1 },
                  minAutoApplyConfidence: { type: 'number', minimum: 0, maximum: 1 },
                  maxKeywordsPerTarget: { type: 'integer', minimum: 1, maximum: 40 },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Job erstellt.', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
    },
    '/api/admin/keywording/jobs/{id}': {
      get: {
        tags: ['Keywording'],
        operationId: 'getKeywordingJob',
        summary: 'Lädt Jobstatus, Events und Statistiken.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Job geladen.', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/api/admin/keywording/jobs/{id}/run': {
      post: {
        tags: ['Keywording'],
        operationId: 'runKeywordingJob',
        summary: 'Startet den asynchronen Keywording-Lauf.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          '202': { description: 'Job gestartet.', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/api/admin/keywording/jobs/{id}/candidates': {
      get: {
        tags: ['Keywording'],
        operationId: 'listKeywordingCandidates',
        summary: 'Listet Review-Kandidaten eines Keywording-Jobs.',
        security: securedAdmin,
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
          { in: 'query', name: 'targetType', schema: { type: 'string', enum: ['org_unit', 'user'] } },
          { in: 'query', name: 'action', schema: { type: 'string', enum: ['add', 'keep', 'remove', 'skip'] } },
          { in: 'query', name: 'q', schema: { type: 'string' } },
          { in: 'query', name: 'minConfidence', schema: { type: 'number', minimum: 0, maximum: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 500 } },
          { in: 'query', name: 'offset', schema: { type: 'integer', minimum: 0 } },
        ],
        responses: {
          '200': { description: 'Kandidaten geladen.', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/api/admin/keywording/jobs/{id}/apply': {
      post: {
        tags: ['Keywording'],
        operationId: 'applyKeywordingCandidates',
        summary: 'Übernimmt Kandidaten in User-/Orga-Schlagworte.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
        },
        responses: {
          '200': { description: 'Kandidaten übernommen.', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
    },
    '/api/admin/keywording/jobs/{id}/revert': {
      post: {
        tags: ['Keywording'],
        operationId: 'revertKeywordingApply',
        summary: 'Setzt Übernahmen eines Keywording-Jobs zurück.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Revert durchgeführt.', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/api/admin/keywording/jobs/{id}/cancel': {
      post: {
        tags: ['Keywording'],
        operationId: 'cancelKeywordingJob',
        summary: 'Bricht einen Keywording-Job ab.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Job abgebrochen.', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/api/admin/keywording/dictionary': {
      get: {
        tags: ['Keywording'],
        operationId: 'getKeywordingDictionary',
        summary: 'Lädt das tenant-spezifische Keyword-Wörterbuch.',
        security: securedAdmin,
        parameters: [{ in: 'query', name: 'tenantId', schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Wörterbuch geladen.', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
      patch: {
        tags: ['Keywording'],
        operationId: 'patchKeywordingDictionary',
        summary: 'Aktualisiert das tenant-spezifische Keyword-Wörterbuch.',
        security: securedAdmin,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
        },
        responses: {
          '200': { description: 'Wörterbuch gespeichert.', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
    },
    '/api/admin/responsibility/config': {
      get: {
        tags: ['Responsibility'],
        operationId: 'getResponsibilityConfig',
        summary: 'Lädt die Konfiguration der Verwaltungs-Zuständigkeitsprüfung.',
        security: securedAdmin,
        responses: {
          '200': {
            description: 'Konfiguration geladen.',
            content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
      patch: {
        tags: ['Responsibility'],
        operationId: 'patchResponsibilityConfig',
        summary: 'Aktualisiert die Konfiguration der Verwaltungs-Zuständigkeitsprüfung.',
        security: securedAdmin,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
        },
        responses: {
          '200': {
            description: 'Konfiguration aktualisiert.',
            content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
    },
    '/api/admin/responsibility/query': {
      post: {
        tags: ['Responsibility'],
        operationId: 'queryResponsibility',
        summary: 'Ermittelt zuständige Kandidaten mit Konfidenz.',
        security: securedAdmin,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['query'],
                properties: {
                  query: { type: 'string' },
                  tenantId: { type: 'string' },
                  includeUsers: { type: 'boolean' },
                  limit: { type: 'integer', minimum: 1, maximum: 20 },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Zuständigkeitskandidaten berechnet.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ResponsibilityDecision' } } },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
    },
    '/api/admin/responsibility/simulate': {
      post: {
        tags: ['Responsibility'],
        operationId: 'simulateResponsibility',
        summary: 'Simuliert Zuständigkeit ohne Persistenz.',
        security: securedAdmin,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
        },
        responses: {
          '200': {
            description: 'Simulation durchgeführt.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ResponsibilityDecision' } } },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
    },
    '/api/admin/users/{userId}/invite': {
      post: {
        tags: ['Admin Auth'],
        operationId: 'inviteAdminUser',
        summary: 'Erstellt einen Einladungslink für einen Admin-User und versendet optional eine E-Mail.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'userId', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  sendEmail: { type: 'boolean', default: true },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Einladung erstellt.',
            content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
        },
      },
    },
    '/api/admin/users/invite/batch': {
      post: {
        tags: ['Admin Auth'],
        operationId: 'inviteAdminUsersBatch',
        summary: 'Erstellt Einladungen für mehrere Admin-User.',
        security: securedAdmin,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['userIds'],
                properties: {
                  userIds: { type: 'array', items: { type: 'string' } },
                  sendEmail: { type: 'boolean', default: true },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Batch-Verarbeitung abgeschlossen.',
            content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
    },
    '/api/submissions': {
      post: {
        tags: ['Submissions'],
        operationId: 'createSubmission',
        summary: 'Neue öffentliche Meldung einreichen.',
        description:
          'Unterstützt JSON-Body und `multipart/form-data` (Dateifeld `images`). Bei aktivem Wartungsmodus kommt `503`.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SubmissionCreateRequest' },
            },
            'multipart/form-data': {
              schema: {
                allOf: [{ $ref: '#/components/schemas/SubmissionCreateRequest' }],
                type: 'object',
                properties: {
                  images: {
                    type: 'array',
                    items: { type: 'string', format: 'binary' },
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Meldung wurde übernommen.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SubmissionCreateResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '503': {
            description: 'Wartungsmodus aktiv.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiError' },
              },
            },
          },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/submissions/unsubscribe': {
      get: {
        tags: ['Submissions'],
        operationId: 'unsubscribeSubmissionNotifications',
        summary: 'Statusbenachrichtigungen per Status-Token abbestellen.',
        parameters: [{ in: 'query', name: 'token', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Benachrichtigungen deaktiviert.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string' },
                    ticketId: { type: 'string' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/submissions/status': {
      get: {
        tags: ['Submissions'],
        operationId: 'getSubmissionStatusByToken',
        summary: 'Öffentlichen Ticketstatus per Status-Token abfragen.',
        parameters: [{ in: 'query', name: 'token', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Status mit Workflow- und Bildinformationen.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SubmissionStatusResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/submissions/status/image/{token}/{imageId}': {
      get: {
        tags: ['Submissions'],
        operationId: 'getSubmissionStatusImage',
        summary: 'Öffentliches Ticketbild über Status-Token laden.',
        parameters: [
          { in: 'path', name: 'token', required: true, schema: { type: 'string' } },
          { in: 'path', name: 'imageId', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Binäre Bilddatei.',
            content: {
              'image/*': {
                schema: {
                  type: 'string',
                  format: 'binary',
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/submissions/{ticketId}/status': {
      get: {
        tags: ['Submissions'],
        operationId: 'getSubmissionStatusByTicketId',
        summary: 'Minimalen Ticketstatus über Ticket-ID laden.',
        parameters: [{ in: 'path', name: 'ticketId', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Minimale Statusantwort.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ticketId: { type: 'string' },
                    status: { type: 'string' },
                    category: { type: 'string' },
                    priority: { type: 'string' },
                    createdAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/validations/send': {
      post: {
        tags: ['Validations'],
        operationId: 'sendValidationEmail',
        summary: 'Validierungs-E-Mail für Ticket versenden.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ValidationSendRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Validierungs-Mail ausgelöst.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string' },
                    validationId: { type: 'string' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/validations/verify/{token}': {
      get: {
        tags: ['Validations'],
        operationId: 'verifyValidationToken',
        summary: 'Double-Opt-In-Token verifizieren.',
        description: 'Bestätigt E-Mail, startet ggf. Hintergrundverarbeitung und kann Citizen-Session setzen.',
        parameters: [
          { in: 'path', name: 'token', required: true, schema: { type: 'string' } },
          {
            in: 'query',
            name: 'autoLogin',
            required: false,
            schema: { type: 'string', enum: ['1', '0', 'true', 'false', 'yes', 'no', 'on', 'off'] },
          },
          { in: 'query', name: 'frontendToken', required: false, schema: { type: 'string' } },
          { in: 'query', name: 'profileToken', required: false, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Token gültig und verarbeitet.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ValidationVerifyResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '410': {
            description: 'Token abgelaufen.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiError' },
              },
            },
          },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/validations/{ticketId}/status': {
      get: {
        tags: ['Validations'],
        operationId: 'getValidationStatus',
        summary: 'Validierungsstatus eines Tickets abrufen.',
        parameters: [{ in: 'path', name: 'ticketId', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Aktueller Validierungsstatus.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ValidationStatusResponse' },
              },
            },
          },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/validations/resend': {
      post: {
        tags: ['Validations'],
        operationId: 'resendValidationEmail',
        summary: 'Ausstehende Validierungs-E-Mail erneut senden.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['ticketId', 'citizenEmail'],
                properties: {
                  ticketId: { type: 'string' },
                  citizenEmail: { type: 'string', format: 'email' },
                  citizenName: { type: 'string' },
                  language: { type: 'string' },
                  languageName: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'E-Mail erneut versendet.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MessageResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/validations/manual/{ticketId}/preview': {
      post: {
        tags: ['Validations'],
        operationId: 'previewManualValidation',
        summary: 'KI-Klassifizierungsvorschlag für manuelle Verifikation erzeugen.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'ticketId', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Vorschlag erstellt.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: true,
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/validations/manual/{ticketId}/commit': {
      post: {
        tags: ['Validations'],
        operationId: 'commitManualValidation',
        summary: 'KI-Vorschlag übernehmen und Ticket manuell verifizieren.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'ticketId', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  suggestion: {
                    type: 'object',
                    properties: {
                      category: { type: 'string' },
                      priority: { type: 'string' },
                      reasoning: { type: 'string' },
                    },
                  },
                  rawDecision: { type: 'object', additionalProperties: true },
                  knowledgeVersion: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Vorschlag übernommen.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MessageResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/validations/manual/{ticketId}/reject': {
      post: {
        tags: ['Validations'],
        operationId: 'rejectManualValidationSuggestion',
        summary: 'KI-Vorschlag verwerfen und Ticket trotzdem verifizieren.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'ticketId', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Vorschlag verworfen, Ticket verifiziert.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MessageResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/workflows/confirm/{token}': {
      get: {
        tags: ['Workflow Public'],
        operationId: 'getWorkflowConfirmationContext',
        summary: 'Öffentlichen Bestätigungs-Kontext für einen Workflow laden.',
        parameters: [{ in: 'path', name: 'token', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Bestätigungsseite als JSON-Payload.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: true,
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '410': {
            description: 'Token abgelaufen.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiError' },
              },
            },
          },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/workflows/confirm/{token}/decision': {
      post: {
        tags: ['Workflow Public'],
        operationId: 'applyWorkflowConfirmationDecision',
        summary: 'Bestätigungsentscheidung (approve/reject) anwenden.',
        parameters: [
          { in: 'path', name: 'token', required: true, schema: { type: 'string' } },
          { in: 'query', name: 'defer', required: false, schema: { type: 'boolean', default: false } },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/WorkflowDecisionRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Entscheidung verarbeitet.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    decision: { type: 'string', enum: ['approve', 'reject'] },
                    message: { type: 'string' },
                    ticketId: { type: 'string', nullable: true },
                    deferred: { type: 'boolean' },
                    alreadyProcessed: { type: 'boolean' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '410': {
            description: 'Token abgelaufen.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiError' },
              },
            },
          },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/workflows/confirm/{token}/images/{imageId}': {
      get: {
        tags: ['Workflow Public'],
        operationId: 'getWorkflowConfirmationImage',
        summary: 'Bilddaten für öffentliche Workflow-Bestätigung laden.',
        parameters: [
          { in: 'path', name: 'token', required: true, schema: { type: 'string' } },
          { in: 'path', name: 'imageId', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Bild geladen.',
            content: {
              'image/*': {
                schema: {
                  type: 'string',
                  format: 'binary',
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '410': {
            description: 'Token abgelaufen.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiError' },
              },
            },
          },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/workflows/data-request/{token}': {
      get: {
        tags: ['Workflow Public'],
        operationId: 'getWorkflowDataRequest',
        summary: 'Datennachforderung für Workflow laden.',
        parameters: [{ in: 'path', name: 'token', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Datenanforderung inkl. Felder und Lokalisierung.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: true,
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '410': {
            description: 'Token abgelaufen.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiError' },
              },
            },
          },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
      post: {
        tags: ['Workflow Public'],
        operationId: 'submitWorkflowDataRequestAnswers',
        summary: 'Antworten auf Datennachforderung speichern.',
        parameters: [{ in: 'path', name: 'token', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                description: 'Entweder `{ answers: {...} }` oder direkt ein Antworten-Objekt.',
                additionalProperties: true,
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Antworten angenommen.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: true,
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '410': {
            description: 'Token abgelaufen.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiError' },
              },
            },
          },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/workflows/data-request/{token}/images/{imageId}': {
      get: {
        tags: ['Workflow Public'],
        operationId: 'getWorkflowDataRequestImage',
        summary: 'Bilddaten für öffentliche Datennachforderung laden.',
        parameters: [
          { in: 'path', name: 'token', required: true, schema: { type: 'string' } },
          { in: 'path', name: 'imageId', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Bild geladen.',
            content: {
              'image/*': {
                schema: {
                  type: 'string',
                  format: 'binary',
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '410': {
            description: 'Token abgelaufen.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiError' },
              },
            },
          },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/platform/blog': {
      get: {
        tags: ['Platform'],
        operationId: 'listPlatformBlogPostsPublic',
        summary: 'Öffentliche Newsblog-Beiträge für das Platformportal laden.',
        description:
          'Liefert ausschließlich veröffentlichte bzw. zeitfällige Beiträge (scheduled + Datum in Vergangenheit).',
        parameters: [
          { in: 'query', name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 120 } },
          { in: 'query', name: 'offset', required: false, schema: { type: 'integer', minimum: 0 } },
        ],
        responses: {
          '200': {
            description: 'Blogliste geladen.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PlatformBlogListResponse' },
              },
            },
          },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/platform/blog/{slug}': {
      get: {
        tags: ['Platform'],
        operationId: 'getPlatformBlogPostPublic',
        summary: 'Öffentlichen Newsblog-Beitrag nach Slug laden.',
        parameters: [
          { in: 'path', name: 'slug', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Blogbeitrag geladen.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PlatformBlogSingleResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/config/public': {
      get: {
        tags: ['Public Config'],
        operationId: 'getPublicConfig',
        summary: 'Öffentliche App-Konfiguration inkl. tenant-aware Routing.',
        parameters: [
          { in: 'query', name: 'tenantSlug', required: false, schema: { type: 'string' } },
          { in: 'query', name: 'frontendToken', required: false, schema: { type: 'string' } },
          { in: 'query', name: 'profileToken', required: false, schema: { type: 'string' } },
          {
            in: 'query',
            name: 'token',
            required: false,
            description: 'Public Token zur Tenant-Auflösung (z. B. aus Callback-Links).',
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Erfolgreiche Konfigurationsantwort.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PublicConfigResponse' },
              },
            },
          },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/config/public/legacy-redirect': {
      get: {
        tags: ['Public Config'],
        operationId: 'redirectLegacyPublicPath',
        summary: 'Legacy-URL auf kanonischen tenant-aware Pfad umleiten.',
        parameters: [
          { in: 'query', name: 'legacyPath', required: false, schema: { type: 'string', example: '/verify' } },
          { in: 'query', name: 'path', required: false, schema: { type: 'string' } },
          { in: 'query', name: 'tenantSlug', required: false, schema: { type: 'string' } },
          { in: 'query', name: 'frontendToken', required: false, schema: { type: 'string' } },
          { in: 'query', name: 'profileToken', required: false, schema: { type: 'string' } },
          { in: 'query', name: 'token', required: false, schema: { type: 'string' } },
        ],
        responses: {
          '301': {
            description: 'Permanente Weiterleitung auf den kanonischen Pfad.',
            headers: {
              Location: {
                schema: { type: 'string' },
                description: 'Ziel-URL für Redirect.',
              },
            },
          },
        },
      },
    },
    '/api/admin/realtime/stream': {
      get: {
        tags: ['Realtime'],
        operationId: 'adminRealtimeStream',
        summary: 'SSE-Stream für Admin-Live-Updates.',
        security: securedAdmin,
        description:
          'Server-Sent Events. Unterstützte Eventtypen: `ready`, `update`, `ping`. Themen sind `tickets,workflows,ai_queue,email_queue,chat_presence,chat_calls`.',
        parameters: [
          {
            in: 'query',
            name: 'topics',
            required: false,
            description: 'Kommagetrennte Themenliste. Ohne Angabe werden alle Themen abonniert.',
            schema: {
              type: 'string',
              example: 'tickets,chat_presence,chat_calls',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Offene SSE-Verbindung.',
            content: {
              'text/event-stream': {
                schema: { type: 'string' },
                examples: {
                  ready: {
                    summary: 'Beispiel Start-Event',
                    value:
                      'event: ready\ndata: {"connectedAt":"2026-03-01T09:45:00.000Z","topics":["tickets","chat_presence","chat_calls"]}\n\n',
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
        },
      },
    },
    '/api/tickets': {
      get: {
        tags: ['Tickets'],
        operationId: 'listTickets',
        summary: 'Staff-Ticketliste laden.',
        security: securedAdmin,
        parameters: [
          { in: 'query', name: 'status', required: false, schema: { type: 'string' } },
          { in: 'query', name: 'priority', required: false, schema: { type: 'string' } },
          { in: 'query', name: 'category', required: false, schema: { type: 'string' } },
          { in: 'query', name: 'tenantId', required: false, schema: { type: 'string' } },
          { in: 'query', name: 'assignment', required: false, schema: { type: 'string', enum: ['me', 'unassigned'] } },
          { in: 'query', name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 500 } },
          { in: 'query', name: 'offset', required: false, schema: { type: 'integer', minimum: 0 } },
        ],
        responses: {
          '200': {
            description: 'Ticketliste.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TicketListResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/tickets/{ticketId}': {
      get: {
        tags: ['Tickets'],
        operationId: 'getTicket',
        summary: 'Einzelnes Ticket laden.',
        security: securedAdmin,
        parameters: [
          {
            in: 'path',
            name: 'ticketId',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Ticketdetails.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TicketSummary' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/sessions': {
      get: {
        tags: ['Sessions'],
        operationId: 'listAdminSessions',
        summary: 'Admin-Sessions inklusive Session-Cookie-Wert abrufen.',
        security: securedAdmin,
        parameters: [
          {
            in: 'query',
            name: 'status',
            required: false,
            schema: { type: 'string', enum: ['active', 'all', 'inactive'], default: 'active' },
          },
          { in: 'query', name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 300 } },
          { in: 'query', name: 'offset', required: false, schema: { type: 'integer', minimum: 0 } },
        ],
        responses: {
          '200': {
            description: 'Sessionübersicht.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AdminSessionListResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
      delete: {
        tags: ['Sessions'],
        operationId: 'deleteAdminSessionsBulk',
        summary: 'Mehrere Session-Einträge löschen.',
        security: securedAdmin,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['sessionIds'],
                properties: {
                  sessionIds: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 1,
                    maxItems: 500,
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Löschresultat.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string' },
                    deleted: { type: 'integer' },
                    selfDeleted: { type: 'boolean' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/sessions/revoke-bulk': {
      post: {
        tags: ['Sessions'],
        operationId: 'revokeAdminSessionsBulk',
        summary: 'Mehrere aktive Admin-Sessions widerrufen.',
        security: securedAdmin,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['sessionIds'],
                properties: {
                  sessionIds: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 1,
                    maxItems: 500,
                  },
                  reason: { type: 'string', maxLength: 120, example: 'revoked_by_admin' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Widerrufsresultat.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string' },
                    requested: { type: 'integer' },
                    revoked: { type: 'integer' },
                    alreadyInactive: { type: 'integer' },
                    missing: { type: 'array', items: { type: 'string' } },
                    selfRevoked: { type: 'boolean' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/sessions/{id}/revoke': {
      post: {
        tags: ['Sessions'],
        operationId: 'revokeAdminSession',
        summary: 'Einzelne Admin-Session widerrufen.',
        security: securedAdmin,
        parameters: [
          {
            in: 'path',
            name: 'id',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  reason: { type: 'string', maxLength: 120, example: 'revoked_by_admin' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Session widerrufen.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string' },
                    id: { type: 'string' },
                    selfRevoked: { type: 'boolean' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/ai-queue': {
      get: {
        tags: ['AI Queue'],
        operationId: 'listAiQueue',
        summary: 'KI-Queue inkl. Statuszähler abrufen.',
        security: securedAdmin,
        parameters: [
          {
            in: 'query',
            name: 'status',
            required: false,
            schema: {
              type: 'string',
              enum: ['all', 'pending', 'retry', 'processing', 'done', 'failed', 'cancelled'],
              default: 'all',
            },
          },
          { in: 'query', name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 200 } },
          { in: 'query', name: 'offset', required: false, schema: { type: 'integer', minimum: 0 } },
        ],
        responses: {
          '200': {
            description: 'Queue-Liste und Metriken.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AiQueueListResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/ai-queue/{id}/retry': {
      post: {
        tags: ['AI Queue'],
        operationId: 'retryAiQueueItem',
        summary: 'KI-Queue-Eintrag erneut einplanen.',
        security: securedAdmin,
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Retry erfolgreich eingeplant.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string' },
                    item: { $ref: '#/components/schemas/AiQueueEntry' },
                  },
                },
              },
            },
          },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/ai-queue/{id}/cancel': {
      post: {
        tags: ['AI Queue'],
        operationId: 'cancelAiQueueItem',
        summary: 'KI-Queue-Eintrag abbrechen.',
        security: securedAdmin,
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Eintrag abgebrochen.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string' },
                    item: { $ref: '#/components/schemas/AiQueueEntry' },
                  },
                },
              },
            },
          },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/ai-queue/{id}': {
      delete: {
        tags: ['AI Queue'],
        operationId: 'deleteAiQueueItem',
        summary: 'KI-Queue-Eintrag löschen.',
        security: securedAdmin,
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Eintrag gelöscht.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MessageResponse' },
              },
            },
          },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/ai-queue/test-run': {
      post: {
        tags: ['AI Queue'],
        operationId: 'testAiQueueRun',
        summary: 'Probelauf über die produktive KI-Queue-Pipeline.',
        security: securedAdmin,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AiQueueTestRunRequest' },
              example: {
                prompt: 'Bitte kategorisiere diese Meldung.',
                taskKey: 'ticket_categorization',
                connectionId: 'openai-prod',
                modelId: 'gpt-4o-mini',
                waitTimeoutMs: 30000,
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Testlauf abgeschlossen.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AiQueueTestRunResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/llm/connections': {
      get: {
        tags: ['LLM Hub'],
        operationId: 'listLlmConnections',
        summary: 'Alle LLM-Verbindungen auflisten.',
        security: securedAdmin,
        parameters: [
          {
            in: 'query',
            name: 'maskSecrets',
            required: false,
            schema: { type: 'boolean', default: true },
            description: 'Wenn `false`, werden Secrets unmaskiert geliefert (nur intern verwenden).',
          },
        ],
        responses: {
          '200': {
            description: 'Verbindungsliste.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LlmConnectionListResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
      post: {
        tags: ['LLM Hub'],
        operationId: 'createLlmConnection',
        summary: 'Neue OpenAI-kompatible LLM-Verbindung anlegen.',
        security: securedAdmin,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LlmConnection' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Verbindung erstellt.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LlmConnectionUpsertResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/llm/connections/{id}': {
      patch: {
        tags: ['LLM Hub'],
        operationId: 'updateLlmConnection',
        summary: 'LLM-Verbindung aktualisieren.',
        security: securedAdmin,
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LlmConnection' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Verbindung gespeichert.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LlmConnectionUpsertResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
      delete: {
        tags: ['LLM Hub'],
        operationId: 'deleteLlmConnection',
        summary: 'LLM-Verbindung löschen.',
        security: securedAdmin,
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Verbindung gelöscht.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MessageResponse' },
              },
            },
          },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/llm/connections/{id}/models': {
      get: {
        tags: ['LLM Hub'],
        operationId: 'listLlmConnectionModels',
        summary: 'Modellkatalog einer Verbindung abrufen.',
        security: securedAdmin,
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
          { in: 'query', name: 'refresh', required: false, schema: { type: 'boolean', default: false } },
          { in: 'query', name: 'visionOnly', required: false, schema: { type: 'boolean', default: false } },
        ],
        responses: {
          '200': {
            description: 'Modelle geladen.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LlmModelListResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/llm/connections/{id}/models/refresh': {
      post: {
        tags: ['LLM Hub'],
        operationId: 'refreshLlmConnectionModels',
        summary: 'Modellkatalog einer Verbindung aktiv aktualisieren.',
        security: securedAdmin,
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Refresh erfolgreich.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LlmModelListResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/llm/task-routing': {
      get: {
        tags: ['LLM Hub'],
        operationId: 'getLlmTaskRouting',
        summary: 'Task-Routing für Provider/Modelle laden.',
        security: securedAdmin,
        responses: {
          '200': {
            description: 'Task-Routing inkl. Task-Metadaten.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LlmTaskRoutingResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
      patch: {
        tags: ['LLM Hub'],
        operationId: 'updateLlmTaskRouting',
        summary: 'Task-Routing speichern.',
        security: securedAdmin,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: true,
              },
              description: 'Erwartet entweder `{ routing: ... }` oder direkt die Routing-Struktur.',
            },
          },
        },
        responses: {
          '200': {
            description: 'Task-Routing gespeichert.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LlmTaskRoutingResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/api-tokens': {
      get: {
        tags: ['Admin Auth'],
        operationId: 'listAdminApiTokens',
        summary: 'Eigene Admin API-Tokens auflisten (ohne Klartext).',
        security: securedAdmin,
        parameters: [
          {
            in: 'query',
            name: 'status',
            required: false,
            schema: {
              type: 'string',
              enum: ['active', 'revoked', 'all'],
              default: 'active',
            },
          },
        ],
        responses: {
          '200': {
            description: 'Tokenliste des aktuellen Admin-Users.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AdminApiTokenListResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
      post: {
        tags: ['Admin Auth'],
        operationId: 'createAdminApiToken',
        summary: 'Neuen Admin API-Token erzeugen.',
        description: 'Der Klartext-Token ist ausschließlich in dieser Response sichtbar.',
        security: securedAdmin,
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AdminApiTokenCreateRequest' },
              example: {
                label: 'n8n Produktion',
                expiresAt: '2026-12-31T23:59:59.000Z',
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Token erzeugt.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AdminApiTokenCreateResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/api-tokens/{id}/revoke': {
      post: {
        tags: ['Admin Auth'],
        operationId: 'revokeAdminApiToken',
        summary: 'Eigenen API-Token widerrufen.',
        security: securedAdmin,
        parameters: [
          {
            in: 'path',
            name: 'id',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  reason: { type: 'string', example: 'revoked_by_user' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Token widerrufen.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string' },
                    revoked: { type: 'integer' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/platform-blog': {
      get: {
        tags: ['Platform'],
        operationId: 'listPlatformBlogPostsAdmin',
        summary: 'Plattform-Blogposts für den Admin-Editor laden.',
        security: securedAdmin,
        parameters: [
          {
            in: 'query',
            name: 'status',
            required: false,
            schema: { type: 'string', enum: ['all', 'draft', 'scheduled', 'published', 'archived'] },
          },
          { in: 'query', name: 'search', required: false, schema: { type: 'string' } },
          { in: 'query', name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 300 } },
          { in: 'query', name: 'offset', required: false, schema: { type: 'integer', minimum: 0 } },
        ],
        responses: {
          '200': {
            description: 'Blogliste geladen.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PlatformBlogListResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
      post: {
        tags: ['Platform'],
        operationId: 'createPlatformBlogPostAdmin',
        summary: 'Neuen Plattform-Blogbeitrag erstellen.',
        security: securedAdmin,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PlatformBlogMutationRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Beitrag erstellt.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PlatformBlogMutationResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/platform-blog/{id}': {
      get: {
        tags: ['Platform'],
        operationId: 'getPlatformBlogPostAdmin',
        summary: 'Einzelnen Plattform-Blogbeitrag laden.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Beitrag geladen.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PlatformBlogSingleResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
      patch: {
        tags: ['Platform'],
        operationId: 'updatePlatformBlogPostAdmin',
        summary: 'Plattform-Blogbeitrag aktualisieren.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PlatformBlogMutationRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Beitrag aktualisiert.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PlatformBlogMutationResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
      delete: {
        tags: ['Platform'],
        operationId: 'deletePlatformBlogPostAdmin',
        summary: 'Plattform-Blogbeitrag löschen.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Beitrag gelöscht.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string' },
                    deleted: { type: 'integer' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/auth/admin/setup': {
      post: {
        tags: ['Admin Auth'],
        operationId: 'setupFirstAdmin',
        summary: 'Initialen Admin-Benutzer erstellen (nur bei leerem System).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'password'],
                properties: {
                  username: { type: 'string' },
                  password: { type: 'string', format: 'password' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Initialer Admin wurde erstellt.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: true,
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/auth/admin/forgot': {
      post: {
        tags: ['Admin Auth'],
        operationId: 'requestAdminPasswordReset',
        summary: 'Passwort-Reset-E-Mail anfordern.',
        description: 'Antwort ist aus Sicherheitsgründen immer generisch.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['identifier'],
                properties: {
                  identifier: { type: 'string', description: 'Benutzername oder E-Mail' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Reset-Anfrage verarbeitet.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MessageResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/auth/admin/reset': {
      post: {
        tags: ['Admin Auth'],
        operationId: 'performAdminPasswordReset',
        summary: 'Admin-Passwort via Reset-Token setzen.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['token', 'newPassword'],
                properties: {
                  token: { type: 'string' },
                  newPassword: { type: 'string', minLength: 8, format: 'password' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Passwort geändert.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MessageResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '410': {
            description: 'Reset-Token abgelaufen.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiError' },
              },
            },
          },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/auth/admin/login-poem': {
      get: {
        tags: ['Admin Auth'],
        operationId: 'getAdminLoginPoem',
        summary: 'Aktuelles Login-Gedicht laden.',
        responses: {
          '200': {
            description: 'Gedicht wurde geladen.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: true,
                },
              },
            },
          },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/auth/admin/login-poem/refresh': {
      post: {
        tags: ['Admin Auth'],
        operationId: 'refreshAdminLoginPoem',
        summary: 'Login-Gedicht erneuern (zeitlich limitiert).',
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  humorStyle: { type: 'string' },
                  signatureWord: { type: 'string' },
                  locationHint: { type: 'string' },
                  chaosLevel: { type: 'integer', minimum: 0, maximum: 10 },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Neues Gedicht erzeugt.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: true,
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '429': {
            description: 'Refresh aktuell noch nicht erlaubt.',
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: true },
              },
            },
          },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/auth/openai/login': {
      get: {
        tags: ['LLM Hub'],
        operationId: 'startOpenAiOAuthLogin',
        summary: 'OpenAI OAuth-Flow starten (Redirect).',
        responses: {
          '302': {
            description: 'Redirect zum OpenAI-Consent-Screen.',
          },
        },
      },
    },
    '/api/auth/auth/openai/callback': {
      get: {
        tags: ['LLM Hub'],
        operationId: 'handleOpenAiOAuthCallback',
        summary: 'OpenAI OAuth Callback (Authorization Code Exchange).',
        parameters: [
          { in: 'query', name: 'code', required: false, schema: { type: 'string' } },
          { in: 'query', name: 'state', required: false, schema: { type: 'string' } },
        ],
        responses: {
          '302': { description: 'OAuth erfolgreich, Redirect zum Admin-Frontend.' },
          '400': { $ref: '#/components/responses/ValidationError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/auth/openai/status': {
      get: {
        tags: ['LLM Hub'],
        operationId: 'getOpenAiOAuthStatus',
        summary: 'Status einer vorhandenen OpenAI OAuth-Verbindung abfragen.',
        responses: {
          '200': {
            description: 'Verbindungsstatus.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    connected: { type: 'boolean' },
                    expiresAt: { type: 'string', nullable: true },
                    isExpired: { type: 'boolean', nullable: true },
                    accountId: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/config/general': {
      get: {
        tags: ['Admin Config'],
        operationId: 'getGeneralSettings',
        summary: 'Allgemeine Plattform-Konfiguration laden.',
        security: securedAdmin,
        responses: {
          '200': {
            description: 'General Settings inkl. Routing-Konfiguration.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/GeneralSettingsResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
      patch: {
        tags: ['Admin Config'],
        operationId: 'updateGeneralSettings',
        summary: 'Allgemeine Plattform-Konfiguration speichern.',
        security: securedAdmin,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: true,
                description:
                  'Teil-Update der General Settings, u. a. `routing`, `callbackUrl`, `citizenFrontend`, `languages`.',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Gespeicherte, normalisierte Konfiguration.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/GeneralSettingsResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/config/general/jurisdiction-geofence/generate': {
      post: {
        tags: ['Admin Config'],
        operationId: 'generateJurisdictionGeofence',
        summary: 'Geofence aus Ortsnamen/Regionen generieren.',
        security: securedAdmin,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  locations: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Geofence generiert.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: true,
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/config/prompts': {
      get: {
        tags: ['Admin Config'],
        operationId: 'getSystemPrompts',
        summary: 'Alle konfigurierbaren System-Prompts laden.',
        security: securedAdmin,
        responses: {
          '200': {
            description: 'Prompt-Werte inkl. Quellenmetadaten.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PromptConfigResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
      patch: {
        tags: ['Admin Config'],
        operationId: 'updateSystemPrompts',
        summary: 'System-Prompts teilweise überschreiben.',
        security: securedAdmin,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['prompts'],
                properties: {
                  prompts: {
                    type: 'object',
                    additionalProperties: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Prompts gespeichert.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PromptConfigResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/config/workflow': {
      get: {
        tags: ['Workflow Admin'],
        operationId: 'getWorkflowConfig',
        summary: 'Workflow-Laufzeitkonfiguration laden.',
        security: securedAdmin,
        responses: {
          '200': {
            description: 'Aktuelle Workflow-Konfiguration.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/WorkflowConfigResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
      patch: {
        tags: ['Workflow Admin'],
        operationId: 'updateWorkflowConfig',
        summary: 'Workflow-Laufzeitkonfiguration aktualisieren.',
        security: securedAdmin,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: true,
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Workflow-Konfiguration gespeichert.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/WorkflowConfigResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/config/workflow/templates': {
      get: {
        tags: ['Workflow Admin'],
        operationId: 'listWorkflowTemplates',
        summary: 'Workflow-Templates auflisten.',
        security: securedAdmin,
        responses: {
          '200': {
            description: 'Template-Liste.',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { type: 'object', additionalProperties: true },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
      post: {
        tags: ['Workflow Admin'],
        operationId: 'createWorkflowTemplate',
        summary: 'Neues Workflow-Template erstellen.',
        security: securedAdmin,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', additionalProperties: true },
            },
          },
        },
        responses: {
          '201': {
            description: 'Template erstellt.',
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: true },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/config/workflow/templates/{id}': {
      put: {
        tags: ['Workflow Admin'],
        operationId: 'updateWorkflowTemplate',
        summary: 'Workflow-Template aktualisieren.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', additionalProperties: true },
            },
          },
        },
        responses: {
          '200': {
            description: 'Template gespeichert.',
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: true },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
      delete: {
        tags: ['Workflow Admin'],
        operationId: 'deleteWorkflowTemplate',
        summary: 'Workflow-Template löschen.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Template gelöscht.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MessageResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/workflows': {
      get: {
        tags: ['Workflow Admin'],
        operationId: 'listWorkflowExecutions',
        summary: 'Laufende/gespeicherte Workflow-Ausführungen laden.',
        security: securedAdmin,
        responses: {
          '200': {
            description: 'Workflow-Ausführungsliste.',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { type: 'object', additionalProperties: true },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/workflows/{id}': {
      get: {
        tags: ['Workflow Admin'],
        operationId: 'getWorkflowExecution',
        summary: 'Eine Workflow-Ausführung im Detail laden.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Workflow-Ausführung.',
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: true },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
      delete: {
        tags: ['Workflow Admin'],
        operationId: 'deleteWorkflowExecution',
        summary: 'Workflow-Ausführung löschen.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Workflow gelöscht.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MessageResponse' },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/workflows/{id}/end': {
      post: {
        tags: ['Workflow Admin'],
        operationId: 'endWorkflowExecution',
        summary: 'Workflow-Ausführung manuell beenden.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  reason: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Workflow beendet.',
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: true },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/workflows/{id}/tasks/{taskId}/approve': {
      post: {
        tags: ['Workflow Admin'],
        operationId: 'approveWorkflowTask',
        summary: 'Aktive Workflow-Task manuell freigeben.',
        security: securedAdmin,
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
          { in: 'path', name: 'taskId', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Task-Freigabe verarbeitet.',
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: true },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/workflows/{id}/tasks/{taskId}/reject': {
      post: {
        tags: ['Workflow Admin'],
        operationId: 'rejectWorkflowTask',
        summary: 'Aktive Workflow-Task manuell ablehnen.',
        security: securedAdmin,
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
          { in: 'path', name: 'taskId', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Task abgelehnt.',
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: true },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/workflows/{id}/tasks/{taskId}/retry': {
      post: {
        tags: ['Workflow Admin'],
        operationId: 'retryWorkflowTask',
        summary: 'Task erneut einplanen.',
        security: securedAdmin,
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
          { in: 'path', name: 'taskId', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: { type: 'object', properties: { reason: { type: 'string' } } },
            },
          },
        },
        responses: {
          '200': {
            description: 'Retry gesetzt.',
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: true },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/workflows/{id}/tasks/{taskId}/skip': {
      post: {
        tags: ['Workflow Admin'],
        operationId: 'skipWorkflowTask',
        summary: 'Task überspringen und Workflow fortsetzen.',
        security: securedAdmin,
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
          { in: 'path', name: 'taskId', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['reason'],
                properties: {
                  reason: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Task übersprungen.',
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: true },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/workflows/{id}/tasks/{taskId}/resume': {
      post: {
        tags: ['Workflow Admin'],
        operationId: 'resumeWorkflowTask',
        summary: 'Task manuell als erledigt fortsetzen.',
        security: securedAdmin,
        parameters: [
          { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
          { in: 'path', name: 'taskId', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['reason'],
                properties: {
                  reason: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Task fortgesetzt.',
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: true },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/workflows/ticket/{ticketId}': {
      post: {
        tags: ['Workflow Admin'],
        operationId: 'attachWorkflowToTicket',
        summary: 'Workflow-Template einem Ticket zuweisen.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'ticketId', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  templateId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Workflow war bereits aktiv.',
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: true },
              },
            },
          },
          '201': {
            description: 'Workflow neu gestartet.',
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: true },
              },
            },
          },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/tickets/{ticketId}/geo-weather/refresh': {
      post: {
        tags: ['Workflow Admin'],
        operationId: 'refreshTicketGeoWeather',
        summary: 'Nominatim- und Wetterdaten für Ticket aktualisieren.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'ticketId', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Geodaten aktualisiert.',
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: true },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/api/admin/tickets/{ticketId}/geocode': {
      post: {
        tags: ['Workflow Admin'],
        operationId: 'geocodeTicketAddress',
        summary: 'Ticket-Adresse geokodieren und Koordinaten aktualisieren.',
        security: securedAdmin,
        parameters: [{ in: 'path', name: 'ticketId', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  addressOverride: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Geokodierung erfolgreich.',
            content: {
              'application/json': {
                schema: { type: 'object', additionalProperties: true },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/UnauthorizedError' },
          '403': { $ref: '#/components/responses/ForbiddenError' },
          '404': { $ref: '#/components/responses/NotFoundError' },
          '422': {
            description: 'Geokodierung ohne verwertbare Koordinaten.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiError' },
              },
            },
          },
          '502': {
            description: 'Fehler vom externen Geocoder.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiError' },
              },
            },
          },
          '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
  },
};
