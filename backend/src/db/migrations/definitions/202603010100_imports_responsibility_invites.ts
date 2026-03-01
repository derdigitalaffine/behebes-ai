import type { MigrationDefinition } from '../types.js';
import {
  migrationAddColumnIfMissing,
  migrationCreateIndexIfNotExists,
  migrationTableExists,
} from '../helpers.js';

export const migration202603010100ImportsResponsibilityInvites: MigrationDefinition = {
  version: '202603010100',
  name: 'create_imports_responsibility_invites',
  checksumSource: '202603010100:create_imports_responsibility_invites:v1',
  up: async (db) => {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS import_jobs (
        id VARCHAR(80) NOT NULL PRIMARY KEY,
        tenant_id TEXT,
        kind VARCHAR(64) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'draft',
        created_by_admin_id TEXT,
        file_id VARCHAR(80),
        options_json TEXT,
        mapping_json TEXT,
        preview_json TEXT,
        report_json TEXT,
        processed_rows INTEGER NOT NULL DEFAULT 0,
        total_rows INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        started_at DATETIME,
        finished_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS import_job_files (
        id VARCHAR(80) NOT NULL PRIMARY KEY,
        job_id VARCHAR(80) NOT NULL,
        original_name TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        mime_type VARCHAR(191),
        byte_size INTEGER NOT NULL DEFAULT 0,
        encoding VARCHAR(64),
        delimiter VARCHAR(8),
        row_count INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        deleted_at DATETIME
      )
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS import_job_conflicts (
        id VARCHAR(80) NOT NULL PRIMARY KEY,
        job_id VARCHAR(80) NOT NULL,
        row_index INTEGER NOT NULL,
        entity_kind VARCHAR(64) NOT NULL,
        external_key TEXT,
        reason TEXT NOT NULL,
        payload_json TEXT,
        resolution_json TEXT,
        status VARCHAR(32) NOT NULL DEFAULT 'open',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS import_job_events (
        id VARCHAR(80) NOT NULL PRIMARY KEY,
        job_id VARCHAR(80) NOT NULL,
        event_type VARCHAR(64) NOT NULL,
        message TEXT,
        payload_json TEXT,
        created_by_admin_id TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS responsibility_queries (
        id VARCHAR(80) NOT NULL PRIMARY KEY,
        tenant_id TEXT,
        created_by_admin_id TEXT,
        mode VARCHAR(32) NOT NULL DEFAULT 'query',
        query_text TEXT NOT NULL,
        context_json TEXT,
        result_json TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS user_invites (
        id VARCHAR(80) NOT NULL PRIMARY KEY,
        admin_user_id TEXT NOT NULL,
        invite_token VARCHAR(191) NOT NULL UNIQUE,
        expires_at DATETIME NOT NULL,
        sent_at DATETIME,
        sent_by_admin_id TEXT,
        accepted_at DATETIME,
        revoked_at DATETIME,
        metadata_json TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await migrationAddColumnIfMissing({
      db,
      tableName: 'admin_users',
      columnName: 'profile_data_json',
      columnDefinition: 'TEXT',
    });
    await migrationAddColumnIfMissing({
      db,
      tableName: 'admin_users',
      columnName: 'external_person_id',
      columnDefinition: 'VARCHAR(191)',
    });

    await migrationAddColumnIfMissing({
      db,
      tableName: 'workflow_internal_tasks',
      columnName: 'allow_reject',
      columnDefinition: 'BOOLEAN DEFAULT 1',
    });
    await migrationAddColumnIfMissing({
      db,
      tableName: 'workflow_internal_tasks',
      columnName: 'cycle_index',
      columnDefinition: 'INTEGER DEFAULT 1',
    });
    await migrationAddColumnIfMissing({
      db,
      tableName: 'workflow_internal_tasks',
      columnName: 'max_cycles',
      columnDefinition: 'INTEGER DEFAULT 1',
    });
    await migrationAddColumnIfMissing({
      db,
      tableName: 'workflow_internal_tasks',
      columnName: 'assignment_update_mode',
      columnDefinition: 'VARCHAR(64)',
    });
    await migrationAddColumnIfMissing({
      db,
      tableName: 'workflow_internal_tasks',
      columnName: 'assignment_source',
      columnDefinition: 'VARCHAR(64)',
    });

    const hasOrgUnits = await migrationTableExists(db, 'org_units');
    if (hasOrgUnits) {
      await migrationAddColumnIfMissing({
        db,
        tableName: 'org_units',
        columnName: 'external_ref',
        columnDefinition: 'VARCHAR(191)',
      });
    }

    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'import_jobs',
      indexName: 'idx_import_jobs_status_created',
      columns: ['status', 'created_at'],
    });
    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'import_jobs',
      indexName: 'idx_import_jobs_tenant_kind',
      columns: ['tenant_id', 'kind', 'created_at'],
    });
    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'import_job_files',
      indexName: 'idx_import_job_files_job',
      columns: ['job_id', 'created_at'],
    });
    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'import_job_conflicts',
      indexName: 'idx_import_job_conflicts_job_status',
      columns: ['job_id', 'status', 'row_index'],
    });
    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'import_job_events',
      indexName: 'idx_import_job_events_job_created',
      columns: ['job_id', 'created_at'],
    });
    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'responsibility_queries',
      indexName: 'idx_responsibility_queries_tenant_created',
      columns: ['tenant_id', 'created_at'],
    });
    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'user_invites',
      indexName: 'idx_user_invites_admin_created',
      columns: ['admin_user_id', 'created_at'],
    });
    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'admin_users',
      indexName: 'idx_admin_users_external_person_id',
      columns: ['external_person_id'],
    });
    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'org_units',
      indexName: 'idx_org_units_external_ref',
      columns: ['external_ref'],
    });
  },
};

