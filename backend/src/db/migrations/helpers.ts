import type { AppDatabase } from '../../db-adapter.js';

function quoteIdentifier(dialect: 'sqlite' | 'mysql', value: string): string {
  const normalized = String(value || '').trim();
  if (dialect === 'mysql') {
    return `\`${normalized.replace(/`/g, '')}\``;
  }
  return `"${normalized.replace(/"/g, '""')}"`;
}

export async function migrationTableExists(db: AppDatabase, tableName: string): Promise<boolean> {
  const normalized = String(tableName || '').trim();
  if (!normalized) return false;

  if (db.dialect === 'mysql') {
    const row = await db.get(
      `SELECT COUNT(*) AS count
       FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name = ?`,
      [normalized]
    );
    return Number(row?.count || 0) > 0;
  }

  const row = await db.get(
    `SELECT COUNT(*) AS count
     FROM sqlite_master
     WHERE type = 'table'
       AND name = ?`,
    [normalized]
  );
  return Number(row?.count || 0) > 0;
}

export async function migrationIndexExists(db: AppDatabase, indexName: string): Promise<boolean> {
  const normalized = String(indexName || '').trim();
  if (!normalized) return false;

  if (db.dialect === 'mysql') {
    const row = await db.get(
      `SELECT COUNT(*) AS count
       FROM information_schema.statistics
       WHERE table_schema = DATABASE()
         AND index_name = ?`,
      [normalized]
    );
    return Number(row?.count || 0) > 0;
  }

  const row = await db.get(
    `SELECT COUNT(*) AS count
     FROM sqlite_master
     WHERE type = 'index'
       AND name = ?`,
    [normalized]
  );
  return Number(row?.count || 0) > 0;
}

export async function migrationColumnExists(
  db: AppDatabase,
  tableName: string,
  columnName: string
): Promise<boolean> {
  const normalizedTable = String(tableName || '').trim();
  const normalizedColumn = String(columnName || '').trim();
  if (!normalizedTable || !normalizedColumn) return false;

  const tableExists = await migrationTableExists(db, normalizedTable);
  if (!tableExists) return false;

  if (db.dialect === 'mysql') {
    const row = await db.get(
      `SELECT COUNT(*) AS count
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = ?
         AND column_name = ?`,
      [normalizedTable, normalizedColumn]
    );
    return Number(row?.count || 0) > 0;
  }

  const rows = await db.all(`PRAGMA table_info(${quoteIdentifier(db.dialect, normalizedTable)})`);
  return (rows || []).some((row: any) => String(row?.name || '').trim() === normalizedColumn);
}

export async function migrationAddColumnIfMissing(input: {
  db: AppDatabase;
  tableName: string;
  columnName: string;
  columnDefinition: string;
}): Promise<void> {
  const tableName = String(input.tableName || '').trim();
  const columnName = String(input.columnName || '').trim();
  const columnDefinition = String(input.columnDefinition || '').trim();
  if (!tableName || !columnName || !columnDefinition) {
    throw new Error('migrationAddColumnIfMissing: table/column/definition erforderlich');
  }

  const exists = await migrationColumnExists(input.db, tableName, columnName);
  if (exists) return;

  const quotedTable = quoteIdentifier(input.db.dialect, tableName);
  const quotedColumn = quoteIdentifier(input.db.dialect, columnName);
  await input.db.exec(`ALTER TABLE ${quotedTable} ADD COLUMN ${quotedColumn} ${columnDefinition}`);
}

export async function migrationCreateIndexIfNotExists(input: {
  db: AppDatabase;
  tableName: string;
  indexName: string;
  columns: string[];
  unique?: boolean;
}): Promise<void> {
  const tableName = String(input.tableName || '').trim();
  const indexName = String(input.indexName || '').trim();
  const columns = Array.isArray(input.columns) ? input.columns.map((entry) => String(entry || '').trim()).filter(Boolean) : [];
  if (!tableName || !indexName || columns.length === 0) {
    throw new Error('migrationCreateIndexIfNotExists: table/index/columns sind erforderlich');
  }
  const tableExists = await migrationTableExists(input.db, tableName);
  if (!tableExists) return;
  const indexExists = await migrationIndexExists(input.db, indexName);
  if (indexExists) return;

  const uniqueKeyword = input.unique ? 'UNIQUE ' : '';
  const quotedColumns = columns.map((column) => quoteIdentifier(input.db.dialect, column)).join(', ');
  const quotedIndex = quoteIdentifier(input.db.dialect, indexName);
  const quotedTable = quoteIdentifier(input.db.dialect, tableName);
  await input.db.exec(`CREATE ${uniqueKeyword}INDEX ${quotedIndex} ON ${quotedTable} (${quotedColumns})`);
}

export async function migrationDropIndexIfExists(input: {
  db: AppDatabase;
  tableName?: string;
  indexName: string;
}): Promise<void> {
  const indexName = String(input.indexName || '').trim();
  if (!indexName) return;

  const exists = await migrationIndexExists(input.db, indexName);
  if (!exists) return;

  if (input.db.dialect === 'mysql') {
    const tableName = String(input.tableName || '').trim();
    if (!tableName) {
      throw new Error(`migrationDropIndexIfExists: tableName erforderlich für MySQL (${indexName})`);
    }
    await input.db.exec(
      `DROP INDEX ${quoteIdentifier(input.db.dialect, indexName)} ON ${quoteIdentifier(input.db.dialect, tableName)}`
    );
    return;
  }

  await input.db.exec(`DROP INDEX IF EXISTS ${quoteIdentifier(input.db.dialect, indexName)}`);
}
