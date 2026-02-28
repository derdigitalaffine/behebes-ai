import type { SmartTablePrintOrientation } from './types';

export interface SmartTablePrintColumn {
  field: string;
  header: string;
  align?: 'left' | 'center' | 'right';
}

export interface SmartTablePrintPayload {
  title?: string;
  subtitle?: string;
  orientation: SmartTablePrintOrientation;
  columns: SmartTablePrintColumn[];
  rows: Array<Record<string, string>>;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatTimestamp(value: Date): string {
  return value.toLocaleString('de-DE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function printSmartTableA4(payload: SmartTablePrintPayload): void {
  const printWindow = window.open('', '_blank', 'width=1260,height=900');
  if (!printWindow) {
    throw new Error('Das Druckfenster konnte nicht geöffnet werden. Bitte Pop-up-Blocker prüfen.');
  }

  const createdAt = formatTimestamp(new Date());
  const orientationLabel = payload.orientation === 'landscape' ? 'Querformat' : 'Hochformat';
  const headersHtml = payload.columns
    .map((column) => `<th class="align-${column.align || 'left'}">${escapeHtml(column.header)}</th>`)
    .join('');
  const rowsHtml =
    payload.rows.length > 0
      ? payload.rows
          .map((row) => {
            const cells = payload.columns
              .map((column) => `<td class="align-${column.align || 'left'}">${escapeHtml(String(row[column.field] || ''))}</td>`)
              .join('');
            return `<tr>${cells}</tr>`;
          })
          .join('')
      : `<tr><td colspan="${Math.max(payload.columns.length, 1)}" class="empty-row">Keine Daten</td></tr>`;

  const html = `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(payload.title || 'Tabellen-Druck')}</title>
    <style>
      @page {
        size: A4 ${payload.orientation};
        margin: 11mm;
      }
      * {
        box-sizing: border-box;
      }
      html, body {
        margin: 0;
        padding: 0;
        color: #0f172a;
        font-family: "IBM Plex Sans", "Segoe UI", Arial, sans-serif;
        font-size: 11px;
      }
      .print-page {
        width: 100%;
      }
      .print-head {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
      }
      .print-title {
        margin: 0;
        font-size: 16px;
        line-height: 1.25;
      }
      .print-subtitle {
        margin: 4px 0 0 0;
        color: #334155;
        font-size: 10px;
      }
      .print-meta {
        text-align: right;
        color: #475569;
        font-size: 10px;
        white-space: nowrap;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        border: 1px solid #cbd5e1;
        padding: 6px 7px;
        vertical-align: top;
        line-height: 1.35;
        word-break: break-word;
        overflow-wrap: anywhere;
      }
      th {
        background: #e2e8f0;
        color: #0f172a;
        font-weight: 700;
      }
      tbody tr:nth-child(even) td {
        background: #f8fafc;
      }
      .align-left {
        text-align: left;
      }
      .align-center {
        text-align: center;
      }
      .align-right {
        text-align: right;
      }
      .empty-row {
        text-align: center;
        color: #475569;
        font-style: italic;
      }
    </style>
  </head>
  <body>
    <main class="print-page">
      <header class="print-head">
        <div>
          <h1 class="print-title">${escapeHtml(payload.title || 'Tabellenansicht')}</h1>
          ${payload.subtitle ? `<p class="print-subtitle">${escapeHtml(payload.subtitle)}</p>` : ''}
        </div>
        <div class="print-meta">
          DIN A4 ${orientationLabel}<br />
          Erstellt: ${escapeHtml(createdAt)}
        </div>
      </header>
      <table>
        <thead>
          <tr>${headersHtml}</tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </main>
  </body>
</html>`;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();

  const runPrint = () => {
    try {
      printWindow.print();
    } finally {
      printWindow.close();
    }
  };

  if (printWindow.document.readyState === 'complete') {
    setTimeout(runPrint, 80);
  } else {
    printWindow.addEventListener('load', () => {
      setTimeout(runPrint, 80);
    });
  }
}
