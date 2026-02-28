/**
 * Formats date-like input to a SQL DATETIME string (UTC, second precision).
 * Output format: YYYY-MM-DD HH:mm:ss
 */
export function formatSqlDateTime(value?: Date | string): string {
  const parsed = value instanceof Date ? value : value ? new Date(value) : new Date();
  const safeDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;

  const year = safeDate.getUTCFullYear();
  const month = String(safeDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(safeDate.getUTCDate()).padStart(2, '0');
  const hours = String(safeDate.getUTCHours()).padStart(2, '0');
  const minutes = String(safeDate.getUTCMinutes()).padStart(2, '0');
  const seconds = String(safeDate.getUTCSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

