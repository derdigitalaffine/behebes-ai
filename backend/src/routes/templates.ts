/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 * 
 * Email Templates API
 */

import express, { Request, Response } from 'express';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { testAIProvider } from '../services/ai.js';
import { loadAdminAccessContext } from '../services/rbac.js';
import { getSystemPrompt, loadEmailTemplateSettings, setSetting } from '../services/settings.js';
import { buildUnifiedEmailLayout, ensureUnifiedEmailTemplateHtml } from '../utils/email-design.js';
import {
  getEmailTemplate,
  listEmailTemplates,
  listKnowledgeCategories,
  upsertEmailTemplate,
} from '../services/content-libraries.js';

const router = express.Router();
const generateRouter = express.Router();

// Generate endpoint should be restricted to system settings (admin)
generateRouter.use(authMiddleware, adminOnly);

/**
 * POST /api/admin/templates/generate
 * Generiere ein Email-Template via KI
 */
generateRouter.post('/generate', async (req: Request, res: Response): Promise<any> => {
  try {
    const selection = resolveLibraryScope(req);
    await ensureTemplateLibraryScopeAccess(req, selection);
    const categoryName =
      typeof req.body?.categoryName === 'string' ? req.body.categoryName.trim() : '';
    const categoryDescription =
      typeof req.body?.categoryDescription === 'string' ? req.body.categoryDescription.trim() : '';
    const customPrompt =
      typeof req.body?.customPrompt === 'string' ? req.body.customPrompt.trim() : '';
    const templateId =
      typeof req.body?.templateId === 'string' ? req.body.templateId.trim() : '';
    const templateName =
      typeof req.body?.templateName === 'string' ? req.body.templateName.trim() : '';
    const toneInput =
      typeof req.body?.tone === 'string' ? req.body.tone.trim().toLowerCase() : 'neutral';
    const tone = GENERATION_TONE_MAP[toneInput] ? toneInput : 'neutral';
    const requiredPlaceholders = normalizePlaceholderList(req.body?.requiredPlaceholders);

    // Build the AI prompt for template generation
    const systemPrompt = await getSystemPrompt('templateGenerationPrompt');

    const promptContext = [
      templateId ? `Template-ID: ${templateId}` : '',
      templateName ? `Template-Name: ${templateName}` : '',
      categoryName ? `Kategorie: ${categoryName}` : '',
      categoryDescription ? `Beschreibung: ${categoryDescription}` : '',
      `Gewünschter Ton: ${GENERATION_TONE_MAP[tone]}`,
      requiredPlaceholders.length
        ? `Pflicht-Platzhalter: ${requiredPlaceholders.join(', ')}`
        : '',
      customPrompt ? `Zusätzliche Anweisungen: ${customPrompt}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const userPrompt = `Erstelle ein professionelles E-Mail-Template fuer die oeffentliche Verwaltung.
Das Template soll robust fuer Produktion sein, Platzhalter exakt erhalten und visuell konsequent zum behebes.AI-Theme passen.

${promptContext || 'Nutze einen neutralen Verwaltungsstil ohne spezifische Kategorie.'}

STRICT:
- Antworte mit einem JSON-Objekt mit "subject" und "htmlContent" (keine Erklärung).
- Betreff max. 90 Zeichen.
- In htmlContent nur valides HTML mit inline CSS.
- Alle Pflicht-Platzhalter müssen im Betreff ODER HTML vorkommen und unverändert bleiben.
- Keine erfundenen Links, kein JS.
- Sprache: Deutsch.

PFLICHT-THEME:
- Striktes Tabellenlayout (email-safe, ohne CSS-Klassen).
- Äußeres 100%-Table mit weißem Hintergrund (#ffffff).
- Zentrierter Content-Container mit Breite 500.
- Absenderblock mit "Verbandsgemeindeverwaltung" und "Otterbach-Otterberg".
- Titelzeile in #003762, Schriftgröße 19px, fett.
- Fließtext in #1c1c1c, line-height 1.75.
- Primärfarbe #003762, Sekundärtext #8fa3b4.
- KEINE eigene Signatur / KEIN Footer-Block im Template.`;

    let templateData;
    let aiResponse = '';
    try {
      aiResponse = await testAIProvider(systemPrompt + '\n\n' + userPrompt, {
        purpose: 'email_template_generate',
        taskKey: 'template_generation',
        meta: {
          source: 'routes.templates.generate',
          stage: 'initial',
          templateId,
        },
      });
      try {
        templateData = extractJsonPayload(aiResponse);
      } catch (parseError) {
        console.warn('AI template JSON parse failed, attempting repair:', parseError);
        try {
          const repairPrompt = await buildJsonRepairPrompt(aiResponse);
          const repairedResponse = await testAIProvider(repairPrompt, {
            purpose: 'email_template_generate',
            taskKey: 'template_json_repair',
            meta: {
              source: 'routes.templates.generate',
              stage: 'repair_json',
              templateId,
            },
          });
          templateData = extractJsonPayload(repairedResponse);
        } catch (repairError) {
          console.warn('AI template JSON repair failed, using fallback template:', repairError);
          templateData = {
            subject: `Neue Bürgermeldung${categoryName ? `: ${categoryName}` : ''}`,
            htmlContent: buildDefaultHtml('external-notification'),
          };
        }
      }
    } catch (aiError) {
      console.warn('AI template generation failed, using fallback template:', aiError);
      templateData = {
        ...buildFallbackGeneratedTemplate({
          categoryName,
          templateName,
          tone,
          requiredPlaceholders,
        }),
      };
    }

    if (
      typeof templateData.subject !== 'string' ||
      typeof templateData.htmlContent !== 'string' ||
      !templateData.subject ||
      !templateData.htmlContent
    ) {
      console.warn('KI-Antwort unvollstaendig, verwende Fallback-Template');
      templateData = {
        ...buildFallbackGeneratedTemplate({
          categoryName,
          templateName,
          tone,
          requiredPlaceholders,
        }),
      };
    }

    templateData.subject = String(templateData.subject).trim();
    templateData.htmlContent = ensureThemeHtmlForGeneratedTemplate(
      stripTemplateLocalSignatureHtml(String(templateData.htmlContent).trim()),
      templateData.subject
    );
    templateData.textContent = htmlToPlainText(templateData.htmlContent);
    templateData.textContent = stripTemplateLocalSignatureText(templateData.textContent);

    if (templateData.subject.length > 90) {
      templateData.subject = `${templateData.subject.slice(0, 87)}...`;
    }

    const missingPlaceholders = findMissingPlaceholders(
      templateData.subject,
      templateData.htmlContent,
      requiredPlaceholders
    );

    if (missingPlaceholders.length > 0) {
      try {
        const completionPromptBase = await getSystemPrompt('templatePlaceholderCompletionPrompt');
        const completionPrompt = `${completionPromptBase}

FEHLENDE PLATZHALTER:
${missingPlaceholders.join(', ')}

AKTUELLES JSON:
${JSON.stringify({ subject: templateData.subject, htmlContent: templateData.htmlContent })}

Regeln:
- Gib nur JSON mit {"subject":"...","htmlContent":"..."} zurück
- Keine weiteren Änderungen als nötig`;

        const completionRaw = await testAIProvider(completionPrompt, {
          purpose: 'email_template_generate',
          taskKey: 'template_placeholder_completion',
          meta: {
            source: 'routes.templates.generate',
            stage: 'placeholder_completion',
            templateId,
          },
        });
        const completed = extractJsonPayload(completionRaw);
        if (completed?.subject && completed?.htmlContent) {
          templateData.subject = String(completed.subject);
          templateData.htmlContent = ensureThemeHtmlForGeneratedTemplate(
            stripTemplateLocalSignatureHtml(String(completed.htmlContent)),
            String(completed.subject || templateData.subject || '')
          );
          templateData.textContent = htmlToPlainText(templateData.htmlContent);
          templateData.textContent = stripTemplateLocalSignatureText(templateData.textContent);
        }
      } catch (completionError) {
        console.warn('Failed to auto-complete missing placeholders:', completionError);
      }
    }

    const stillMissing = findMissingPlaceholders(
      templateData.subject,
      templateData.htmlContent,
      requiredPlaceholders
    );

    return res.json({
      subject: templateData.subject,
      htmlContent: templateData.htmlContent,
      textContent: templateData.textContent,
      missingPlaceholders: stillMissing,
    });
  } catch (error: any) {
    console.error('Error generating template:', error);
    return res.status(500).json({ 
      message: error.message || 'Fehler beim Generieren des Templates via KI' 
    });
  }
});

// All other template endpoints require admin role
router.use(authMiddleware, adminOnly);

const DEFAULT_SYSTEM_TEMPLATES = [
  {
    id: 'submission-confirmation',
    name: 'Meldung bestätigt',
    subject: 'E-Mail-Adresse erfolgreich bestätigt',
    placeholders: ['{citizenName}', '{ticketId}', '{category}', '{statusLink}', '{unsubscribeLink}'],
    editable: true,
    groupPath: ['Bürger', 'Eingangsbestätigung'],
    tags: ['submission', 'confirmation'],
    lifecycle: 'active',
  },
  {
    id: 'validation-email',
    name: 'E-Mail-Bestätigung (Double Opt-In)',
    subject: 'Bitte bestätigen Sie Ihre E-Mail-Adresse',
    placeholders: ['{citizenName}', '{validationLink}', '{statusLink}'],
    editable: true,
    groupPath: ['Bürger', 'Double Opt-In'],
    tags: ['doi', 'validation'],
    lifecycle: 'active',
  },
  {
    id: 'status-change',
    name: 'Status-Update',
    subject: 'Status-Update zu Ihrer Meldung ({ticketId})',
    placeholders: ['{citizenName}', '{ticketId}', '{oldStatus}', '{newStatus}', '{statusMessage}', '{statusLink}', '{unsubscribeLink}'],
    editable: true,
    groupPath: ['Bürger', 'Statuskommunikation'],
    tags: ['status', 'notification'],
    lifecycle: 'active',
  },
  {
    id: 'citizen_login_magic_link',
    name: 'Bürger-App Anmeldung (Magic Link)',
    subject: 'Anmeldelink für Ihre behebes.AI-App',
    placeholders: ['{loginLink}', '{expiresInMinutes}', '{citizenName}', '{ticketId}'],
    editable: true,
    groupPath: ['Bürger', 'Anmeldung'],
    tags: ['auth', 'magic-link'],
    lifecycle: 'active',
  },
  {
    id: 'citizen-workflow-notification',
    name: 'Workflow: Bürgerbenachrichtigung',
    subject: 'Information zu Ihrer Meldung ({ticketId})',
    placeholders: [
      '{citizenName}',
      '{ticketId}',
      '{category}',
      '{description}',
      '{location}',
      '{validationLink}',
      '{statusLink}',
      '{customMessage}',
    ],
    editable: true,
    groupPath: ['Workflow', 'Bürgerfrontend'],
    tags: ['workflow', 'citizen'],
    lifecycle: 'active',
  },
  {
    id: 'external-notification',
    name: 'Externe Weiterleitung',
    subject: 'Neue Bürgermeldung ({ticketId})',
    placeholders: ['{recipientName}', '{category}', '{description}', '{location}', '{citizenName}', '{citizenEmail}', '{ticketId}'],
    editable: true,
    groupPath: ['Extern', 'Weiterleitung'],
    tags: ['external', 'forwarding'],
    lifecycle: 'active',
  },
  {
    id: 'workflow-confirmation',
    name: 'Workflow-Bestätigung',
    subject: 'Freigabe benötigt für Ticket {ticketId}',
    placeholders: [
      '{recipientName}',
      '{ticketId}',
      '{category}',
      '{location}',
      '{validationLink}',
      '{approveLink}',
      '{rejectLink}',
      '{decisionPageLink}',
      '{approvalInstruction}',
      '{statusLink}',
      '{workflowTitle}',
      '{workflowStepTitle}',
      '{citizenName}',
      '{citizenEmail}',
    ],
    editable: true,
    groupPath: ['Workflow', 'Freigabe'],
    tags: ['workflow', 'approval', 'doi'],
    lifecycle: 'active',
  },
  {
    id: 'workflow-data-request',
    name: 'Workflow: Datennachforderung',
    subject: 'Bitte ergänzen Sie Angaben zu Ihrer Meldung ({ticketId})',
    placeholders: [
      '{citizenName}',
      '{ticketId}',
      '{category}',
      '{location}',
      '{formLink}',
      '{statusLink}',
      '{requestFieldsSummary}',
      '{expiresAt}',
      '{introText}',
    ],
    editable: true,
    groupPath: ['Workflow', 'Datennachforderung'],
    tags: ['workflow', 'data-request'],
    lifecycle: 'active',
  },
  {
    id: 'workflow-mayor-involvement-notify',
    name: 'Workflow: Ortsbuergermeister informieren',
    subject: 'Information zu Ticket {ticketId} aus Ihrem Zustaendigkeitsbereich',
    placeholders: [
      '{recipientName}',
      '{ticketId}',
      '{category}',
      '{location}',
      '{mayorLocationType}',
      '{mayorLocationValue}',
      '{workflowTitle}',
      '{workflowStepTitle}',
      '{citizenName}',
      '{citizenEmail}',
      '{description}',
      '{statusLink}',
    ],
    editable: true,
    groupPath: ['Workflow', 'Ortsgemeinde', 'Information'],
    tags: ['workflow', 'mayor', 'notify'],
    lifecycle: 'active',
  },
  {
    id: 'workflow-mayor-involvement-approval',
    name: 'Workflow: Ortsbuergermeister-Zustimmung',
    subject: 'Rueckmeldung zum Ticket {ticketId} erforderlich',
    placeholders: [
      '{recipientName}',
      '{ticketId}',
      '{category}',
      '{location}',
      '{mayorLocationType}',
      '{mayorLocationValue}',
      '{workflowTitle}',
      '{workflowStepTitle}',
      '{citizenName}',
      '{citizenEmail}',
      '{description}',
      '{approvalInstruction}',
      '{decisionPageLink}',
      '{approveLink}',
      '{rejectLink}',
      '{statusLink}',
    ],
    editable: true,
    groupPath: ['Workflow', 'Ortsgemeinde', 'Zustimmung'],
    tags: ['workflow', 'mayor', 'approval'],
    lifecycle: 'active',
  },
];

const DEFAULT_EXTERNAL_PLACEHOLDERS = [
  '{citizenName}',
  '{citizenEmail}',
  '{ticketId}',
  '{category}',
  '{description}',
  '{location}',
  '{recipientName}',
];

const GENERATION_TONE_MAP: Record<string, string> = {
  neutral: 'neutral, sachlich, präzise',
  formal: 'sehr formell, verwaltungsnah, distanziert',
  friendly: 'freundlich, serviceorientiert, aber professionell',
  concise: 'kurz, handlungsorientiert, ohne unnötige Floskeln',
};

const PLACEHOLDER_CATALOG: Record<
  string,
  { label: string; description: string; example: string }
> = {
  '{citizenName}': {
    label: 'Name der meldenden Person',
    description: 'Vollständiger Name aus dem Bürgerformular.',
    example: 'Max Mustermann',
  },
  '{citizenEmail}': {
    label: 'E-Mail der meldenden Person',
    description: 'E-Mail-Adresse aus dem Bürgerformular.',
    example: 'max.mustermann@example.com',
  },
  '{ticketId}': {
    label: 'Ticket-ID',
    description: 'Interne Ticketnummer der Meldung.',
    example: 'TK-12345678',
  },
  '{category}': {
    label: 'Kategorie',
    description: 'Klassifizierte Kategorie der Meldung.',
    example: 'Schlaglöcher & Straßenschäden',
  },
  '{description}': {
    label: 'Beschreibung',
    description: 'Beschreibungstext aus der Meldung.',
    example: 'Auf der Fahrbahn befindet sich ein tiefes Schlagloch.',
  },
  '{location}': {
    label: 'Ort/Adresse',
    description: 'Adress- oder Ortsangabe der Meldung.',
    example: 'Hauptstraße 42, 67697 Otterbach',
  },
  '{address}': {
    label: 'Adresse',
    description: 'Straße und Hausnummer des gemeldeten Standorts.',
    example: 'Hauptstraße 42',
  },
  '{postalCode}': {
    label: 'Postleitzahl',
    description: 'Postleitzahl des gemeldeten Standorts.',
    example: '67697',
  },
  '{city}': {
    label: 'Ort',
    description: 'Ort bzw. Gemeinde des gemeldeten Standorts.',
    example: 'Otterbach',
  },
  '{coordinates}': {
    label: 'Koordinaten',
    description: 'Breiten- und Längengrad als Text.',
    example: '49.484200, 7.698100',
  },
  '{latitude}': {
    label: 'Breitengrad',
    description: 'Numerischer Breitengrad der Meldung.',
    example: '49.484200',
  },
  '{longitude}': {
    label: 'Längengrad',
    description: 'Numerischer Längengrad der Meldung.',
    example: '7.698100',
  },
  '{submissionId}': {
    label: 'Submission-ID',
    description: 'Interne ID des ursprünglichen Formulareintrags.',
    example: 'sub_123456789',
  },
  '{priority}': {
    label: 'Priorität',
    description: 'Dringlichkeit des Tickets.',
    example: 'hoch',
  },
  '{status}': {
    label: 'Status',
    description: 'Aktueller Ticketstatus.',
    example: 'in Bearbeitung',
  },
  '{assignedTo}': {
    label: 'Zuständige Stelle',
    description: 'Aktuell zugewiesene Person oder Gruppe.',
    example: 'Bauhof Otterberg',
  },
  '{redmineIssueId}': {
    label: 'Redmine Issue-ID',
    description: 'ID des verknüpften Redmine-Tickets.',
    example: '4711',
  },
  '{redmineProject}': {
    label: 'Redmine-Projekt',
    description: 'Projektname oder Identifier in Redmine.',
    example: 'bauhof',
  },
  '{currentDate}': {
    label: 'Aktuelles Datum',
    description: 'Heutiges Datum zum Versandzeitpunkt.',
    example: '16.02.2026',
  },
  '{currentTime}': {
    label: 'Aktuelle Uhrzeit',
    description: 'Uhrzeit zum Versandzeitpunkt.',
    example: '14:35',
  },
  '{validationLink}': {
    label: 'Bestätigungslink',
    description: 'Link zur Double-Opt-In-Bestätigung.',
    example: 'https://www.behebes.de/verify?token=...',
  },
  '{statusLink}': {
    label: 'Statuslink',
    description: 'Link zur Statusansicht der Meldung.',
    example: 'https://www.behebes.de/status?token=...',
  },
  '{formLink}': {
    label: 'Formular-Link',
    description: 'Link zum Datennachforderungs-Formular.',
    example: 'https://www.behebes.de/workflow/data-request?token=...',
  },
  '{requestFieldsSummary}': {
    label: 'Zusammenfassung der Rückfragen',
    description: 'Kurzliste der nachgeforderten Angaben.',
    example: '• Schadensausmaß\n• Menge\n• Zusatzdetails',
  },
  '{expiresAt}': {
    label: 'Ablaufdatum',
    description: 'Zeitpunkt, bis zu dem die Datennachforderung gültig ist.',
    example: '18.02.2026 14:30',
  },
  '{introText}': {
    label: 'Einleitungstext',
    description: 'Konfigurierter Einleitungstext aus dem Datennachforderungs-Schritt.',
    example: 'Bitte beantworten Sie die folgenden Fragen.',
  },
  '{unsubscribeLink}': {
    label: 'Abmeldelink',
    description: 'Link zum Abbestellen automatischer Status-E-Mails.',
    example: 'https://www.behebes.de/verify?token=...&cb=ticket_unsubscribe',
  },
  '{oldStatus}': {
    label: 'Vorheriger Status',
    description: 'Status vor der Änderung.',
    example: 'Offen',
  },
  '{newStatus}': {
    label: 'Neuer Status',
    description: 'Aktueller Status nach der Änderung.',
    example: 'In Bearbeitung',
  },
  '{statusMessage}': {
    label: 'Statushinweis',
    description: 'Zusätzlicher Hinweistext zur Statusänderung.',
    example: 'Ihre Meldung wurde an die zuständige Fachabteilung übergeben.',
  },
  '{recipientName}': {
    label: 'Name der empfangenden Stelle',
    description: 'Name der externen oder internen Empfängerperson.',
    example: 'Bauhof Otterberg',
  },
  '{customMessage}': {
    label: 'Freitext aus Workflow',
    description: 'Zusätzlicher Hinweis aus einem Workflow-Schritt.',
    example: 'Bitte prüfen Sie den Fortschritt über den Statuslink.',
  },
  '{approveLink}': {
    label: 'Freigabe-Link',
    description: 'Link zur Zustimmung in einem Workflow-Bestätigungsschritt.',
    example: 'https://www.behebes.de/workflow/confirm?decision=approve&token=...',
  },
  '{rejectLink}': {
    label: 'Ablehnungs-Link',
    description: 'Link zur Ablehnung in einem Workflow-Bestätigungsschritt.',
    example: 'https://www.behebes.de/workflow/confirm?decision=reject&token=...',
  },
  '{decisionPageLink}': {
    label: 'Entscheidungsseite',
    description: 'Link zur Detailseite mit Ticketinformationen und prominenten Zustimmen/Ablehnen-Buttons.',
    example: 'https://www.behebes.de/workflow/confirm?token=...',
  },
  '{approvalInstruction}': {
    label: 'Anweisung im Freigabeschritt',
    description: 'Manuell oder KI-generierter Hinweistext, der im Freigabeprozess angezeigt wird.',
    example: 'Bitte prüfen Sie, ob alle Angaben vollständig sind und entscheiden Sie anschließend.',
  },
  '{workflowTitle}': {
    label: 'Workflow-Name',
    description: 'Titel der laufenden Workflow-Instanz.',
    example: 'Standard: Redmine Ticket',
  },
  '{workflowStepTitle}': {
    label: 'Workflow-Schrittname',
    description: 'Titel des konkreten Bestätigungsschritts.',
    example: 'Freigabe durch Sachbearbeitung',
  },
};


interface EmailTemplateSettingsPayload {
  footerEnabled: boolean;
  footerHtml: string;
  footerText: string;
}

function buildTemplateUsageHint(template: any): string {
  const id = String(template?.id || '').trim();
  if (id === 'validation-email') {
    return 'Wird unmittelbar nach dem Absenden einer Meldung für die E-Mail-Bestätigung (Double Opt-In) versendet.';
  }
  if (id === 'submission-confirmation') {
    return 'Wird nach erfolgreicher E-Mail-Bestätigung an die meldende Person versendet.';
  }
  if (id === 'status-change') {
    return 'Wird bei Statusänderungen automatisch an die meldende Person versendet.';
  }
  if (id === 'citizen-workflow-notification') {
    return 'Wird durch Workflow-Schritte für zusätzliche Bürger-Informationen verwendet.';
  }
  if (id === 'external-notification') {
    return 'Standardvorlage für die Weiterleitung von Meldungen an externe Stellen.';
  }
  if (id === 'workflow-confirmation') {
    return 'Wird für Freigabe-/Entscheidungsschritte innerhalb von Workflows versendet.';
  }
  if (id === 'workflow-data-request') {
    return 'Wird in Datennachforderungs-Schritten versendet und enthält den Link zum Rückfrageformular.';
  }
  if (id.startsWith('template-')) {
    return 'Kategorieabhängige Weiterleitungs-E-Mail an externe Empfänger.';
  }
  return 'Allgemeines E-Mail-Template.';
}

function buildTemplateAudience(template: any): string {
  const id = String(template?.id || '').trim();
  if (id === 'external-notification' || id.startsWith('template-')) return 'Externe Stelle';
  if (id === 'workflow-confirmation') return 'Interne/externe Freigabestelle';
  if (id === 'workflow-data-request') return 'Meldende Person';
  return 'Meldende Person';
}

function normalizeGroupPath(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const values = input
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, 3);
  return Array.from(new Set(values));
}

function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const values = input
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 24);
  return Array.from(new Set(values));
}

function normalizeLifecycle(input: unknown): 'draft' | 'active' | 'deprecated' {
  const raw = String(input || '').trim().toLowerCase();
  if (raw === 'draft' || raw === 'deprecated') return raw;
  return 'active';
}

function deriveTemplateGroupPath(template: any): string[] {
  const fromTemplate = normalizeGroupPath(template?.groupPath);
  if (fromTemplate.length > 0) return fromTemplate;
  const id = String(template?.id || '').trim();
  if (id === 'validation-email') return ['Bürger', 'Double Opt-In'];
  if (id === 'submission-confirmation') return ['Bürger', 'Eingangsbestätigung'];
  if (id === 'status-change') return ['Bürger', 'Statuskommunikation'];
  if (id === 'workflow-confirmation') return ['Workflow', 'Freigabe'];
  if (id === 'workflow-data-request') return ['Workflow', 'Datennachforderung'];
  if (id === 'citizen-workflow-notification') return ['Workflow', 'Bürgerfrontend'];
  if (id === 'external-notification' || id.startsWith('template-')) return ['Extern', 'Weiterleitung'];
  return ['System', 'Allgemein'];
}

function deriveTemplateTags(template: any): string[] {
  const fromTemplate = normalizeTags(template?.tags);
  if (fromTemplate.length > 0) return fromTemplate;
  const id = String(template?.id || '').trim();
  if (id === 'workflow-confirmation') return ['workflow', 'approval'];
  if (id === 'workflow-data-request') return ['workflow', 'data-request'];
  if (id === 'validation-email') return ['doi', 'validation'];
  if (id === 'status-change') return ['status', 'notification'];
  if (id === 'external-notification' || id.startsWith('template-')) return ['external'];
  return [];
}

function enrichTemplateForAdminList(template: any) {
  const placeholders = normalizePlaceholderList(template?.placeholders || []);
  const groupPath = deriveTemplateGroupPath(template);
  const tags = deriveTemplateTags(template);
  const lifecycle = normalizeLifecycle(template?.lifecycle);
  return {
    ...template,
    placeholders,
    usageHint: buildTemplateUsageHint(template),
    audience: buildTemplateAudience(template),
    groupPath,
    tags,
    lifecycle,
    ownerTeam:
      typeof template?.ownerTeam === 'string' && template.ownerTeam.trim()
        ? template.ownerTeam.trim()
        : 'Fachadministration',
    maintainer:
      typeof template?.maintainer === 'string' && template.maintainer.trim()
        ? template.maintainer.trim()
        : 'System',
    lastReviewedAt:
      typeof template?.lastReviewedAt === 'string' && template.lastReviewedAt.trim()
        ? template.lastReviewedAt
        : null,
  };
}

function normalizePlaceholderList(input: any): string[] {
  if (!Array.isArray(input)) return [];
  const normalized = input
    .map((entry) => String(entry || '').trim())
    .filter((entry) => /^\{[a-zA-Z0-9_]+\}$/.test(entry));
  return Array.from(new Set(normalized));
}

function normalizeTemplateId(input: unknown): string {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.replace(/[^a-z0-9_-]/g, '-').replace(/--+/g, '-').replace(/^-+|-+$/g, '');
}

function findMissingPlaceholders(subject: string, html: string, required: string[]): string[] {
  return required.filter((placeholder) => !subject.includes(placeholder) && !html.includes(placeholder));
}

function buildFallbackGeneratedTemplate(input: {
  categoryName?: string;
  templateName?: string;
  tone?: string;
  requiredPlaceholders: string[];
}) {
  const subjectPrefix = input.templateName || 'Neue Bürgermeldung';
  const categoryPart = input.categoryName ? `: ${input.categoryName}` : '';
  const subject = `${subjectPrefix}${categoryPart}`.slice(0, 90);
  const requiredRows = input.requiredPlaceholders
    .map((placeholder) => `<li style='margin:0 0 4px 0;'>${placeholder}</li>`)
    .join('\n');

  const htmlContent = buildDefaultEmailShell({
    title: subjectPrefix,
    lead: `Guten Tag ${input.requiredPlaceholders.includes('{recipientName}') ? '{recipientName}' : ''},`,
    bodyHtml: `
  <p>es liegt eine neue Bürgermeldung vor. Bitte prüfen Sie die Angaben und übernehmen Sie die weitere Bearbeitung.</p>
  <p><strong>Kategorie:</strong> ${input.requiredPlaceholders.includes('{category}') ? '{category}' : 'n/a'}<br/>
  <strong>Ort:</strong> ${input.requiredPlaceholders.includes('{location}') ? '{location}' : 'n/a'}<br/>
  <strong>Ticket-ID:</strong> ${input.requiredPlaceholders.includes('{ticketId}') ? '{ticketId}' : 'n/a'}</p>
  <p><strong>Beschreibung:</strong><br/>${input.requiredPlaceholders.includes('{description}') ? '{description}' : 'n/a'}</p>
  <p><strong>Meldende Person:</strong> ${input.requiredPlaceholders.includes('{citizenName}') ? '{citizenName}' : 'n/a'} ${input.requiredPlaceholders.includes('{citizenEmail}') ? '({citizenEmail})' : ''}</p>
  ${requiredRows ? `<hr style='margin:16px 0;border:none;border-top:1px solid #c8d7e5;'/><p style='margin:0 0 8px 0;font-size:12px;color:#4f667f;'>Erforderliche Platzhalter:</p><ul style='margin:0;padding-left:18px;font-size:12px;color:#4f667f;'>${requiredRows}</ul>` : ''}
`,
  });

  return {
    subject,
    htmlContent,
    textContent: htmlToPlainText(htmlContent),
  };
}

function escapeHtml(input: string): string {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripTemplateLocalSignatureHtml(html: string): string {
  const source = String(html || '').trim();
  if (!source) return '';
  const withoutTrailingSignatureParagraph = source
    .replace(
      /(?:\s*<p\b[^>]*>\s*(?:Mit freundlichen Gr(?:ü|ue)(?:ß|ss)en|Freundliche Gr(?:ü|ue)(?:ß|ss)e|Best regards|Kind regards|Regards)[\s\S]*?<\/p>\s*)$/i,
      ''
    )
    .replace(
      /(?:\s*<p\b[^>]*>\s*(?:Mit freundlichen Gr(?:ü|ue)(?:ß|ss)en|Freundliche Gr(?:ü|ue)(?:ß|ss)e|Best regards|Kind regards|Regards)[\s\S]*?<\/p>\s*)(\s*(?:<\/(?:div|section|article|table|tbody|tr|td|body|html)>\s*)+)$/i,
      '$1'
    );
  return withoutTrailingSignatureParagraph.trim();
}

function stripTemplateLocalSignatureText(text: string): string {
  const source = String(text || '').trim();
  if (!source) return '';
  return source
    .replace(
      /(?:\r?\n){1,3}(?:Mit freundlichen Gr(?:ü|ue)(?:ß|ss)en|Freundliche Gr(?:ü|ue)(?:ß|ss)e|Best regards|Kind regards|Regards)[\s\S]*$/i,
      ''
    )
    .trim();
}

function ensureThemeHtmlForGeneratedTemplate(html: string, subject: string): string {
  return ensureUnifiedEmailTemplateHtml(String(html || ''), String(subject || '').trim());
}

const CATEGORY_TEMPLATE_PREFIX = 'template-';

async function loadCategoriesWithExternalEmail(): Promise<any[]> {
  try {
    const categories = await listKnowledgeCategories({
      scope: 'platform',
      includeInherited: true,
    });
    return categories.filter(
      (cat: any) =>
        cat &&
        typeof (cat.externalRecipientEmail ?? cat.recipientEmail) === 'string' &&
        String(cat.externalRecipientEmail ?? cat.recipientEmail).trim().length > 0
    );
  } catch (error) {
    console.warn('Kategorien konnten nicht geladen werden:', error);
    return [];
  }
}


function htmlToPlainText(html: string): string {
  const source = String(html || '');
  if (!source.trim()) return '';
  return source
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n\n')
    .replace(/<\/\s*div\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<\/\s*li\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, '\'')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function replacePreviewPlaceholders(content: string): string {
  return String(content || '')
    .replace(/{citizenName}/g, 'Max Mustermann')
    .replace(/{citizenEmail}/g, 'max.mustermann@example.com')
    .replace(/{ticketId}/g, 'TK-12345678')
    .replace(/{submissionId}/g, 'sub_123456789')
    .replace(/{category}/g, 'Schlaglöcher & Straßenschäden')
    .replace(/{priority}/g, 'hoch')
    .replace(/{status}/g, 'in Bearbeitung')
    .replace(/{address}/g, 'Hauptstraße 42')
    .replace(/{postalCode}/g, '67697')
    .replace(/{city}/g, 'Otterbach')
    .replace(/{coordinates}/g, '49.484200, 7.698100')
    .replace(/{latitude}/g, '49.484200')
    .replace(/{longitude}/g, '7.698100')
    .replace(/{validationLink}/g, 'https://example.com/verify?token=...')
    .replace(/{statusLink}/g, 'https://example.com/verify?token=...&cb=ticket_status')
    .replace(/{unsubscribeLink}/g, 'https://example.com/verify?token=...&cb=ticket_unsubscribe')
    .replace(/{approveLink}/g, 'https://example.com/workflow/confirm?token=...&decision=approve')
    .replace(/{rejectLink}/g, 'https://example.com/workflow/confirm?token=...&decision=reject')
    .replace(/{decisionPageLink}/g, 'https://example.com/workflow/confirm?token=...')
    .replace(/{approvalInstruction}/g, 'Bitte prüfen Sie die Meldung und entscheiden Sie anschließend.')
    .replace(/{workflowTitle}/g, 'Standard: Redmine Ticket')
    .replace(/{workflowStepTitle}/g, 'Freigabe durch Sachbearbeitung')
    .replace(/{oldStatus}/g, 'Offen')
    .replace(/{newStatus}/g, 'In Bearbeitung')
    .replace(/{statusMessage}/g, 'Ihr Anliegen wurde an die zuständige Stelle weitergeleitet.')
    .replace(/{customMessage}/g, 'Bitte bestätigen Sie Ihre Meldung und prüfen Sie den aktuellen Bearbeitungsstand.')
    .replace(/{assignedTo}/g, 'Bauhof Otterberg')
    .replace(/{redmineIssueId}/g, '4711')
    .replace(/{redmineProject}/g, 'bauhof')
    .replace(/{currentDate}/g, '16.02.2026')
    .replace(/{currentTime}/g, '14:35')
    .replace(/{recipientName}/g, 'Max Empfänger')
    .replace(/{description}/g, 'Beispiel-Beschreibung eines Problems')
    .replace(/{location}/g, 'Hauptstraße 42, 67697 Otterbach');
}

function extractJsonPayload(raw: string): any {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  const markerMatch = trimmed.match(/BEGIN_JSON\s*([\s\S]*?)\s*END_JSON/i);
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = markerMatch
    ? markerMatch[1].trim()
    : fencedMatch
    ? fencedMatch[1].trim()
    : trimmed;

  const braceMatch = candidate.match(/\{[\s\S]*\}/);
  if (!braceMatch) {
    throw new Error('KI-Antwort ist kein gültiges JSON');
  }

  const normalized = normalizeJsonString(braceMatch[0]);
  try {
    return JSON.parse(normalized);
  } catch (error) {
    const subjectMatch =
      normalized.match(/"subject"\s*:\s*"([\s\S]*?)"\s*,/i) ||
      normalized.match(/"subject"\s*:\s*"([\s\S]*?)"/i);
    const htmlMatch = normalized.match(/"htmlContent"\s*:\s*"([\s\S]*)"\s*}/i);
    if (subjectMatch && htmlMatch) {
      return {
        subject: unescapeJsonString(subjectMatch[1].trim()),
        htmlContent: unescapeJsonString(htmlMatch[1].trim()),
      };
    }
    throw error;
  }
}

function normalizeJsonString(jsonLike: string): string {
  let input = jsonLike
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, '\'')
    .replace(/,\s*([}\]])/g, '$1');

  let output = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (inString) {
      if (ch === '\r') {
        continue;
      }
      if (ch === '\n') {
        output += '\\n';
        continue;
      }
      if (ch === '"' && !escaped) {
        inString = false;
        output += ch;
        continue;
      }
      if (ch === '\\' && !escaped) {
        escaped = true;
        output += ch;
        continue;
      }
      escaped = false;
      output += ch;
      continue;
    }

    if (ch === '"') {
      inString = true;
    }
    output += ch;
  }

  return output;
}

function unescapeJsonString(value: string): string {
  return value
    .replace(/\\\\/g, '\\')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"');
}

async function buildJsonRepairPrompt(raw: string): Promise<string> {
  const promptBase = await getSystemPrompt('templateJsonRepairPrompt');
  return `${promptBase}

KI-ANTWORT:
${raw}`;
}

function normalizeTemplateSettingsInput(input: any, current: EmailTemplateSettingsPayload): EmailTemplateSettingsPayload {
  const nextEnabled = typeof input?.footerEnabled === 'boolean' ? input.footerEnabled : current.footerEnabled;
  const nextFooterHtml =
    typeof input?.footerHtml === 'string' ? input.footerHtml.trim() : (current.footerHtml || '');
  const nextFooterText =
    typeof input?.footerText === 'string' ? input.footerText.trim() : (current.footerText || '');

  return {
    footerEnabled: nextEnabled,
    footerHtml: nextFooterHtml,
    footerText: nextFooterText,
  };
}

async function loadTemplateSettingsPayload(): Promise<EmailTemplateSettingsPayload> {
  const { values } = await loadEmailTemplateSettings();
  return {
    footerEnabled: values.footerEnabled !== false,
    footerHtml: values.footerHtml || '',
    footerText: values.footerText || '',
  };
}

function appendFooterToPreviewHtml(html: string, settings: EmailTemplateSettingsPayload): string {
  if (!settings.footerEnabled || !settings.footerHtml.trim()) return html;
  return `${html}
<div style="margin-top:24px;padding-top:12px;border-top:1px solid #c8d7e5;color:#42576d;font-size:12px;line-height:1.5;">
${settings.footerHtml}
</div>`;
}

function appendFooterToPreviewText(text: string, settings: EmailTemplateSettingsPayload): string {
  const normalized = String(text || '').trim();
  if (!settings.footerEnabled) return normalized;
  const footerText = String(settings.footerText || '').trim() || htmlToPlainText(settings.footerHtml || '');
  if (!footerText) return normalized;
  return normalized ? `${normalized}\n\n---\n${footerText}` : footerText;
}

function buildDefaultEmailShell(input: {
  title: string;
  lead: string;
  bodyHtml: string;
  actionHtml?: string;
  noteHtml?: string;
}): string {
  const actionHtml = input.actionHtml ? `<div style="margin:18px 0 16px 0;">${input.actionHtml}</div>` : '';
  const noteHtml = input.noteHtml
    ? `<div style="margin-top:16px;padding:10px 12px;border-radius:10px;background:#f1f6fb;border:1px solid #dbe3f0;color:#35556f;font-size:13px;line-height:1.5;">${input.noteHtml}</div>`
    : '';
  const body = `
<p style="margin:0 0 10px 0;font-size:14px;color:#1c1c1c;line-height:1.75;font-family:'Segoe UI',Arial,sans-serif;">${escapeHtml(input.lead)}</p>
<div style="font-size:14px;color:#1c1c1c;line-height:1.75;font-family:'Segoe UI',Arial,sans-serif;">
${input.bodyHtml}
</div>
${actionHtml}
${noteHtml}
`;
  return buildUnifiedEmailLayout(String(input.title || '').trim(), body);
}

function buildDefaultHtml(templateId: string): string {
  switch (templateId) {
    case 'submission-confirmation':
      return buildDefaultEmailShell({
        title: 'E-Mail-Adresse erfolgreich bestätigt',
        lead: 'Guten Tag {citizenName},',
        bodyHtml: `
          <p>Ihre E-Mail-Adresse wurde erfolgreich bestätigt.</p>
          <p>Ihre Meldung ist nun bei uns eingegangen und befindet sich in Bearbeitung.</p>
          <div style="background:#f1f6fb;border:1px solid #dbe3f0;padding:14px;border-radius:10px;margin:16px 0;">
            <p style="margin:0;"><strong>Ticket-ID:</strong> {ticketId}</p>
          </div>
          <p>Den aktuellen Bearbeitungsstatus können Sie jederzeit unter folgendem Link einsehen:</p>
        `,
        actionHtml:
          '<a href="{statusLink}" style="display:inline-block;background:#003762;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:700;">Bearbeitungsstatus</a>',
        noteHtml:
          'Wenn Sie keine weiteren automatischen E-Mails wünschen, können Sie diese hier abbestellen: <span style="word-break:break-all;">{unsubscribeLink}</span>',
      });
    case 'validation-email':
      return buildDefaultEmailShell({
        title: 'Bitte bestätigen Sie Ihre Meldung',
        lead: 'Guten Tag {citizenName},',
        bodyHtml: `
          <p>vielen Dank für Ihre Meldung. Bitte bestätigen Sie Ihre E-Mail-Adresse, indem Sie den folgenden Link öffnen:</p>
          <p>Erst nach der Bestätigung können wir Ihre Meldung bearbeiten.</p>
          <p>Sollten Sie keine E-Mail erwartet haben oder diese Anfrage nicht von Ihnen stammen, können Sie diese Nachricht ignorieren.</p>
          <p>Den Bearbeitungsstatus Ihrer Meldung können Sie über folgenden Link einsehen:</p>
        `,
        actionHtml:
          '<a href="{validationLink}" style="display:inline-block;background:#003762;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:700;margin:0 10px 10px 0;">Bestätigung Ihrer E-Mailadresse</a><a href="{statusLink}" style="display:inline-block;background:#1f4f7f;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:700;margin:0 0 10px 0;">Bearbeitungsstatus</a>',
        noteHtml:
          'Direktlinks:<br/>Bestätigen: <span style="word-break:break-all;">{validationLink}</span><br/>Ticketstatus: <span style="word-break:break-all;">{statusLink}</span>',
      });
    case 'status-change':
      return buildDefaultEmailShell({
        title: 'Status-Update zu Ihrer Meldung',
        lead: 'Guten Tag {citizenName},',
        bodyHtml: `
          <p>der Bearbeitungsstand Ihres Tickets <strong>{ticketId}</strong> wurde aktualisiert.</p>
          <div style="background:#f1f6fb;border:1px solid #dbe3f0;padding:14px;border-radius:10px;margin:16px 0;">
            <p style="margin:0 0 6px 0;"><strong>Vorher:</strong> {oldStatus}</p>
            <p style="margin:0 0 6px 0;"><strong>Neu:</strong> {newStatus}</p>
            <p style="margin:0;">{statusMessage}</p>
          </div>
        `,
        actionHtml:
          '<a href="{statusLink}" style="display:inline-block;background:#003762;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:700;">Bearbeitungsstand ansehen</a>',
        noteHtml:
          'Direktlink zur Statusseite: <span style="word-break:break-all;">{statusLink}</span><br/>Abmelden: <span style="word-break:break-all;">{unsubscribeLink}</span>',
      });
    case 'citizen-workflow-notification':
      return buildDefaultEmailShell({
        title: 'Information zu Ihrer Meldung',
        lead: 'Guten Tag {citizenName},',
        bodyHtml: `
          <p>zu Ihrer Meldung <strong>{ticketId}</strong> gibt es eine neue Information.</p>
          <div style="background:#f1f6fb;border:1px solid #dbe3f0;padding:14px;border-radius:10px;margin:16px 0;">
            <p style="margin:0 0 6px 0;"><strong>Kategorie:</strong> {category}</p>
            <p style="margin:0;"><strong>Ort:</strong> {location}</p>
          </div>
          <p>{customMessage}</p>
        `,
        actionHtml:
          '<a href="{validationLink}" style="display:inline-block;background:#31932e;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;margin-right:8px;">Meldung bestätigen</a><a href="{statusLink}" style="display:inline-block;background:#003762;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;">Status ansehen</a>',
      });
    case 'external-notification':
      return buildDefaultEmailShell({
        title: 'Neue Bürgermeldung zur Bearbeitung',
        lead: 'Guten Tag {recipientName},',
        bodyHtml: `
          <p>über behebes.AI wurde eine neue Meldung für Ihre Zuständigkeit erfasst.</p>
          <div style="background:#f1f6fb;border:1px solid #dbe3f0;padding:14px;border-radius:10px;margin:16px 0;">
            <p style="margin:0 0 6px 0;"><strong>Ticket-ID:</strong> {ticketId}</p>
            <p style="margin:0 0 6px 0;"><strong>Kategorie:</strong> {category}</p>
            <p style="margin:0 0 6px 0;"><strong>Ort:</strong> {location}</p>
            <p style="margin:0;"><strong>Meldende Person:</strong> {citizenName} ({citizenEmail})</p>
          </div>
          <p><strong>Beschreibung:</strong><br/>{description}</p>
        `,
      });
    case 'workflow-confirmation':
      return buildDefaultEmailShell({
        title: 'Workflow-Freigabe erforderlich',
        lead: 'Guten Tag {recipientName},',
        bodyHtml: `
          <p>bitte entscheiden Sie über den nächsten Schritt für Ticket <strong>{ticketId}</strong>.</p>
          <div style="background:#f1f6fb;border:1px solid #dbe3f0;padding:14px;border-radius:10px;margin:16px 0;">
            <p style="margin:0 0 6px 0;"><strong>Workflow:</strong> {workflowTitle}</p>
            <p style="margin:0 0 6px 0;"><strong>Schritt:</strong> {workflowStepTitle}</p>
            <p style="margin:0 0 6px 0;"><strong>Kategorie:</strong> {category}</p>
            <p style="margin:0 0 6px 0;"><strong>Ort:</strong> {location}</p>
            <p style="margin:0;"><strong>Meldende Person:</strong> {citizenName} ({citizenEmail})</p>
          </div>
          <div style="background:#f1f6fb;border:1px solid #dbe3f0;padding:14px;border-radius:10px;margin:16px 0;">
            <p style="margin:0 0 6px 0;"><strong>Anweisung:</strong></p>
            <p style="margin:0;white-space:pre-wrap;">{approvalInstruction}</p>
          </div>
        `,
        actionHtml:
          '<a href="{decisionPageLink}" style="display:inline-block;background:#003762;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;margin-right:8px;">Entscheidungsseite öffnen</a><a href="{approveLink}" style="display:inline-block;background:#31932e;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;margin-right:8px;">Zustimmen</a><a href="{rejectLink}" style="display:inline-block;background:#ec5840;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;margin-right:8px;">Ablehnen</a><a href="{statusLink}" style="display:inline-block;background:#1f4f7f;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;">Ticketstatus</a>',
        noteHtml:
          'Direktlinks:<br/>Entscheidungsseite: <span style="word-break:break-all;">{decisionPageLink}</span><br/>Zustimmen: <span style="word-break:break-all;">{approveLink}</span><br/>Ablehnen: <span style="word-break:break-all;">{rejectLink}</span><br/>Ticketstatus: <span style="word-break:break-all;">{statusLink}</span>',
      });
    case 'workflow-mayor-involvement-notify':
      return buildDefaultEmailShell({
        title: 'Ortsbuergermeister-Information',
        lead: 'Guten Tag {recipientName},',
        bodyHtml: `
          <p>im Rahmen unseres digitalen Verwaltungsworkflows moechten wir Sie fruehzeitig ueber ein Anliegen aus Ihrem Zustaendigkeitsbereich informieren.</p>
          <div style="background:#f1f6fb;border:1px solid #dbe3f0;padding:14px;border-radius:10px;margin:16px 0;">
            <p style="margin:0 0 6px 0;"><strong>Ticket-ID:</strong> {ticketId}</p>
            <p style="margin:0 0 6px 0;"><strong>Kategorie:</strong> {category}</p>
            <p style="margin:0 0 6px 0;"><strong>Ort:</strong> {location}</p>
            <p style="margin:0 0 6px 0;"><strong>Zustaendigkeit:</strong> {mayorLocationType} {mayorLocationValue}</p>
            <p style="margin:0 0 6px 0;"><strong>Workflow:</strong> {workflowTitle}</p>
            <p style="margin:0;"><strong>Schritt:</strong> {workflowStepTitle}</p>
          </div>
          <p style="margin:0 0 10px 0;"><strong>Meldende Person:</strong> {citizenName} ({citizenEmail})</p>
          <p style="margin:0 0 10px 0;"><strong>Kurzbeschreibung:</strong><br>{description}</p>
          <p style="margin:0;">Diese Information dient Ihrer transparenten Einbindung. Eine aktive Entscheidung ist in diesem Workflow-Schritt nicht erforderlich.</p>
        `,
        actionHtml:
          '<a href="{statusLink}" style="display:inline-block;background:#003762;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;">Ticketstatus einsehen</a>',
        noteHtml: 'Direktlink: <span style="word-break:break-all;">{statusLink}</span>',
      });
    case 'workflow-mayor-involvement-approval':
      return buildDefaultEmailShell({
        title: 'Ortsbuergermeister-Entscheidung erforderlich',
        lead: 'Guten Tag {recipientName},',
        bodyHtml: `
          <p>fuer das folgende Anliegen benoetigt der Workflow eine Rueckmeldung aus der Ortsgemeindeebene, bevor der Prozess fortgesetzt oder beendet wird.</p>
          <div style="background:#f1f6fb;border:1px solid #dbe3f0;padding:14px;border-radius:10px;margin:16px 0;">
            <p style="margin:0 0 6px 0;"><strong>Ticket-ID:</strong> {ticketId}</p>
            <p style="margin:0 0 6px 0;"><strong>Kategorie:</strong> {category}</p>
            <p style="margin:0 0 6px 0;"><strong>Ort:</strong> {location}</p>
            <p style="margin:0 0 6px 0;"><strong>Zustaendigkeit:</strong> {mayorLocationType} {mayorLocationValue}</p>
            <p style="margin:0 0 6px 0;"><strong>Workflow:</strong> {workflowTitle}</p>
            <p style="margin:0;"><strong>Schritt:</strong> {workflowStepTitle}</p>
          </div>
          <p style="margin:0 0 10px 0;"><strong>Meldende Person:</strong> {citizenName} ({citizenEmail})</p>
          <p style="margin:0 0 10px 0;"><strong>Kurzbeschreibung:</strong><br>{description}</p>
          <div style="background:#fff7e6;border:1px solid #f5d081;padding:14px;border-radius:10px;margin:16px 0;">
            <p style="margin:0 0 6px 0;"><strong>Entscheidungsfrage:</strong></p>
            <p style="margin:0;white-space:pre-wrap;">{approvalInstruction}</p>
          </div>
        `,
        actionHtml:
          '<a href="{decisionPageLink}" style="display:inline-block;background:#003762;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;margin-right:8px;">Entscheidungsseite oeffnen</a><a href="{approveLink}" style="display:inline-block;background:#31932e;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;margin-right:8px;">Weiterbearbeitung zulassen</a><a href="{rejectLink}" style="display:inline-block;background:#ec5840;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;margin-right:8px;">Bearbeitung ablehnen</a><a href="{statusLink}" style="display:inline-block;background:#1f4f7f;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;">Ticketstatus</a>',
        noteHtml:
          'Direktlinks:<br/>Entscheidungsseite: <span style="word-break:break-all;">{decisionPageLink}</span><br/>Zustimmen: <span style="word-break:break-all;">{approveLink}</span><br/>Ablehnen: <span style="word-break:break-all;">{rejectLink}</span><br/>Ticketstatus: <span style="word-break:break-all;">{statusLink}</span>',
      });
    default:
      return buildDefaultEmailShell({
        title: 'Benachrichtigung',
        lead: 'Guten Tag,',
        bodyHtml: '<p>dies ist eine Standardvorlage für Systembenachrichtigungen.</p>',
      });
  }
}

function buildDefaultText(templateId: string): string {
  switch (templateId) {
    case 'submission-confirmation':
      return `Guten Tag {citizenName},

Ihre E-Mail-Adresse wurde erfolgreich bestätigt.
Ihre Meldung ist nun bei uns eingegangen und befindet sich in Bearbeitung.

Ticket-ID: {ticketId}
Bearbeitungsstatus: {statusLink}

Sie erhalten automatische Benachrichtigungen, sobald sich der Status Ihrer Meldung ändert.
Abbestellen: {unsubscribeLink}`;
    case 'validation-email':
      return `Guten Tag {citizenName},

vielen Dank für Ihre Meldung. Bitte bestätigen Sie Ihre E-Mail-Adresse über folgenden Link:

Bestätigungslink: {validationLink}
Ticketstatus: {statusLink}

Erst nach der Bestätigung können wir Ihre Meldung bearbeiten.
Sollten Sie keine E-Mail erwartet haben oder diese Anfrage nicht von Ihnen stammen, können Sie diese Nachricht ignorieren.`;
    case 'status-change':
      return `Guten Tag {citizenName},

der Bearbeitungsstand Ihres Tickets {ticketId} wurde aktualisiert.
Vorher: {oldStatus}
Neu: {newStatus}
Hinweis: {statusMessage}

Statusseite: {statusLink}
Abbestellen: {unsubscribeLink}`;
    case 'citizen-workflow-notification':
      return `Guten Tag {citizenName},

zu Ihrer Meldung {ticketId} gibt es eine neue Information.
Kategorie: {category}
Ort: {location}

{customMessage}

Bestätigen: {validationLink}
Status: {statusLink}`;
    case 'external-notification':
      return `Guten Tag {recipientName},

über behebes.AI wurde eine neue Meldung für Ihre Zuständigkeit erfasst.

Ticket-ID: {ticketId}
Kategorie: {category}
Ort: {location}
Meldende Person: {citizenName} ({citizenEmail})

Beschreibung:
{description}`;
    case 'workflow-confirmation':
      return `Guten Tag {recipientName},

bitte entscheiden Sie über den nächsten Workflow-Schritt für Ticket {ticketId}.
Workflow: {workflowTitle}
Schritt: {workflowStepTitle}
Kategorie: {category}
Ort: {location}
Meldende Person: {citizenName} ({citizenEmail})

Anweisung:
{approvalInstruction}

Entscheidungsseite: {decisionPageLink}
Zustimmen: {approveLink}
Ablehnen: {rejectLink}
Ticketstatus: {statusLink}`;
    case 'workflow-mayor-involvement-notify':
      return `Guten Tag {recipientName},

im Rahmen unseres digitalen Verwaltungsworkflows moechten wir Sie fruehzeitig ueber ein Anliegen aus Ihrem Zustaendigkeitsbereich informieren.

Ticket-ID: {ticketId}
Kategorie: {category}
Ort: {location}
Zustaendigkeit: {mayorLocationType} {mayorLocationValue}
Workflow: {workflowTitle}
Schritt: {workflowStepTitle}
Meldende Person: {citizenName} ({citizenEmail})

Kurzbeschreibung:
{description}

Diese Information dient Ihrer transparenten Einbindung. Eine aktive Entscheidung ist in diesem Workflow-Schritt nicht erforderlich.

Ticketstatus: {statusLink}`;
    case 'workflow-mayor-involvement-approval':
      return `Guten Tag {recipientName},

fuer das folgende Anliegen benoetigt der Workflow eine Rueckmeldung aus der Ortsgemeindeebene.

Ticket-ID: {ticketId}
Kategorie: {category}
Ort: {location}
Zustaendigkeit: {mayorLocationType} {mayorLocationValue}
Workflow: {workflowTitle}
Schritt: {workflowStepTitle}
Meldende Person: {citizenName} ({citizenEmail})

Kurzbeschreibung:
{description}

Entscheidungsfrage:
{approvalInstruction}

Entscheidungsseite: {decisionPageLink}
Weiterbearbeitung zulassen: {approveLink}
Bearbeitung ablehnen: {rejectLink}
Ticketstatus: {statusLink}`;
    default:
      return 'Systembenachrichtigung';
  }
}

function resolveLibraryScope(req: Request): { scope: 'platform' | 'tenant'; tenantId: string } {
  const contextMode = String(req.header('x-admin-context-mode') || '').trim().toLowerCase();
  const contextTenantId = String(req.header('x-admin-context-tenant-id') || '').trim();
  const rawScope = String(
    req.query?.scope ||
      req.body?.scope ||
      (contextMode === 'tenant' ? 'tenant' : contextMode === 'global' ? 'platform' : '')
  )
    .trim()
    .toLowerCase();
  const tenantId = String(
    req.query?.tenantId ||
      req.query?.tenant_id ||
      req.body?.tenantId ||
      req.body?.tenant_id ||
      contextTenantId
  ).trim();
  if (rawScope === 'tenant' && tenantId) {
    return { scope: 'tenant', tenantId };
  }
  return { scope: 'platform', tenantId: '' };
}

async function ensureTemplateLibraryScopeAccess(
  req: Request,
  selection: { scope: 'platform' | 'tenant'; tenantId: string }
): Promise<void> {
  const userId = String((req as any).userId || '').trim();
  const role = String((req as any).role || '').trim();
  const access = await loadAdminAccessContext(userId, role);

  if (selection.scope === 'platform') {
    if (!access.isGlobalAdmin) {
      const error = new Error('Plattform-Templates können nur von Plattform-Admins bearbeitet werden.');
      (error as any).status = 403;
      throw error;
    }
    return;
  }

  if (!selection.tenantId) {
    const error = new Error('tenantId ist für tenant scope erforderlich.');
    (error as any).status = 400;
    throw error;
  }

  if (access.isGlobalAdmin) return;
  if (!access.tenantIds.includes(selection.tenantId)) {
    const error = new Error('Kein Zugriff auf die Template-Bibliothek dieses Mandanten.');
    (error as any).status = 403;
    throw error;
  }
}

async function ensureTemplateDefaultsInLibrary(scope: 'platform' | 'tenant', tenantId: string): Promise<void> {
  const existing = await listEmailTemplates({
    scope,
    tenantId,
    includeInherited: false,
  });
  const templatesById = new Map<string, any>();
  for (const entry of existing || []) {
    if (!entry?.id) continue;
    templatesById.set(String(entry.id), entry);
  }

  for (const sysTemplate of DEFAULT_SYSTEM_TEMPLATES) {
    const current = templatesById.get(sysTemplate.id) || {};
    const currentPlaceholders = Array.isArray(current.placeholders) ? current.placeholders : [];
    const mergedPlaceholders = Array.from(new Set([...sysTemplate.placeholders, ...currentPlaceholders]));
    const subject =
      (typeof current.subject === 'string' && current.subject.trim()) || sysTemplate.subject || 'Benachrichtigung';
    const htmlContent = ensureUnifiedEmailTemplateHtml(
      stripTemplateLocalSignatureHtml(String(current.htmlContent || buildDefaultHtml(sysTemplate.id))),
      subject
    );
    const payload = {
      ...sysTemplate,
      ...current,
      id: sysTemplate.id,
      name: (typeof current.name === 'string' && current.name.trim()) || sysTemplate.name || sysTemplate.id,
      subject,
      placeholders: mergedPlaceholders,
      editable: true,
      htmlContent,
      textContent:
        stripTemplateLocalSignatureText(
          String(current.textContent || htmlToPlainText(htmlContent))
        ) || buildDefaultText(sysTemplate.id),
      lifecycle: normalizeLifecycle(current.lifecycle || sysTemplate.lifecycle),
      groupPath: deriveTemplateGroupPath(current.id ? current : sysTemplate),
      tags: deriveTemplateTags(current.id ? current : sysTemplate),
      createdAt: current.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await upsertEmailTemplate(payload, { scope, tenantId });
  }

  const categoriesWithExternalEmail = await loadCategoriesWithExternalEmail();
  for (const category of categoriesWithExternalEmail) {
    const templateId = `${CATEGORY_TEMPLATE_PREFIX}${category.id}`;
    const defaultExternalName = `Weiterleitung: ${category.name}`;
    const defaultExternalSubject = `Neue Bürgermeldung: ${category.name}`;
    const current = templatesById.get(templateId) || {};
    const currentExternalPlaceholders = Array.isArray(current.placeholders) ? current.placeholders : [];
    const mergedExternalPlaceholders = Array.from(
      new Set([...DEFAULT_EXTERNAL_PLACEHOLDERS, ...currentExternalPlaceholders])
    );
    const subject =
      (typeof current.subject === 'string' && current.subject.trim()) || defaultExternalSubject;
    const htmlContent = ensureUnifiedEmailTemplateHtml(
      stripTemplateLocalSignatureHtml(String(current.htmlContent || buildDefaultHtml('external-notification'))),
      subject
    );
    const payload = {
      ...current,
      id: templateId,
      name:
        (typeof current.name === 'string' && current.name.trim()) ||
        defaultExternalName,
      subject,
      placeholders: mergedExternalPlaceholders,
      editable: true,
      categoryId: category.id,
      groupPath:
        Array.isArray(current.groupPath) && current.groupPath.length > 0
          ? normalizeGroupPath(current.groupPath)
          : ['Extern', 'Weiterleitung'],
      tags:
        Array.isArray(current.tags) && current.tags.length > 0
          ? normalizeTags(current.tags)
          : ['external', 'category'],
      lifecycle: normalizeLifecycle(current.lifecycle || 'active'),
      htmlContent,
      textContent:
        stripTemplateLocalSignatureText(
          String(current.textContent || htmlToPlainText(htmlContent))
        ) || buildDefaultText('external-notification'),
      createdAt: current.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await upsertEmailTemplate(payload, { scope, tenantId });
  }
}

// Load templates index (ensures system + category templates exist in DB library)
async function loadTemplatesIndex(options?: { scope?: 'platform' | 'tenant'; tenantId?: string }): Promise<any> {
  const scope = options?.scope === 'tenant' && options?.tenantId ? 'tenant' : 'platform';
  const tenantId = scope === 'tenant' ? String(options?.tenantId || '').trim() : '';
  await ensureTemplateDefaultsInLibrary(scope, tenantId);
  const templates = await listEmailTemplates({
    scope,
    tenantId,
    includeInherited: scope === 'tenant',
  });
  return { templates };
}

/**
 * GET /api/admin/config/templates
 * Liste aller Email-Templates
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { scope, tenantId } = resolveLibraryScope(req);
    await ensureTemplateLibraryScopeAccess(req, { scope, tenantId });
    const templates = await loadTemplatesIndex({ scope, tenantId });
    const settings = await loadTemplateSettingsPayload();
    res.json({
      templates: (templates.templates || []).map((template: any) => enrichTemplateForAdminList(template)),
      settings,
      placeholderCatalog: PLACEHOLDER_CATALOG,
    });
  } catch (error: any) {
    res.status(Number(error?.status || 500)).json({
      message: error?.message || 'Fehler beim Laden der Templates',
    });
  }
});

/**
 * GET /api/admin/config/templates/settings
 * Globale Email-Template-Einstellungen (Footer)
 */
router.get('/settings', async (req: Request, res: Response) => {
  try {
    await ensureTemplateLibraryScopeAccess(req, { scope: 'platform', tenantId: '' });
    const settings = await loadTemplateSettingsPayload();
    res.json(settings);
  } catch (error: any) {
    res.status(Number(error?.status || 500)).json({
      message: error?.message || 'Fehler beim Laden der Template-Einstellungen',
    });
  }
});

/**
 * PATCH /api/admin/config/templates/settings
 * Globale Email-Template-Einstellungen aktualisieren
 */
router.patch('/settings', async (req: Request, res: Response): Promise<any> => {
  try {
    await ensureTemplateLibraryScopeAccess(req, { scope: 'platform', tenantId: '' });
    const current = await loadTemplateSettingsPayload();
    const next = normalizeTemplateSettingsInput(req.body, current);

    if (next.footerHtml.length > 20000) {
      return res.status(400).json({ message: 'Footer-HTML ist zu lang (max. 20.000 Zeichen)' });
    }
    if (next.footerText.length > 8000) {
      return res.status(400).json({ message: 'Footer-Text ist zu lang (max. 8.000 Zeichen)' });
    }

    await setSetting('emailTemplates', next);
    return res.json(next);
  } catch (error: any) {
    console.error('Error updating template settings:', error);
    return res.status(Number(error?.status || 500)).json({
      message: error?.message || 'Fehler beim Speichern der Template-Einstellungen',
    });
  }
});

/**
 * GET /api/admin/config/templates/:templateId
 * Einzelnes Template abrufen mit Inhalt
 */
router.get('/:templateId', async (req: Request, res: Response) => {
  try {
    const { templateId } = req.params;
    const { scope, tenantId } = resolveLibraryScope(req);
    await ensureTemplateLibraryScopeAccess(req, { scope, tenantId });
    const index = await loadTemplatesIndex({ scope, tenantId });
    const templates = Array.isArray(index.templates) ? index.templates : [];
    const templateMeta = templates.find((item: any) => item.id === templateId);

    let templateContent =
      (await getEmailTemplate(templateId, {
        scope,
        tenantId,
        includeInherited: true,
      })) || null;
    if (!templateContent) {
      const fallbackTemplateId = templateId.startsWith(CATEGORY_TEMPLATE_PREFIX)
        ? 'external-notification'
        : templateId;
      templateContent = {
        id: templateId,
        subject:
          DEFAULT_SYSTEM_TEMPLATES.find((template) => template.id === templateId)?.subject ||
          'Benachrichtigung',
        htmlContent: buildDefaultHtml(fallbackTemplateId),
        textContent: buildDefaultText(fallbackTemplateId),
      };
    }

    const normalizedSubject =
      typeof templateContent?.subject === 'string' && templateContent.subject.trim()
        ? templateContent.subject.trim()
        : 'Benachrichtigung';
    templateContent.htmlContent = ensureUnifiedEmailTemplateHtml(
      stripTemplateLocalSignatureHtml(String(templateContent.htmlContent || '')),
      normalizedSubject
    );
    if (!templateContent.textContent) {
      templateContent.textContent = htmlToPlainText(templateContent.htmlContent || '');
    }
    templateContent.textContent = stripTemplateLocalSignatureText(String(templateContent.textContent || ''));

    if (templateMeta) {
      templateContent.name =
        typeof templateMeta.name === 'string' && templateMeta.name.trim()
          ? templateMeta.name.trim()
          : templateContent.name || templateId;
      templateContent.placeholders = normalizePlaceholderList(templateMeta.placeholders || []);
      templateContent.editable = templateMeta.editable !== false;
      templateContent.groupPath = deriveTemplateGroupPath(templateMeta);
      templateContent.tags = deriveTemplateTags(templateMeta);
      templateContent.lifecycle = normalizeLifecycle(templateMeta.lifecycle);
      templateContent.ownerTeam =
        typeof templateMeta.ownerTeam === 'string' && templateMeta.ownerTeam.trim()
          ? templateMeta.ownerTeam.trim()
          : '';
      templateContent.maintainer =
        typeof templateMeta.maintainer === 'string' && templateMeta.maintainer.trim()
          ? templateMeta.maintainer.trim()
          : '';
      templateContent.lastReviewedAt =
        typeof templateMeta.lastReviewedAt === 'string' && templateMeta.lastReviewedAt.trim()
          ? templateMeta.lastReviewedAt
          : null;
    }

    res.json(templateContent);
  } catch (error: any) {
    res.status(Number(error?.status || 500)).json({
      message: error?.message || 'Fehler beim Laden des Templates',
    });
  }
});

/**
 * PATCH /api/admin/config/templates/:templateId
 * Template aktualisieren
 */
router.patch('/:templateId', async (req: Request, res: Response): Promise<any> => {
  try {
    const { templateId } = req.params;
    const { scope, tenantId } = resolveLibraryScope(req);
    await ensureTemplateLibraryScopeAccess(req, { scope, tenantId });
    const { subject, htmlContent, textContent, name } = req.body;
    const groupPath = normalizeGroupPath(req.body?.groupPath);
    const tags = normalizeTags(req.body?.tags);
    const lifecycle = normalizeLifecycle(req.body?.lifecycle);
    const ownerTeam =
      typeof req.body?.ownerTeam === 'string' && req.body.ownerTeam.trim()
        ? req.body.ownerTeam.trim()
        : '';
    const maintainer =
      typeof req.body?.maintainer === 'string' && req.body.maintainer.trim()
        ? req.body.maintainer.trim()
        : '';
    const lastReviewedAt =
      typeof req.body?.lastReviewedAt === 'string' && req.body.lastReviewedAt.trim()
        ? req.body.lastReviewedAt
        : null;

    if (!subject || !htmlContent) {
      return res.status(400).json({ message: 'subject und htmlContent erforderlich' });
    }

    const cleanedHtmlContent = ensureUnifiedEmailTemplateHtml(
      stripTemplateLocalSignatureHtml(String(htmlContent)),
      String(subject)
    );
    const cleanedTextContent = stripTemplateLocalSignatureText(
      typeof textContent === 'string' && textContent.trim()
        ? textContent.trim()
        : htmlToPlainText(cleanedHtmlContent)
    );

    const index = await loadTemplatesIndex({ scope, tenantId });
    const templates = Array.isArray(index.templates) ? index.templates : [];
    const templateMeta = templates.find((item: any) => item.id === templateId);
    const placeholdersProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'placeholders');
    const selectedPlaceholders = placeholdersProvided
      ? normalizePlaceholderList(req.body?.placeholders)
      : normalizePlaceholderList(templateMeta?.placeholders || []);
    const requiredPlaceholders = selectedPlaceholders;
    const missingPlaceholders = findMissingPlaceholders(String(subject), cleanedHtmlContent, requiredPlaceholders);
    if (missingPlaceholders.length > 0) {
      return res.status(400).json({
        message: `Pflicht-Platzhalter fehlen: ${missingPlaceholders.join(', ')}`,
        missingPlaceholders,
      });
    }

    const templateData = {
      id: templateId,
      name:
        typeof name === 'string' && name.trim().length > 0
          ? name.trim()
          : templateMeta?.name || templateId,
      subject,
      htmlContent: cleanedHtmlContent,
      textContent: cleanedTextContent,
      placeholders: selectedPlaceholders,
      editable: templateMeta?.editable !== false,
      groupPath: groupPath.length > 0 ? groupPath : deriveTemplateGroupPath(templateMeta || { id: templateId }),
      tags: tags.length > 0 ? tags : deriveTemplateTags(templateMeta || { id: templateId }),
      lifecycle,
      ownerTeam,
      maintainer,
      lastReviewedAt,
      updatedAt: new Date().toISOString()
    };

    await upsertEmailTemplate(templateData, { scope, tenantId });

    return res.json(templateData);
  } catch (error: any) {
    console.error('Error updating template:', error);
    return res.status(Number(error?.status || 500)).json({
      message: error?.message || 'Fehler beim Aktualisieren des Templates',
    });
  }
});

/**
 * GET /api/admin/config/templates/:templateId/preview
 * Template mit Beispiel-Variablen vorschau
 */
router.get('/:templateId/preview', async (req: Request, res: Response): Promise<any> => {
  try {
    const { templateId } = req.params;
    const { scope, tenantId } = resolveLibraryScope(req);
    await ensureTemplateLibraryScopeAccess(req, { scope, tenantId });
    const template = await getEmailTemplate(templateId, {
      scope,
      tenantId,
      includeInherited: true,
    });
    if (!template) {
      return res.status(404).json({ message: 'Template nicht gefunden' });
    }

    template.htmlContent = ensureUnifiedEmailTemplateHtml(
      stripTemplateLocalSignatureHtml(String(template.htmlContent || '')),
      String(template.subject || '')
    );
    template.textContent = stripTemplateLocalSignatureText(
      String(template.textContent || htmlToPlainText(template.htmlContent || ''))
    );

    const preview = replacePreviewPlaceholders(template.htmlContent || '');
    const previewTextRaw = replacePreviewPlaceholders(
      template.textContent || htmlToPlainText(template.htmlContent || '')
    );

    const settings = await loadTemplateSettingsPayload();
    const previewWithFooter = appendFooterToPreviewHtml(preview, settings);
    const previewText = appendFooterToPreviewText(previewTextRaw, settings);
    const previewSubject = replacePreviewPlaceholders(template.subject || '');

    return res.json({
      id: templateId,
      subject: previewSubject,
      preview: previewWithFooter,
      previewText,
    });
  } catch (error: any) {
    return res.status(Number(error?.status || 500)).json({
      message: error?.message || 'Fehler beim Vorschau-Rendering',
    });
  }
});

/**
 * POST /api/admin/config/templates
 * Erstelle ein neues Template
 */
router.post('/', async (req: Request, res: Response): Promise<any> => {
  try {
    const { scope, tenantId } = resolveLibraryScope(req);
    await ensureTemplateLibraryScopeAccess(req, { scope, tenantId });
    const { id, name, subject, htmlContent, textContent } = req.body;
    const groupPath = normalizeGroupPath(req.body?.groupPath);
    const tags = normalizeTags(req.body?.tags);
    const lifecycle = normalizeLifecycle(req.body?.lifecycle);
    const ownerTeam =
      typeof req.body?.ownerTeam === 'string' && req.body.ownerTeam.trim()
        ? req.body.ownerTeam.trim()
        : '';
    const maintainer =
      typeof req.body?.maintainer === 'string' && req.body.maintainer.trim()
        ? req.body.maintainer.trim()
        : '';
    const lastReviewedAt =
      typeof req.body?.lastReviewedAt === 'string' && req.body.lastReviewedAt.trim()
        ? req.body.lastReviewedAt
        : null;
    const normalizedId = normalizeTemplateId(id);
    const placeholdersProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'placeholders');
    const placeholders = placeholdersProvided
      ? normalizePlaceholderList(req.body?.placeholders)
      : [];

    if (!normalizedId || !subject || !htmlContent) {
      return res.status(400).json({ message: 'id, subject und htmlContent erforderlich' });
    }

    const cleanedHtmlContent = ensureUnifiedEmailTemplateHtml(
      stripTemplateLocalSignatureHtml(String(htmlContent)),
      String(subject)
    );
    const cleanedTextContent = stripTemplateLocalSignatureText(
      typeof textContent === 'string' && textContent.trim()
        ? textContent.trim()
        : htmlToPlainText(cleanedHtmlContent)
    );

    const missingPlaceholders = findMissingPlaceholders(String(subject), cleanedHtmlContent, placeholders);
    if (missingPlaceholders.length > 0) {
      return res.status(400).json({
        message: `Pflicht-Platzhalter fehlen: ${missingPlaceholders.join(', ')}`,
        missingPlaceholders,
      });
    }

    const existingTemplate = await getEmailTemplate(normalizedId, {
      scope,
      tenantId,
      includeInherited: false,
    });
    const templateData = {
      id: normalizedId,
      name: (typeof name === 'string' && name.trim()) || existingTemplate?.name || normalizedId,
      subject,
      htmlContent: cleanedHtmlContent,
      textContent: cleanedTextContent,
      placeholders,
      editable: existingTemplate?.editable !== false,
      groupPath:
        groupPath.length > 0
          ? groupPath
          : deriveTemplateGroupPath(existingTemplate || { id: normalizedId }),
      tags: tags.length > 0 ? tags : deriveTemplateTags(existingTemplate || { id: normalizedId }),
      lifecycle,
      ownerTeam,
      maintainer,
      lastReviewedAt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await upsertEmailTemplate(templateData, { scope, tenantId });

    return res.json(templateData);
  } catch (error: any) {
    console.error('Error creating template:', error);
    return res.status(Number(error?.status || 500)).json({
      message: error?.message || 'Fehler beim Erstellen des Templates',
    });
  }
});

export { generateRouter };
export default router;
