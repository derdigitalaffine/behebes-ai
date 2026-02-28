import crypto from 'crypto';
import type { AppDatabase } from '../../db-adapter.js';
import { migration202602280100CreateSystemUpdatePreflightHistory } from './definitions/202602280100_create_system_update_preflight_history.js';
import { migration202602280110AddSystemUpdateHistoryIndexes } from './definitions/202602280110_add_system_update_history_indexes.js';
import type { MigrationDefinition, MigrationExecutionResult } from './types.js';

const REGISTERED_MIGRATIONS: MigrationDefinition[] = [
  migration202602280100CreateSystemUpdatePreflightHistory,
  migration202602280110AddSystemUpdateHistoryIndexes,
];

function normalizeMigrationVersion(version: string): string {
  return String(version || '').trim();
}

function buildMigrationChecksum(definition: MigrationDefinition): string {
  const source = String(definition.checksumSource || `${definition.version}:${definition.name}`).trim();
  return crypto.createHash('sha256').update(source).digest('hex');
}

function sortMigrations(migrations: MigrationDefinition[]): MigrationDefinition[] {
  return [...migrations].sort((a, b) => normalizeMigrationVersion(a.version).localeCompare(normalizeMigrationVersion(b.version)));
}

export function getRegisteredMigrationDefinitions(): MigrationDefinition[] {
  return sortMigrations(REGISTERED_MIGRATIONS);
}

export function getRegisteredMigrationCount(): number {
  return getRegisteredMigrationDefinitions().length;
}

async function ensureSchemaMigrationsTable(db: AppDatabase): Promise<void> {
  await db.run(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(80) NOT NULL PRIMARY KEY,
      version VARCHAR(40) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      checksum VARCHAR(64) NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      success BOOLEAN NOT NULL DEFAULT 1
    )`
  );
}

async function loadAppliedMigrations(db: AppDatabase): Promise<Map<string, any>> {
  await ensureSchemaMigrationsTable(db);
  const rows = await db.all(
    `SELECT id, version, name, checksum, applied_at, duration_ms, success
     FROM schema_migrations
     ORDER BY version ASC`
  );
  const map = new Map<string, any>();
  for (const row of rows || []) {
    const version = normalizeMigrationVersion((row as any)?.version);
    if (!version) continue;
    map.set(version, row);
  }
  return map;
}

async function persistMigrationResult(
  db: AppDatabase,
  input: {
    existingId?: string | null;
    version: string;
    name: string;
    checksum: string;
    durationMs: number;
    success: boolean;
  }
): Promise<void> {
  const rowId =
    (input.existingId && String(input.existingId).trim()) ||
    `mig_${input.version}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const safeDurationMs = Math.max(0, Math.floor(Number(input.durationMs) || 0));
  const successFlag = input.success ? 1 : 0;

  const updated = await db.run(
    `UPDATE schema_migrations
     SET name = ?,
         checksum = ?,
         applied_at = CURRENT_TIMESTAMP,
         duration_ms = ?,
         success = ?
     WHERE version = ?`,
    [input.name, input.checksum, safeDurationMs, successFlag, input.version]
  );
  if (Number(updated?.changes || 0) > 0) return;

  await db.run(
    `INSERT INTO schema_migrations (id, version, name, checksum, applied_at, duration_ms, success)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`,
    [rowId, input.version, input.name, input.checksum, safeDurationMs, successFlag]
  );
}

export async function runDatabaseMigrations(db: AppDatabase): Promise<MigrationExecutionResult[]> {
  const migrations = getRegisteredMigrationDefinitions();
  const applied = await loadAppliedMigrations(db);
  const results: MigrationExecutionResult[] = [];

  for (const migration of migrations) {
    const version = normalizeMigrationVersion(migration.version);
    if (!version) {
      throw new Error(`Ungültige Migrationsversion: ${migration.version}`);
    }
    const checksum = buildMigrationChecksum(migration);
    const existing = applied.get(version);
    const existingSuccess = Number(existing?.success ?? 0) === 1;
    const existingChecksum = String(existing?.checksum || '').trim();

    if (existingSuccess) {
      if (existingChecksum && existingChecksum !== checksum) {
        throw new Error(
          `Migration ${version} (${migration.name}) hat eine Checksum-Differenz. Erwartet: ${existingChecksum}, Neu: ${checksum}`
        );
      }
      results.push({
        version,
        name: migration.name,
        checksum,
        durationMs: 0,
        success: true,
        skipped: true,
        reason: 'already_applied',
      });
      continue;
    }

    const startedAt = Date.now();
    try {
      await migration.up(db);
      const durationMs = Date.now() - startedAt;
      await persistMigrationResult(db, {
        existingId: existing?.id ? String(existing.id) : null,
        version,
        name: migration.name,
        checksum,
        durationMs,
        success: true,
      });
      results.push({
        version,
        name: migration.name,
        checksum,
        durationMs,
        success: true,
        skipped: false,
      });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      await persistMigrationResult(db, {
        existingId: existing?.id ? String(existing.id) : null,
        version,
        name: migration.name,
        checksum,
        durationMs,
        success: false,
      });
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Migration fehlgeschlagen (${version} ${migration.name}): ${message}`);
    }
  }

  return results;
}
