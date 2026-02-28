/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 */

const LAYOUT_START_MARKER = '<!--BEHEBES_EMAIL_LAYOUT_START-->';
const LAYOUT_END_MARKER = '<!--BEHEBES_EMAIL_LAYOUT_END-->';
const LAYOUT_BODY_START_MARKER = '<!--BEHEBES_EMAIL_LAYOUT_BODY_START-->';
const LAYOUT_BODY_END_MARKER = '<!--BEHEBES_EMAIL_LAYOUT_BODY_END-->';

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripOuterDocumentWrappers(rawHtml: string): string {
  const source = String(rawHtml || '').trim();
  if (!source) return '';

  return source
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<html[^>]*>/gi, '')
    .replace(/<\/html>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<body[^>]*>/gi, '')
    .replace(/<\/body>/gi, '')
    .trim();
}

function extractManagedBodyHtml(rawHtml: string): string {
  const source = String(rawHtml || '');
  const start = source.indexOf(LAYOUT_BODY_START_MARKER);
  const end = source.indexOf(LAYOUT_BODY_END_MARKER);
  if (start < 0 || end < 0 || end <= start) return '';

  return source
    .slice(start + LAYOUT_BODY_START_MARKER.length, end)
    .trim();
}

function extractLegacyCardBodyHtml(rawHtml: string): string {
  const source = String(rawHtml || '').trim();
  if (!source) return '';

  const legacyCardMatch = source.match(
    /<div[^>]*max-width\s*:\s*700px[^>]*>[\s\S]*?<div[^>]*background\s*:\s*linear-gradient[\s\S]*?<\/div>\s*<div[^>]*border\s*:\s*1px[^>]*>([\s\S]*)<\/div>\s*<\/div>\s*$/i
  );

  if (!legacyCardMatch?.[1]) return '';
  return legacyCardMatch[1].trim();
}

function findTitleInHtml(rawHtml: string): string {
  const source = String(rawHtml || '');
  if (!source.trim()) return '';

  const managedTitleMatch = source.match(
    /<p[^>]*font-size\s*:\s*19px[^>]*>([\s\S]*?)<\/p>/i
  );
  if (managedTitleMatch?.[1]) {
    const stripped = stripOuterDocumentWrappers(managedTitleMatch[1]).replace(/<[^>]*>/g, '').trim();
    if (stripped) return stripped;
  }

  const headerMatch = source.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
  if (headerMatch?.[1]) {
    const stripped = stripOuterDocumentWrappers(headerMatch[1]).replace(/<[^>]*>/g, '').trim();
    if (stripped) return stripped;
  }

  return '';
}

function cleanupBodyHtml(bodyHtml: string): string {
  let normalized = String(bodyHtml || '').trim();
  if (!normalized) return '';

  normalized = normalized
    .replace(/^<\s*\/??\s*br\s*\/?>\s*/i, '')
    .replace(/\s*<\s*br\s*\/?>\s*$/i, '')
    .trim();

  return normalized;
}

export function extractUnifiedLayoutBodyHtml(rawHtml: string): string {
  const managed = extractManagedBodyHtml(rawHtml);
  if (managed) return cleanupBodyHtml(managed);

  const legacy = extractLegacyCardBodyHtml(rawHtml);
  if (legacy) return cleanupBodyHtml(legacy);

  const stripped = stripOuterDocumentWrappers(rawHtml);
  return cleanupBodyHtml(stripped);
}

export function buildUnifiedEmailLayout(title: string, bodyHtml: string): string {
  const safeTitle = escapeHtml(String(title || '').trim() || 'Benachrichtigung');
  const content = cleanupBodyHtml(bodyHtml) || '<p>Diese Benachrichtigung enthält keinen Inhalt.</p>';

  return `${LAYOUT_START_MARKER}
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table width="500" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="padding:0 0 32px 0;">
            <p style="margin:0 0 2px 0;font-size:10px;color:#003762;letter-spacing:0.12em;text-transform:uppercase;font-family:'Segoe UI',Arial,sans-serif;">Verbandsgemeindeverwaltung</p>
            <p style="margin:0;font-size:11px;color:#8fa3b4;font-family:'Segoe UI',Arial,sans-serif;">Otterbach-Otterberg</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 0 8px 0;">
            <p style="margin:0 0 6px 0;font-size:19px;font-weight:700;color:#003762;font-family:'Segoe UI',Candara,Arial,sans-serif;">${safeTitle}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0;font-size:14px;color:#1c1c1c;line-height:1.75;font-family:'Segoe UI',Arial,sans-serif;">
${LAYOUT_BODY_START_MARKER}
${content}
${LAYOUT_BODY_END_MARKER}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
${LAYOUT_END_MARKER}`;
}

export function ensureUnifiedEmailTemplateHtml(rawHtml: string, subjectFallback: string): string {
  const title =
    findTitleInHtml(rawHtml) ||
    String(subjectFallback || '').trim() ||
    'Benachrichtigung';

  const bodyHtml = extractUnifiedLayoutBodyHtml(rawHtml);
  return buildUnifiedEmailLayout(title, bodyHtml);
}
