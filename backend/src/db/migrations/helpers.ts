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
