import type { MigrationDefinition } from '../types.js';
import { migrationCreateIndexIfNotExists } from '../helpers.js';

export const migration202603010200KeywordingServices: MigrationDefinition = {
  version: '202603010200',
  name: 'create_keywording_and_services_tables',
  checksumSource: '202603010200:create_keywording_and_services_tables:v1',
  up: async (db) => {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS services_catalog (
        id VARCHAR(80) NOT NULL PRIMARY KEY,
        tenant_id VARCHAR(80) NOT NULL,
        external_ref VARCHAR(191),
        name VARCHAR(255) NOT NULL,
        description_html TEXT,
        publication_status VARCHAR(80),
        chatbot_relevant BOOLEAN NOT NULL DEFAULT 0,
        appointment_allowed BOOLEAN NOT NULL DEFAULT 0,
        leika_key VARCHAR(120),
        ozg_services_json TEXT,
        ozg_relevant BOOLEAN NOT NULL DEFAULT 0,
        assignment_keywords_json TEXT,
        metadata_json TEXT,
        active BOOLEAN NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    if (db.dialect === 'mysql') {
      // MySQL erlaubt keine Indexierung von TEXT ohne Prefix-Länge.
      // Für idx_services_catalog_tenant_name normalisieren wir das Feld daher auf VARCHAR.
      await db.exec(`
        ALTER TABLE services_catalog
        MODIFY COLUMN name VARCHAR(255) NOT NULL
      `);
    }

    await db.exec(`
      CREATE TABLE IF NOT EXISTS service_org_unit_links (
        id VARCHAR(80) NOT NULL PRIMARY KEY,
        service_id VARCHAR(80) NOT NULL,
        tenant_id VARCHAR(80) NOT NULL,
        org_unit_id VARCHAR(80) NOT NULL,
        source VARCHAR(40) NOT NULL DEFAULT 'manual',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS service_admin_user_links (
        id VARCHAR(80) NOT NULL PRIMARY KEY,
        service_id VARCHAR(80) NOT NULL,
        tenant_id VARCHAR(80) NOT NULL,
        admin_user_id VARCHAR(80) NOT NULL,
        source VARCHAR(40) NOT NULL DEFAULT 'manual',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS service_form_links (
        id VARCHAR(80) NOT NULL PRIMARY KEY,
        service_id VARCHAR(80) NOT NULL,
        tenant_id VARCHAR(80) NOT NULL,
        form_ref VARCHAR(191) NOT NULL,
        source VARCHAR(40) NOT NULL DEFAULT 'manual',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS keyword_inference_jobs (
        id VARCHAR(80) NOT NULL PRIMARY KEY,
        tenant_id VARCHAR(80) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'draft',
        source_scope VARCHAR(64) NOT NULL DEFAULT 'services_all',
        target_scope VARCHAR(32) NOT NULL DEFAULT 'both',
        include_existing_keywords BOOLEAN NOT NULL DEFAULT 1,
        apply_mode VARCHAR(32) NOT NULL DEFAULT 'review',
        min_suggest_confidence DECIMAL(6,4) NOT NULL DEFAULT 0.55,
        min_auto_apply_confidence DECIMAL(6,4) NOT NULL DEFAULT 0.82,
        max_keywords_per_target INTEGER NOT NULL DEFAULT 15,
        options_json TEXT,
        report_json TEXT,
        error_message TEXT,
        created_by_admin_id VARCHAR(80),
        started_at DATETIME,
        finished_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS keyword_inference_candidates (
        id VARCHAR(80) NOT NULL PRIMARY KEY,
        job_id VARCHAR(80) NOT NULL,
        tenant_id VARCHAR(80) NOT NULL,
        target_type VARCHAR(20) NOT NULL,
        target_id VARCHAR(80) NOT NULL,
        keyword_text VARCHAR(120) NOT NULL,
        canonical_keyword VARCHAR(120) NOT NULL,
        action VARCHAR(20) NOT NULL DEFAULT 'add',
        confidence DECIMAL(6,4) NOT NULL DEFAULT 0,
        reasoning TEXT,
        evidence_json TEXT,
        stage_scores_json TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'proposed',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS keyword_inference_events (
        id VARCHAR(80) NOT NULL PRIMARY KEY,
        job_id VARCHAR(80) NOT NULL,
        event_type VARCHAR(64) NOT NULL,
        message TEXT,
        payload_json TEXT,
        created_by_admin_id VARCHAR(80),
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS keyword_dictionary (
        id VARCHAR(80) NOT NULL PRIMARY KEY,
        tenant_id VARCHAR(80) NOT NULL,
        canonical_keyword VARCHAR(120) NOT NULL,
        synonyms_json TEXT,
        category VARCHAR(80),
        active BOOLEAN NOT NULL DEFAULT 1,
        notes TEXT,
        created_by_admin_id VARCHAR(80),
        updated_by_admin_id VARCHAR(80),
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS keyword_apply_audit (
        id VARCHAR(80) NOT NULL PRIMARY KEY,
        job_id VARCHAR(80) NOT NULL,
        tenant_id VARCHAR(80) NOT NULL,
        target_type VARCHAR(20) NOT NULL,
        target_id VARCHAR(80) NOT NULL,
        before_keywords_json TEXT,
        after_keywords_json TEXT,
        applied_by_admin_id VARCHAR(80),
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'services_catalog',
      indexName: 'idx_services_catalog_tenant_name',
      columns: ['tenant_id', 'name'],
    });
    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'services_catalog',
      indexName: 'idx_services_catalog_tenant_external_ref',
      columns: ['tenant_id', 'external_ref'],
    });
    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'services_catalog',
      indexName: 'idx_services_catalog_leika',
      columns: ['leika_key'],
    });
    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'services_catalog',
      indexName: 'idx_services_catalog_updated',
      columns: ['updated_at'],
    });

    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'service_org_unit_links',
      indexName: 'idx_service_org_links_service',
      columns: ['service_id', 'org_unit_id'],
    });
    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'service_admin_user_links',
      indexName: 'idx_service_user_links_service',
      columns: ['service_id', 'admin_user_id'],
    });
    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'service_form_links',
      indexName: 'idx_service_form_links_service',
      columns: ['service_id', 'form_ref'],
    });

    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'keyword_inference_jobs',
      indexName: 'idx_keyword_jobs_tenant_status_created',
      columns: ['tenant_id', 'status', 'created_at'],
    });
    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'keyword_inference_candidates',
      indexName: 'idx_keyword_candidates_job_target_conf',
      columns: ['job_id', 'target_type', 'target_id', 'confidence'],
    });
    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'keyword_inference_events',
      indexName: 'idx_keyword_events_job_created',
      columns: ['job_id', 'created_at'],
    });
    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'keyword_dictionary',
      indexName: 'idx_keyword_dictionary_tenant_keyword_active',
      columns: ['tenant_id', 'canonical_keyword', 'active'],
    });
    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'keyword_apply_audit',
      indexName: 'idx_keyword_apply_audit_job_applied',
      columns: ['job_id', 'applied_at'],
    });
  },
};
