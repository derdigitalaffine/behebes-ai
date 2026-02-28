/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 */

import path from 'path';
import fs from 'fs';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { loadConfig, type Config } from './config.js';
import { createDatabaseAdapter, type AppDatabase } from './db-adapter.js';
import { runDatabaseMigrations } from './db/migrations/index.js';
export type { AppDatabase } from './db-adapter.js';

let db: AppDatabase | null = null;

export async function initDatabase(): Promise<AppDatabase> {
  if (db) return db;

  const config = loadConfig();
  db = await createDatabaseAdapter(config);

  // Create tables
  await createTables(db, config);
  await ensureAdminSchema(db);
  await migrateSqliteDataToMysqlIfNeeded(db, config);
  await runDatabaseMigrations(db);

  return db;
}

export function getDatabase(): AppDatabase {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

async function createTables(db: AppDatabase, config: Config) {
  const legacySchemaBootstrapEnabled = config.legacySchemaBootstrap !== false;
  // Citizens table - Bürgerdaten (PII - personenidentifizierbar)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS citizens (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      preferred_language TEXT,
      preferred_language_name TEXT,
      image_path TEXT,
      image_data BLOB,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Submissions table - Anonymisierte Meldungen mit Standortdaten
  await db.exec(`
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      citizen_id TEXT NOT NULL,
      anonymized_text TEXT NOT NULL,
      original_description TEXT,
      translated_description_de TEXT,
      category TEXT,
      priority TEXT DEFAULT 'medium',
      latitude REAL,
      longitude REAL,
      address TEXT,
      postal_code TEXT,
      city TEXT,
      nominatim_raw_json TEXT,
      weather_report_json TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (citizen_id) REFERENCES citizens(id) ON DELETE CASCADE
    )
  `);

  // Submission images - multiple uploads per submission
  await db.exec(`
    CREATE TABLE IF NOT EXISTS submission_images (
      id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL,
      file_name TEXT,
      image_data BLOB NOT NULL,
      exif_json TEXT,
      ai_description_text TEXT,
      ai_description_confidence REAL,
      ai_description_model TEXT,
      ai_description_status TEXT,
      ai_description_error TEXT,
      ai_description_hash TEXT,
      ai_description_updated_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
    )
  `);
  
  // Tickets table - Tickets nach KI-Verarbeitung mit Standortdaten
  await db.exec(`
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL UNIQUE,
      citizen_id TEXT NOT NULL,
      citizen_language TEXT,
      citizen_language_name TEXT,
      category TEXT NOT NULL,
      responsibility_authority VARCHAR(191),
      priority TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'open',
      validation_token TEXT,
      latitude REAL,
      longitude REAL,
      address TEXT,
      postal_code TEXT,
      city TEXT,
      nominatim_raw_json TEXT,
      weather_report_json TEXT,
      redmine_issue_id INTEGER,
      redmine_project TEXT,
      assigned_to TEXT,
      learning_mode BOOLEAN DEFAULT TRUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
      FOREIGN KEY (citizen_id) REFERENCES citizens(id) ON DELETE CASCADE
    )
  `);
  
  // AI Logs - KI-Entscheidungen und Feedback
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ai_logs (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      submission_id TEXT NOT NULL,
      knowledge_version TEXT,
      ai_decision TEXT,
      ai_reasoning TEXT,
      admin_feedback TEXT,
      feedback_is_correct BOOLEAN,
      original_category TEXT,
      corrected_category TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
    )
  `);
  
  // Admin Users
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'SACHBEARBEITER',
      active BOOLEAN DEFAULT TRUE,
      email TEXT,
      first_name TEXT,
      last_name TEXT,
      job_title TEXT,
      work_phone TEXT,
      assignment_keywords_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Admin Password Reset Tokens
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_password_resets (
      id TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL,
      reset_token TEXT NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    )
  `);

  // Admin Sessions - tracks active and historical authenticated sessions
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_sessions (
      id TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      remember_me BOOLEAN DEFAULT FALSE,
      issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      logged_out_at DATETIME,
      is_active BOOLEAN DEFAULT TRUE,
      logout_reason TEXT,
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    )
  `);

  // Tenants (mandantenfaehige Organisations-Roots)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      slug VARCHAR(191) NOT NULL UNIQUE,
      name TEXT NOT NULL,
      tenant_type VARCHAR(64) NOT NULL DEFAULT 'verbandsgemeinde',
      registration_email_domains_json TEXT,
      assignment_keywords_json TEXT,
      active BOOLEAN DEFAULT TRUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS tenant_profiles (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL UNIQUE,
      legal_name TEXT,
      display_name TEXT,
      street TEXT,
      house_number TEXT,
      postal_code TEXT,
      city TEXT,
      country TEXT,
      general_email TEXT,
      support_email TEXT,
      phone TEXT,
      homepage TEXT,
      responsible_person_name TEXT,
      responsible_person_role TEXT,
      responsible_person_email TEXT,
      responsible_person_phone TEXT,
      vat_id TEXT,
      imprint_text TEXT,
      privacy_contact TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_by TEXT,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS tenant_settings_email (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL UNIQUE,
      smtp_json TEXT,
      imap_json TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_by TEXT,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (updated_by) REFERENCES admin_users(id) ON DELETE SET NULL
    )
  `);

  // Admin self-registration requests (double opt-in + admin approval workflow)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_user_registration_requests (
      id TEXT PRIMARY KEY,
      email_original TEXT NOT NULL,
      email_normalized VARCHAR(191) NOT NULL,
      email_domain VARCHAR(191) NOT NULL,
      tenant_id TEXT NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'pending_email_verification',
      workflow_state VARCHAR(64) NOT NULL DEFAULT 'EMAIL_DOUBLE_OPT_IN',
      workflow_history_json TEXT,
      verification_token_hash VARCHAR(191),
      verification_expires_at DATETIME,
      verification_sent_at DATETIME,
      email_verified_at DATETIME,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      password_hash TEXT,
      requested_org_unit_ids_json TEXT,
      review_note TEXT,
      reviewed_by TEXT,
      reviewed_at DATETIME,
      approved_user_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewed_by) REFERENCES admin_users(id) ON DELETE SET NULL,
      FOREIGN KEY (approved_user_id) REFERENCES admin_users(id) ON DELETE SET NULL
    )
  `);

  // Configurable org level taxonomy per tenant (Abteilung/Fachbereich/...)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS org_unit_types (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      \`key\` VARCHAR(191) NOT NULL,
      label TEXT NOT NULL,
      is_assignable BOOLEAN DEFAULT TRUE,
      sort_order INTEGER DEFAULT 0,
      active BOOLEAN DEFAULT TRUE,
      rules_json TEXT,
      assignment_keywords_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    )
  `);

  // Org units tree
  await db.exec(`
    CREATE TABLE IF NOT EXISTS org_units (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      type_id TEXT,
      parent_id TEXT,
      name TEXT NOT NULL,
      code VARCHAR(191),
      contact_email VARCHAR(191),
      active BOOLEAN DEFAULT TRUE,
      metadata_json TEXT,
      assignment_keywords_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (type_id) REFERENCES org_unit_types(id) ON DELETE SET NULL,
      FOREIGN KEY (parent_id) REFERENCES org_units(id) ON DELETE SET NULL
    )
  `);

  // Closure table for performant subtree checks
  await db.exec(`
    CREATE TABLE IF NOT EXISTS org_unit_closure (
      tenant_id TEXT NOT NULL,
      ancestor_id TEXT NOT NULL,
      descendant_id TEXT NOT NULL,
      depth INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, ancestor_id, descendant_id),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (ancestor_id) REFERENCES org_units(id) ON DELETE CASCADE,
      FOREIGN KEY (descendant_id) REFERENCES org_units(id) ON DELETE CASCADE
    )
  `);

  // Per-user tenant scope (tenant admin flag)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_user_tenant_scopes (
      id TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      is_tenant_admin BOOLEAN DEFAULT FALSE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    )
  `);

  // Per-user org scope (read/write separated)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_user_org_scopes (
      id TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      org_unit_id TEXT NOT NULL,
      can_write BOOLEAN DEFAULT FALSE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (org_unit_id) REFERENCES org_units(id) ON DELETE CASCADE
    )
  `);

  // Additional assignees / collaborators (user or org unit)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_collaborators (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      user_id TEXT,
      org_unit_id TEXT,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE SET NULL,
      FOREIGN KEY (org_unit_id) REFERENCES org_units(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL
    )
  `);

  // Internal workflow tasks for clerk processing
  await db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_internal_tasks (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      workflow_execution_id TEXT NOT NULL,
      workflow_id TEXT,
      step_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      mode VARCHAR(32) NOT NULL DEFAULT 'blocking',
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      assignee_user_id TEXT,
      assignee_org_unit_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      instructions TEXT,
      form_schema_json TEXT,
      response_json TEXT,
      ai_meta_json TEXT,
      due_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      completed_by TEXT,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (assignee_user_id) REFERENCES admin_users(id) ON DELETE SET NULL,
      FOREIGN KEY (assignee_org_unit_id) REFERENCES org_units(id) ON DELETE SET NULL,
      FOREIGN KEY (completed_by) REFERENCES admin_users(id) ON DELETE SET NULL
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_internal_task_events (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor_user_id TEXT,
      payload_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_id) REFERENCES workflow_internal_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (actor_user_id) REFERENCES admin_users(id) ON DELETE SET NULL
    )
  `);

  // Citizen accounts - authenticated PWA identities (email based)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS citizen_accounts (
      id TEXT PRIMARY KEY,
      email_normalized VARCHAR(191) NOT NULL UNIQUE,
      email_original TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      verified_at DATETIME,
      last_login_at DATETIME
    )
  `);

  // Citizen login links (magic links)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS citizen_magic_links (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      email_normalized VARCHAR(191) NOT NULL,
      token_hash VARCHAR(191) NOT NULL UNIQUE,
      purpose VARCHAR(64) NOT NULL DEFAULT 'login',
      frontend_profile_token VARCHAR(191),
      redirect_path TEXT,
      expires_at DATETIME NOT NULL,
      consumed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_ip TEXT,
      FOREIGN KEY (account_id) REFERENCES citizen_accounts(id) ON DELETE SET NULL
    )
  `);

  // Citizen sessions (multi-device, rolling expiry)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS citizen_sessions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      session_hash VARCHAR(191) NOT NULL UNIQUE,
      frontend_profile_token VARCHAR(191),
      user_agent TEXT,
      ip TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      revoked_at DATETIME,
      FOREIGN KEY (account_id) REFERENCES citizen_accounts(id) ON DELETE CASCADE
    )
  `);

  // Citizen auth audit trail (security + diagnostics)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS citizen_auth_audit (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      citizen_account_id TEXT,
      email_normalized VARCHAR(191),
      ip_address TEXT,
      user_agent TEXT,
      details_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (citizen_account_id) REFERENCES citizen_accounts(id) ON DELETE SET NULL
    )
  `);

  // Citizen in-app messages (mirrored emails + admin push messages)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS citizen_app_messages (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'system',
      source_ref TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      html_content TEXT,
      action_url TEXT,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      read_at DATETIME,
      delivered_push_at DATETIME,
      FOREIGN KEY (account_id) REFERENCES citizen_accounts(id) ON DELETE CASCADE
    )
  `);

  // Citizen push subscriptions (session-bound PWA/WebPush endpoints)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS citizen_push_subscriptions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      session_id TEXT,
      endpoint_hash VARCHAR(64) NOT NULL UNIQUE,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      revoked_at DATETIME,
      fail_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      FOREIGN KEY (account_id) REFERENCES citizen_accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES citizen_sessions(id) ON DELETE SET NULL
    )
  `);

  // Admin push subscriptions (session-bound PWA/WebPush endpoints for staff users)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_push_subscriptions (
      id TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL,
      session_id TEXT,
      endpoint_hash VARCHAR(64) NOT NULL UNIQUE,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      revoked_at DATETIME,
      fail_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES admin_sessions(id) ON DELETE SET NULL
    )
  `);

  // Admin Journal - security and admin action history
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_journal (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      severity TEXT DEFAULT 'info',
      admin_user_id TEXT,
      username TEXT,
      role TEXT,
      session_id TEXT,
      method TEXT,
      path TEXT,
      ip_address TEXT,
      user_agent TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE SET NULL
    )
  `);
  
  // OAuth Tokens - Gespeicherte OpenAI OAuth-Tokens
  await db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expires_at INTEGER,
      account_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Knowledge Base Versions
  await db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_versions (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL UNIQUE,
      content JSON NOT NULL,
      testing BOOLEAN DEFAULT FALSE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT,
      FOREIGN KEY (created_by) REFERENCES admin_users(id)
    )
  `);
  
  // Escalations Log
  await db.exec(`
    CREATE TABLE IF NOT EXISTS escalations (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      escalation_level INTEGER,
      escalated_to TEXT,
      reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    )
  `);
  
  // Ticket Validations - Double Opt-In
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_validations (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      submission_id TEXT NOT NULL,
      citizen_email TEXT NOT NULL,
      validation_token TEXT NOT NULL UNIQUE,
      validated_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
    )
  `);

  // Workflow Validations - step confirmations
  await db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_validations (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      validation_token TEXT NOT NULL UNIQUE,
      validated_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    )
  `);

  // Ticket comments - shared timeline for staff/AI/system/citizen
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_comments (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      execution_id TEXT,
      task_id TEXT,
      author_type TEXT NOT NULL DEFAULT 'system',
      author_id TEXT,
      author_name TEXT,
      visibility TEXT NOT NULL DEFAULT 'internal',
      comment_type TEXT NOT NULL DEFAULT 'note',
      content TEXT NOT NULL,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    )
  `);

  // Workflow data requests - static or AI generated request forms
  await db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_data_requests (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      ticket_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      parallel_mode INTEGER NOT NULL DEFAULT 1,
      requested_questions_json TEXT,
      expires_at DATETIME,
      answered_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_data_request_answers (
      id TEXT PRIMARY KEY,
      data_request_id TEXT NOT NULL,
      answers_json TEXT NOT NULL,
      raw_payload_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (data_request_id) REFERENCES workflow_data_requests(id) ON DELETE CASCADE
    )
  `);

  // LLM pseudonym pools/mappings for privacy-safe analysis
  await db.exec(`
    CREATE TABLE IF NOT EXISTS llm_pseudonym_pools (
      id TEXT PRIMARY KEY,
      pool_type TEXT NOT NULL,
      entries_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS llm_pseudonym_mappings (
      id TEXT PRIMARY KEY,
      scope_key TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      real_value_hash TEXT NOT NULL,
      pseudo_value TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME
    )
  `);

  // AI situation labels
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_labels (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      label TEXT NOT NULL,
      score REAL,
      source TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    )
  `);

  // Ticket reporter pseudonyms (internal display + stable mapping per ticket)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_reporter_pseudonyms (
      ticket_id TEXT PRIMARY KEY,
      scope_key TEXT,
      pseudo_name TEXT,
      pseudo_first_name TEXT,
      pseudo_last_name TEXT,
      pseudo_email TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    )
  `);

  // Persisted AI situation analyses incl. raw analysis data
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ai_situation_reports (
      id TEXT PRIMARY KEY,
      created_by_admin_id TEXT,
      report_type TEXT NOT NULL DEFAULT 'operations',
      scope_key TEXT,
      days INTEGER NOT NULL DEFAULT 30,
      max_tickets INTEGER NOT NULL DEFAULT 600,
      include_closed INTEGER NOT NULL DEFAULT 1,
      pseudonymize_names INTEGER NOT NULL DEFAULT 1,
      pseudonymize_emails INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'completed',
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME,
      result_json TEXT,
      raw_data_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
    )
  `);

  // Persistent compact analysis memory cards for prompt-context reuse
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ai_analysis_memory (
      id TEXT PRIMARY KEY,
      scope_key TEXT NOT NULL,
      report_type TEXT NOT NULL DEFAULT 'operations',
      source TEXT NOT NULL DEFAULT 'auto',
      summary TEXT NOT NULL,
      details_json TEXT,
      prompt_instruction TEXT,
      confidence REAL,
      report_id TEXT,
      created_by_admin_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (report_id) REFERENCES ai_situation_reports(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
    )
  `);

  // Notification center events
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_notifications (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'warning',
      role_scope TEXT NOT NULL DEFAULT 'all',
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      context_json TEXT,
      related_ticket_id TEXT,
      related_execution_id TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      resolved_by_admin_id TEXT,
      FOREIGN KEY (related_ticket_id) REFERENCES tickets(id) ON DELETE SET NULL,
      FOREIGN KEY (resolved_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
    )
  `);

  // Per-user feed tokens (revokable) for Atom subscriptions
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_feed_tokens (
      id TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_by_admin_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used_at DATETIME,
      revoked_at DATETIME,
      revoked_by_admin_id TEXT,
      revoke_reason TEXT,
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL,
      FOREIGN KEY (revoked_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
    )
  `);

  // Per-user API tokens (revokable, hashed at rest)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_api_tokens (
      id TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL,
      label TEXT,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      created_by_admin_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      last_used_at DATETIME,
      revoked_at DATETIME,
      revoked_by_admin_id TEXT,
      revoke_reason TEXT,
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL,
      FOREIGN KEY (revoked_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
    )
  `);

  // WebAuthn passkeys for admin login
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_passkeys (
      id TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL,
      label TEXT,
      credential_id TEXT NOT NULL UNIQUE,
      public_key_spki TEXT NOT NULL,
      cose_algorithm INTEGER NOT NULL DEFAULT -7,
      sign_count INTEGER NOT NULL DEFAULT 0,
      transports_json TEXT,
      created_by_admin_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_used_at DATETIME,
      revoked_at DATETIME,
      revoked_by_admin_id TEXT,
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL,
      FOREIGN KEY (revoked_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
    )
  `);

  // TOTP second factor settings for admin accounts
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_totp_factors (
      id TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL UNIQUE,
      secret_encrypted TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      disabled_at DATETIME,
      updated_by_admin_id TEXT,
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE,
      FOREIGN KEY (updated_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
    )
  `);

  // One-time authentication challenges for passkey/TOTP flows
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_auth_challenges (
      id TEXT PRIMARY KEY,
      purpose VARCHAR(64) NOT NULL,
      admin_user_id TEXT,
      challenge TEXT NOT NULL,
      payload_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      consumed_at DATETIME,
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    )
  `);

  // Chat account mapping for XMPP integration
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_chat_accounts (
      id TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL UNIQUE,
      xmpp_username VARCHAR(191) NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    )
  `);

  // Custom chat groups (org-unit groups are virtual, generated from org structure)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_chat_custom_groups (
      id TEXT PRIMARY KEY,
      tenant_id TEXT,
      slug VARCHAR(191) NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_by_admin_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by_admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_chat_custom_group_members (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      admin_user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES admin_chat_custom_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    )
  `);

  // Uploaded files referenced by chat messages
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_chat_files (
      id TEXT PRIMARY KEY,
      uploaded_by_admin_id TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL DEFAULT 0,
      storage_path TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (uploaded_by_admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
    )
  `);

  // Persisted chat history (used for searchable history + notifications)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_chat_messages (
      id TEXT PRIMARY KEY,
      sender_admin_user_id TEXT NOT NULL,
      conversation_type VARCHAR(32) NOT NULL,
      conversation_id TEXT NOT NULL,
      recipient_admin_user_id TEXT,
      group_kind VARCHAR(32),
      group_id TEXT,
      message_kind VARCHAR(32) NOT NULL DEFAULT 'text',
      body TEXT NOT NULL,
      file_id TEXT,
      ticket_id TEXT,
      xmpp_stanza_id TEXT,
      quoted_message_id TEXT,
      quoted_body TEXT,
      quoted_sender_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sender_admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE,
      FOREIGN KEY (recipient_admin_user_id) REFERENCES admin_users(id) ON DELETE SET NULL,
      FOREIGN KEY (file_id) REFERENCES admin_chat_files(id) ON DELETE SET NULL
    )
  `);

  // Persisted per-user assistant chat history (personal AI assistant context)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_chatbot_messages (
      id TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL,
      role VARCHAR(16) NOT NULL,
      body TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    )
  `);

  // Message read receipts (per user, used for read indicators in direct/group chats)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_chat_message_reads (
      message_id TEXT NOT NULL,
      admin_user_id TEXT NOT NULL,
      read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (message_id, admin_user_id),
      FOREIGN KEY (message_id) REFERENCES admin_chat_messages(id) ON DELETE CASCADE,
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    )
  `);

  // Message reactions (emoji reactions per user/message)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_chat_message_reactions (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      admin_user_id TEXT NOT NULL,
      emoji VARCHAR(32) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (message_id) REFERENCES admin_chat_messages(id) ON DELETE CASCADE,
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    )
  `);

  // Per-user chat presence settings (button badge + custom presence text/color)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_chat_presence_settings (
      admin_user_id TEXT PRIMARY KEY,
      status_key VARCHAR(32) NOT NULL DEFAULT 'online',
      custom_label TEXT,
      custom_color VARCHAR(32),
      custom_emoji VARCHAR(32),
      expires_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    )
  `);

  // Per-user notification preferences
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_user_notification_preferences (
      admin_user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (admin_user_id, event_type),
      FOREIGN KEY (admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
    )
  `);

  // System settings (admin-configurable runtime settings)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      \`key\` TEXT PRIMARY KEY,
      \`value\` TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // UI translations cache (AI generated)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS translations (
      language TEXT NOT NULL,
      \`key\` TEXT NOT NULL,
      \`value\` TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (language, \`key\`)
    )
  `);

  // Preplanned email template translations (AI generated, reusable)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS email_template_translations (
      language TEXT NOT NULL,
      template_id TEXT NOT NULL,
      template_name TEXT,
      subject TEXT NOT NULL,
      html_content TEXT NOT NULL,
      text_content TEXT,
      translation_notice TEXT,
      source_subject TEXT,
      source_html_content TEXT,
      source_text_content TEXT,
      source_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (language, template_id)
    )
  `);

  // Knowledge categories library (platform + tenant scopes)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_category_library (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'platform',
      tenant_id TEXT,
      origin_item_id TEXT,
      is_override BOOLEAN DEFAULT FALSE,
      name VARCHAR(255),
      payload_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Workflow template library (platform + tenant scopes)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_template_library (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'platform',
      tenant_id TEXT,
      origin_item_id TEXT,
      is_override BOOLEAN DEFAULT FALSE,
      name VARCHAR(255),
      payload_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Email template library (platform + tenant scopes)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS email_template_library (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'platform',
      tenant_id TEXT,
      origin_item_id TEXT,
      is_override BOOLEAN DEFAULT FALSE,
      name VARCHAR(255),
      subject VARCHAR(255),
      payload_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Email queue (persistent async processing)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS email_queue (
      id TEXT PRIMARY KEY,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      html_content TEXT NOT NULL,
      text_content TEXT,
      ticket_id TEXT,
      tenant_id TEXT,
      provider_message_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      last_error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      scheduled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      sent_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // IMAP mailbox sync storage (inbound emails and attachments)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS mailbox_messages (
      id TEXT PRIMARY KEY,
      mailbox_uid INTEGER NOT NULL,
      mailbox_name TEXT NOT NULL DEFAULT 'INBOX',
      message_id TEXT,
      in_reply_to TEXT,
      references_header TEXT,
      subject TEXT NOT NULL DEFAULT '',
      from_name TEXT,
      from_email TEXT,
      to_emails TEXT,
      cc_emails TEXT,
      date_header TEXT,
      received_at DATETIME,
      text_body TEXT,
      html_body TEXT,
      raw_headers TEXT,
      raw_size INTEGER NOT NULL DEFAULT 0,
      ticket_id TEXT,
      ticket_comment_id TEXT,
      match_reason TEXT,
      preview TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS mailbox_attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      content_disposition TEXT,
      content_id TEXT,
      byte_size INTEGER NOT NULL DEFAULT 0,
      file_data BLOB NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (message_id) REFERENCES mailbox_messages(id) ON DELETE CASCADE
    )
  `);

  // AI queue (persistent serial processing)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ai_queue (
      id TEXT PRIMARY KEY,
      purpose TEXT NOT NULL DEFAULT 'generic',
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 2,
      last_error TEXT,
      result_text TEXT,
      provider TEXT,
      model TEXT,
      meta_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      scheduled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      finished_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Platform blog posts (public changelog/news for platform landing page)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS platform_blog_posts (
      id TEXT PRIMARY KEY,
      slug VARCHAR(191) NOT NULL UNIQUE,
      title TEXT NOT NULL,
      excerpt TEXT,
      content_md TEXT NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'draft',
      published_at DATETIME,
      created_by_admin_id TEXT,
      updated_by_admin_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL,
      FOREIGN KEY (updated_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
    )
  `);

  if (db.dialect === 'mysql') {
    // Legacy MySQL installs may have created `label` as LONGTEXT which blocks indexed access.
    await db.exec(`ALTER TABLE ticket_labels MODIFY COLUMN \`label\` VARCHAR(191) NOT NULL`);
    // Legacy installs may have created this as LONGTEXT, which breaks the group index.
    await db.exec(
      `UPDATE admin_chat_messages
       SET group_kind = LEFT(group_kind, 32)
       WHERE group_kind IS NOT NULL
         AND CHAR_LENGTH(group_kind) > 32`
    );
    await db.exec(`ALTER TABLE admin_chat_messages MODIFY COLUMN \`group_kind\` VARCHAR(32)`);
  }
  
  if (!legacySchemaBootstrapEnabled) {
    console.info('[db] Legacy schema bootstrap disabled (DB_LEGACY_SCHEMA_BOOTSTRAP=false).');
  } else {
  await ensureColumn(db, 'tickets', 'description', 'TEXT');
  await ensureColumn(db, 'tickets', 'validation_token', 'TEXT');
  await ensureColumn(db, 'tickets', 'citizen_email_normalized', 'VARCHAR(191)');
  await ensureColumn(db, 'tickets', 'citizen_language', 'TEXT');
  await ensureColumn(db, 'tickets', 'citizen_language_name', 'TEXT');
  await ensureColumn(db, 'tickets', 'responsibility_authority', 'VARCHAR(191)');
  await ensureColumn(db, 'tickets', 'tenant_id', 'TEXT');
  await ensureColumn(db, 'tickets', 'owning_org_unit_id', 'TEXT');
  await ensureColumn(db, 'tickets', 'primary_assignee_user_id', 'TEXT');
  await ensureColumn(db, 'tickets', 'primary_assignee_org_unit_id', 'TEXT');
  await ensureColumn(db, 'tickets', 'assignment_updated_by', 'TEXT');
  await ensureColumn(db, 'tickets', 'assignment_updated_at', 'DATETIME');
  await ensureColumn(db, 'tenants', 'registration_email_domains_json', 'TEXT');
  await ensureColumn(db, 'tenants', 'assignment_keywords_json', 'TEXT');
  await ensureColumn(db, 'admin_users', 'assignment_keywords_json', 'TEXT');
  await ensureColumn(db, 'org_unit_types', 'assignment_keywords_json', 'TEXT');
  await ensureColumn(db, 'org_units', 'assignment_keywords_json', 'TEXT');
  await ensureColumn(db, 'org_units', 'contact_email', 'VARCHAR(191)');
  await ensureColumn(db, 'submissions', 'translated_description_de', 'TEXT');
  await ensureColumn(db, 'tickets', 'nominatim_raw_json', 'TEXT');
  await ensureColumn(db, 'submissions', 'nominatim_raw_json', 'TEXT');
  await ensureColumn(db, 'tickets', 'weather_report_json', 'TEXT');
  await ensureColumn(db, 'submissions', 'weather_report_json', 'TEXT');
  await ensureColumn(db, 'tickets', 'status_notifications_enabled', 'INTEGER NOT NULL DEFAULT 1');
  await ensureColumn(db, 'admin_sessions', 'remember_me', 'BOOLEAN DEFAULT FALSE');
  await ensureColumn(db, 'admin_sessions', 'issued_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'admin_sessions', 'last_seen_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'admin_sessions', 'expires_at', 'DATETIME');
  await ensureColumn(db, 'admin_sessions', 'logged_out_at', 'DATETIME');
  await ensureColumn(db, 'admin_sessions', 'is_active', 'BOOLEAN DEFAULT TRUE');
  await ensureColumn(db, 'admin_sessions', 'logout_reason', 'TEXT');
  await ensureColumn(db, 'admin_sessions', 'ip_address', 'TEXT');
  await ensureColumn(db, 'admin_sessions', 'user_agent', 'TEXT');
  await ensureColumn(db, 'admin_journal', 'severity', "TEXT DEFAULT 'info'");
  await ensureColumn(db, 'admin_journal', 'admin_user_id', 'TEXT');
  await ensureColumn(db, 'admin_journal', 'username', 'TEXT');
  await ensureColumn(db, 'admin_journal', 'role', 'TEXT');
  await ensureColumn(db, 'admin_journal', 'session_id', 'TEXT');
  await ensureColumn(db, 'admin_journal', 'method', 'TEXT');
  await ensureColumn(db, 'admin_journal', 'path', 'TEXT');
  await ensureColumn(db, 'admin_journal', 'ip_address', 'TEXT');
  await ensureColumn(db, 'admin_journal', 'user_agent', 'TEXT');
  await ensureColumn(db, 'admin_journal', 'details', 'TEXT');
  await ensureColumn(db, 'citizen_magic_links', 'frontend_profile_token', 'VARCHAR(191)');
  await ensureColumn(db, 'citizen_sessions', 'frontend_profile_token', 'VARCHAR(191)');
  await ensureColumn(db, 'citizen_app_messages', 'source_type', "TEXT NOT NULL DEFAULT 'system'");
  await ensureColumn(db, 'citizen_app_messages', 'source_ref', 'TEXT');
  await ensureColumn(db, 'citizen_app_messages', 'title', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, 'citizen_app_messages', 'body', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, 'citizen_app_messages', 'html_content', 'TEXT');
  await ensureColumn(db, 'citizen_app_messages', 'action_url', 'TEXT');
  await ensureColumn(db, 'citizen_app_messages', 'metadata_json', 'TEXT');
  await ensureColumn(db, 'citizen_app_messages', 'created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'citizen_app_messages', 'read_at', 'DATETIME');
  await ensureColumn(db, 'citizen_app_messages', 'delivered_push_at', 'DATETIME');
  await ensureColumn(db, 'citizen_push_subscriptions', 'session_id', 'TEXT');
  await ensureColumn(db, 'citizen_push_subscriptions', 'endpoint_hash', 'VARCHAR(64)');
  await ensureColumn(db, 'citizen_push_subscriptions', 'endpoint', 'TEXT');
  await ensureColumn(db, 'citizen_push_subscriptions', 'p256dh', 'TEXT');
  await ensureColumn(db, 'citizen_push_subscriptions', 'auth', 'TEXT');
  await ensureColumn(db, 'citizen_push_subscriptions', 'user_agent', 'TEXT');
  await ensureColumn(db, 'citizen_push_subscriptions', 'created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'citizen_push_subscriptions', 'last_seen_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'citizen_push_subscriptions', 'revoked_at', 'DATETIME');
  await ensureColumn(db, 'citizen_push_subscriptions', 'fail_count', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'citizen_push_subscriptions', 'last_error', 'TEXT');
  await ensureColumn(db, 'admin_push_subscriptions', 'admin_user_id', 'TEXT');
  await ensureColumn(db, 'admin_push_subscriptions', 'session_id', 'TEXT');
  await ensureColumn(db, 'admin_push_subscriptions', 'endpoint_hash', 'VARCHAR(64)');
  await ensureColumn(db, 'admin_push_subscriptions', 'endpoint', 'TEXT');
  await ensureColumn(db, 'admin_push_subscriptions', 'p256dh', 'TEXT');
  await ensureColumn(db, 'admin_push_subscriptions', 'auth', 'TEXT');
  await ensureColumn(db, 'admin_push_subscriptions', 'user_agent', 'TEXT');
  await ensureColumn(db, 'admin_push_subscriptions', 'created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'admin_push_subscriptions', 'last_seen_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'admin_push_subscriptions', 'revoked_at', 'DATETIME');
  await ensureColumn(db, 'admin_push_subscriptions', 'fail_count', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'admin_push_subscriptions', 'last_error', 'TEXT');
  await ensureColumn(db, 'citizens', 'preferred_language', 'TEXT');
  await ensureColumn(db, 'citizens', 'preferred_language_name', 'TEXT');
  await ensureColumn(db, 'submission_images', 'exif_json', 'TEXT');
  await ensureColumn(db, 'submission_images', 'ai_description_text', 'TEXT');
  await ensureColumn(db, 'submission_images', 'ai_description_confidence', 'REAL');
  await ensureColumn(db, 'submission_images', 'ai_description_model', 'TEXT');
  await ensureColumn(db, 'submission_images', 'ai_description_status', "TEXT DEFAULT 'idle'");
  await ensureColumn(db, 'submission_images', 'ai_description_error', 'TEXT');
  await ensureColumn(db, 'submission_images', 'ai_description_hash', 'TEXT');
  await ensureColumn(db, 'submission_images', 'ai_description_updated_at', 'DATETIME');
  await ensureColumn(db, 'email_queue', 'status', "TEXT NOT NULL DEFAULT 'pending'");
  await ensureColumn(db, 'email_queue', 'attempts', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'email_queue', 'max_attempts', 'INTEGER NOT NULL DEFAULT 5');
  await ensureColumn(db, 'email_queue', 'last_error', 'TEXT');
  await ensureColumn(db, 'email_queue', 'scheduled_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'email_queue', 'sent_at', 'DATETIME');
  await ensureColumn(db, 'email_queue', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'email_queue', 'ticket_id', 'TEXT');
  await ensureColumn(db, 'email_queue', 'tenant_id', 'TEXT');
  await ensureColumn(db, 'email_queue', 'provider_message_id', 'TEXT');
  await ensureColumn(db, 'mailbox_messages', 'mailbox_uid', 'INTEGER');
  await ensureColumn(db, 'mailbox_messages', 'mailbox_name', "TEXT NOT NULL DEFAULT 'INBOX'");
  await ensureColumn(db, 'mailbox_messages', 'message_id', 'TEXT');
  await ensureColumn(db, 'mailbox_messages', 'in_reply_to', 'TEXT');
  await ensureColumn(db, 'mailbox_messages', 'references_header', 'TEXT');
  await ensureColumn(db, 'mailbox_messages', 'subject', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, 'mailbox_messages', 'from_name', 'TEXT');
  await ensureColumn(db, 'mailbox_messages', 'from_email', 'TEXT');
  await ensureColumn(db, 'mailbox_messages', 'to_emails', 'TEXT');
  await ensureColumn(db, 'mailbox_messages', 'cc_emails', 'TEXT');
  await ensureColumn(db, 'mailbox_messages', 'date_header', 'TEXT');
  await ensureColumn(db, 'mailbox_messages', 'received_at', 'DATETIME');
  await ensureColumn(db, 'mailbox_messages', 'text_body', 'TEXT');
  await ensureColumn(db, 'mailbox_messages', 'html_body', 'TEXT');
  await ensureColumn(db, 'mailbox_messages', 'raw_headers', 'TEXT');
  await ensureColumn(db, 'mailbox_messages', 'raw_size', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'mailbox_messages', 'ticket_id', 'TEXT');
  await ensureColumn(db, 'mailbox_messages', 'ticket_comment_id', 'TEXT');
  await ensureColumn(db, 'mailbox_messages', 'match_reason', 'TEXT');
  await ensureColumn(db, 'mailbox_messages', 'preview', 'TEXT');
  await ensureColumn(db, 'mailbox_messages', 'created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'mailbox_messages', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'mailbox_attachments', 'message_id', 'TEXT');
  await ensureColumn(db, 'mailbox_attachments', 'file_name', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, 'mailbox_attachments', 'mime_type', "TEXT NOT NULL DEFAULT 'application/octet-stream'");
  await ensureColumn(db, 'mailbox_attachments', 'content_disposition', 'TEXT');
  await ensureColumn(db, 'mailbox_attachments', 'content_id', 'TEXT');
  await ensureColumn(db, 'mailbox_attachments', 'byte_size', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'mailbox_attachments', 'file_data', 'BLOB');
  await ensureColumn(db, 'mailbox_attachments', 'created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'ai_queue', 'purpose', "TEXT NOT NULL DEFAULT 'generic'");
  await ensureColumn(db, 'ai_queue', 'prompt', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, 'ai_queue', 'status', "TEXT NOT NULL DEFAULT 'pending'");
  await ensureColumn(db, 'ai_queue', 'attempts', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'ai_queue', 'max_attempts', 'INTEGER NOT NULL DEFAULT 2');
  await ensureColumn(db, 'ai_queue', 'last_error', 'TEXT');
  await ensureColumn(db, 'ai_queue', 'result_text', 'TEXT');
  await ensureColumn(db, 'ai_queue', 'provider', 'TEXT');
  await ensureColumn(db, 'ai_queue', 'model', 'TEXT');
  await ensureColumn(db, 'ai_queue', 'meta_json', 'TEXT');
  await ensureColumn(db, 'ai_queue', 'scheduled_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'ai_queue', 'started_at', 'DATETIME');
  await ensureColumn(db, 'ai_queue', 'finished_at', 'DATETIME');
  await ensureColumn(db, 'ai_queue', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'email_template_translations', 'template_name', 'TEXT');
  await ensureColumn(db, 'email_template_translations', 'subject', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, 'email_template_translations', 'html_content', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, 'email_template_translations', 'text_content', 'TEXT');
  await ensureColumn(db, 'email_template_translations', 'translation_notice', 'TEXT');
  await ensureColumn(db, 'email_template_translations', 'source_subject', 'TEXT');
  await ensureColumn(db, 'email_template_translations', 'source_html_content', 'TEXT');
  await ensureColumn(db, 'email_template_translations', 'source_text_content', 'TEXT');
  await ensureColumn(db, 'email_template_translations', 'source_hash', 'TEXT');
  await ensureColumn(db, 'email_template_translations', 'created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'email_template_translations', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'ticket_reporter_pseudonyms', 'scope_key', 'TEXT');
  await ensureColumn(db, 'ticket_reporter_pseudonyms', 'pseudo_name', 'TEXT');
  await ensureColumn(db, 'ticket_reporter_pseudonyms', 'pseudo_first_name', 'TEXT');
  await ensureColumn(db, 'ticket_reporter_pseudonyms', 'pseudo_last_name', 'TEXT');
  await ensureColumn(db, 'ticket_reporter_pseudonyms', 'pseudo_email', 'TEXT');
  await ensureColumn(db, 'ticket_reporter_pseudonyms', 'created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'ticket_reporter_pseudonyms', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'ai_situation_reports', 'created_by_admin_id', 'TEXT');
  await ensureColumn(db, 'ai_situation_reports', 'report_type', "TEXT NOT NULL DEFAULT 'operations'");
  await ensureColumn(db, 'ai_situation_reports', 'scope_key', 'TEXT');
  await ensureColumn(db, 'ai_situation_reports', 'days', 'INTEGER NOT NULL DEFAULT 30');
  await ensureColumn(db, 'ai_situation_reports', 'max_tickets', 'INTEGER NOT NULL DEFAULT 600');
  await ensureColumn(db, 'ai_situation_reports', 'include_closed', 'INTEGER NOT NULL DEFAULT 1');
  await ensureColumn(db, 'ai_situation_reports', 'pseudonymize_names', 'INTEGER NOT NULL DEFAULT 1');
  await ensureColumn(db, 'ai_situation_reports', 'pseudonymize_emails', 'INTEGER NOT NULL DEFAULT 1');
  await ensureColumn(db, 'ai_situation_reports', 'status', "TEXT NOT NULL DEFAULT 'completed'");
  await ensureColumn(db, 'ai_situation_reports', 'started_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'ai_situation_reports', 'finished_at', 'DATETIME');
  await ensureColumn(db, 'ai_situation_reports', 'result_json', 'TEXT');
  await ensureColumn(db, 'ai_situation_reports', 'raw_data_json', 'TEXT');
  await ensureColumn(db, 'ai_situation_reports', 'created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'ai_situation_reports', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'ai_analysis_memory', 'scope_key', "TEXT NOT NULL DEFAULT 'situation-report-stable'");
  await ensureColumn(db, 'ai_analysis_memory', 'report_type', "TEXT NOT NULL DEFAULT 'operations'");
  await ensureColumn(db, 'ai_analysis_memory', 'source', "TEXT NOT NULL DEFAULT 'auto'");
  await ensureColumn(db, 'ai_analysis_memory', 'summary', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, 'ai_analysis_memory', 'details_json', 'TEXT');
  await ensureColumn(db, 'ai_analysis_memory', 'prompt_instruction', 'TEXT');
  await ensureColumn(db, 'ai_analysis_memory', 'confidence', 'REAL');
  await ensureColumn(db, 'ai_analysis_memory', 'report_id', 'TEXT');
  await ensureColumn(db, 'ai_analysis_memory', 'created_by_admin_id', 'TEXT');
  await ensureColumn(db, 'ai_analysis_memory', 'created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'ai_analysis_memory', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'admin_notifications', 'event_type', "TEXT NOT NULL DEFAULT 'system_warning'");
  await ensureColumn(db, 'admin_notifications', 'severity', "TEXT NOT NULL DEFAULT 'warning'");
  await ensureColumn(db, 'admin_notifications', 'role_scope', "TEXT NOT NULL DEFAULT 'all'");
  await ensureColumn(db, 'admin_notifications', 'title', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, 'admin_notifications', 'message', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, 'admin_notifications', 'context_json', 'TEXT');
  await ensureColumn(db, 'admin_notifications', 'related_ticket_id', 'TEXT');
  await ensureColumn(db, 'admin_notifications', 'related_execution_id', 'TEXT');
  await ensureColumn(db, 'admin_notifications', 'status', "TEXT NOT NULL DEFAULT 'open'");
  await ensureColumn(db, 'admin_notifications', 'created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'admin_notifications', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'admin_notifications', 'resolved_at', 'DATETIME');
  await ensureColumn(db, 'admin_notifications', 'resolved_by_admin_id', 'TEXT');
  await ensureColumn(db, 'admin_users', 'is_global_admin', 'BOOLEAN DEFAULT FALSE');
  await ensureColumn(db, 'admin_user_registration_requests', 'email_original', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, 'admin_user_registration_requests', 'email_normalized', "VARCHAR(191) NOT NULL DEFAULT ''");
  await ensureColumn(db, 'admin_user_registration_requests', 'email_domain', "VARCHAR(191) NOT NULL DEFAULT ''");
  await ensureColumn(db, 'admin_user_registration_requests', 'tenant_id', 'TEXT');
  await ensureColumn(
    db,
    'admin_user_registration_requests',
    'status',
    "VARCHAR(32) NOT NULL DEFAULT 'pending_email_verification'"
  );
  await ensureColumn(
    db,
    'admin_user_registration_requests',
    'workflow_state',
    "VARCHAR(64) NOT NULL DEFAULT 'EMAIL_DOUBLE_OPT_IN'"
  );
  await ensureColumn(db, 'admin_user_registration_requests', 'workflow_history_json', 'TEXT');
  await ensureColumn(db, 'admin_user_registration_requests', 'verification_token_hash', 'VARCHAR(191)');
  await ensureColumn(db, 'admin_user_registration_requests', 'verification_expires_at', 'DATETIME');
  await ensureColumn(db, 'admin_user_registration_requests', 'verification_sent_at', 'DATETIME');
  await ensureColumn(db, 'admin_user_registration_requests', 'email_verified_at', 'DATETIME');
  await ensureColumn(db, 'admin_user_registration_requests', 'username', 'TEXT');
  await ensureColumn(db, 'admin_user_registration_requests', 'first_name', 'TEXT');
  await ensureColumn(db, 'admin_user_registration_requests', 'last_name', 'TEXT');
  await ensureColumn(db, 'admin_user_registration_requests', 'password_hash', 'TEXT');
  await ensureColumn(db, 'admin_user_registration_requests', 'requested_org_unit_ids_json', 'TEXT');
  await ensureColumn(db, 'admin_user_registration_requests', 'review_note', 'TEXT');
  await ensureColumn(db, 'admin_user_registration_requests', 'reviewed_by', 'TEXT');
  await ensureColumn(db, 'admin_user_registration_requests', 'reviewed_at', 'DATETIME');
  await ensureColumn(db, 'admin_user_registration_requests', 'approved_user_id', 'TEXT');
  await ensureColumn(
    db,
    'admin_user_registration_requests',
    'created_at',
    'DATETIME DEFAULT CURRENT_TIMESTAMP'
  );
  await ensureColumn(
    db,
    'admin_user_registration_requests',
    'updated_at',
    'DATETIME DEFAULT CURRENT_TIMESTAMP'
  );
  await ensureColumn(
    db,
    'admin_user_notification_preferences',
    'enabled',
    'INTEGER NOT NULL DEFAULT 1'
  );
  await ensureColumn(db, 'admin_chat_presence_settings', 'custom_emoji', 'VARCHAR(32)');
  await ensureColumn(db, 'admin_chat_presence_settings', 'expires_at', 'DATETIME');
  await ensureColumn(
    db,
    'admin_user_notification_preferences',
    'created_at',
    'DATETIME DEFAULT CURRENT_TIMESTAMP'
  );
  await ensureColumn(
    db,
    'admin_user_notification_preferences',
    'updated_at',
    'DATETIME DEFAULT CURRENT_TIMESTAMP'
  );
  await ensureColumn(db, 'admin_passkeys', 'label', 'TEXT');
  await ensureColumn(db, 'admin_passkeys', 'credential_id', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, 'admin_passkeys', 'public_key_spki', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, 'admin_passkeys', 'cose_algorithm', 'INTEGER NOT NULL DEFAULT -7');
  await ensureColumn(db, 'admin_passkeys', 'sign_count', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'admin_passkeys', 'transports_json', 'TEXT');
  await ensureColumn(db, 'admin_passkeys', 'created_by_admin_id', 'TEXT');
  await ensureColumn(db, 'admin_passkeys', 'created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'admin_passkeys', 'last_used_at', 'DATETIME');
  await ensureColumn(db, 'admin_passkeys', 'revoked_at', 'DATETIME');
  await ensureColumn(db, 'admin_passkeys', 'revoked_by_admin_id', 'TEXT');
  await ensureColumn(db, 'admin_totp_factors', 'admin_user_id', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, 'admin_totp_factors', 'secret_encrypted', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, 'admin_totp_factors', 'enabled', 'INTEGER NOT NULL DEFAULT 1');
  await ensureColumn(db, 'admin_totp_factors', 'created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'admin_totp_factors', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'admin_totp_factors', 'disabled_at', 'DATETIME');
  await ensureColumn(db, 'admin_totp_factors', 'updated_by_admin_id', 'TEXT');
  await ensureColumn(db, 'admin_auth_challenges', 'purpose', "VARCHAR(64) NOT NULL DEFAULT 'totp_login'");
  await ensureColumn(db, 'admin_auth_challenges', 'admin_user_id', 'TEXT');
  await ensureColumn(db, 'admin_auth_challenges', 'challenge', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, 'admin_auth_challenges', 'payload_json', 'TEXT');
  await ensureColumn(db, 'admin_auth_challenges', 'created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn(db, 'admin_auth_challenges', 'expires_at', 'DATETIME');
  await ensureColumn(db, 'admin_auth_challenges', 'consumed_at', 'DATETIME');
  await ensureColumn(db, 'admin_chat_messages', 'quoted_message_id', 'TEXT');
  await ensureColumn(db, 'admin_chat_messages', 'quoted_body', 'TEXT');
  await ensureColumn(db, 'admin_chat_messages', 'quoted_sender_name', 'TEXT');
  await ensureColumn(db, 'platform_blog_posts', 'slug', 'VARCHAR(191)');
  await ensureColumn(db, 'platform_blog_posts', 'title', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, 'platform_blog_posts', 'excerpt', 'TEXT');
  await ensureColumn(db, 'platform_blog_posts', 'content_md', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, 'platform_blog_posts', 'status', "VARCHAR(32) NOT NULL DEFAULT 'draft'");
  await ensureColumn(db, 'platform_blog_posts', 'published_at', 'DATETIME');
  await ensureColumn(db, 'platform_blog_posts', 'created_by_admin_id', 'TEXT');
  await ensureColumn(db, 'platform_blog_posts', 'updated_by_admin_id', 'TEXT');
  await ensureColumn(
    db,
    'platform_blog_posts',
    'created_at',
    'DATETIME DEFAULT CURRENT_TIMESTAMP'
  );
  await ensureColumn(
    db,
    'platform_blog_posts',
    'updated_at',
    'DATETIME DEFAULT CURRENT_TIMESTAMP'
  );
  await ensureColumn(db, 'knowledge_category_library', 'item_id', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(
    db,
    'knowledge_category_library',
    'scope',
    "TEXT NOT NULL DEFAULT 'platform'"
  );
  await ensureColumn(db, 'knowledge_category_library', 'tenant_id', 'TEXT');
  await ensureColumn(db, 'knowledge_category_library', 'origin_item_id', 'TEXT');
  await ensureColumn(
    db,
    'knowledge_category_library',
    'is_override',
    'BOOLEAN DEFAULT FALSE'
  );
  await ensureColumn(db, 'knowledge_category_library', 'name', 'VARCHAR(255)');
  await ensureColumn(
    db,
    'knowledge_category_library',
    'payload_json',
    "TEXT NOT NULL DEFAULT '{}'"
  );
  await ensureColumn(
    db,
    'knowledge_category_library',
    'created_at',
    'DATETIME DEFAULT CURRENT_TIMESTAMP'
  );
  await ensureColumn(
    db,
    'knowledge_category_library',
    'updated_at',
    'DATETIME DEFAULT CURRENT_TIMESTAMP'
  );
  await ensureColumn(db, 'workflow_template_library', 'item_id', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(
    db,
    'workflow_template_library',
    'scope',
    "TEXT NOT NULL DEFAULT 'platform'"
  );
  await ensureColumn(db, 'workflow_template_library', 'tenant_id', 'TEXT');
  await ensureColumn(db, 'workflow_template_library', 'origin_item_id', 'TEXT');
  await ensureColumn(
    db,
    'workflow_template_library',
    'is_override',
    'BOOLEAN DEFAULT FALSE'
  );
  await ensureColumn(db, 'workflow_template_library', 'name', 'VARCHAR(255)');
  await ensureColumn(
    db,
    'workflow_template_library',
    'payload_json',
    "TEXT NOT NULL DEFAULT '{}'"
  );
  await ensureColumn(
    db,
    'workflow_template_library',
    'created_at',
    'DATETIME DEFAULT CURRENT_TIMESTAMP'
  );
  await ensureColumn(
    db,
    'workflow_template_library',
    'updated_at',
    'DATETIME DEFAULT CURRENT_TIMESTAMP'
  );
  await ensureColumn(db, 'email_template_library', 'item_id', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(
    db,
    'email_template_library',
    'scope',
    "TEXT NOT NULL DEFAULT 'platform'"
  );
  await ensureColumn(db, 'email_template_library', 'tenant_id', 'TEXT');
  await ensureColumn(db, 'email_template_library', 'origin_item_id', 'TEXT');
  await ensureColumn(
    db,
    'email_template_library',
    'is_override',
    'BOOLEAN DEFAULT FALSE'
  );
  await ensureColumn(db, 'email_template_library', 'name', 'VARCHAR(255)');
  await ensureColumn(db, 'email_template_library', 'subject', 'VARCHAR(255)');
  await ensureColumn(
    db,
    'email_template_library',
    'payload_json',
    "TEXT NOT NULL DEFAULT '{}'"
  );
  await ensureColumn(
    db,
    'email_template_library',
    'created_at',
    'DATETIME DEFAULT CURRENT_TIMESTAMP'
  );
  await ensureColumn(
    db,
    'email_template_library',
    'updated_at',
    'DATETIME DEFAULT CURRENT_TIMESTAMP'
  );

  if (db.dialect === 'mysql') {
    // Keep this field indexable on MySQL even on migrated schemas with LONGTEXT remnants.
    await db.exec(
      `UPDATE tickets
       SET responsibility_authority = LEFT(responsibility_authority, 191)
       WHERE responsibility_authority IS NOT NULL
         AND CHAR_LENGTH(responsibility_authority) > 191`
    );
    await db.exec(`ALTER TABLE tickets MODIFY COLUMN \`responsibility_authority\` VARCHAR(191)`);
    await db.exec(`
      ALTER TABLE knowledge_category_library
        MODIFY COLUMN name VARCHAR(255) NULL;
      ALTER TABLE workflow_template_library
        MODIFY COLUMN name VARCHAR(255) NULL;
      ALTER TABLE email_template_library
        MODIFY COLUMN name VARCHAR(255) NULL;
      ALTER TABLE email_template_library
        MODIFY COLUMN subject VARCHAR(255) NULL;
    `);
  }

  // Backfill normalized reporter e-mail for ticket ownership queries.
  await db.run(
    `UPDATE tickets
     SET citizen_email_normalized = LOWER(TRIM((
       SELECT c.email
       FROM citizens c
       WHERE c.id = tickets.citizen_id
     )))
     WHERE (citizen_email_normalized IS NULL OR TRIM(citizen_email_normalized) = '')
       AND EXISTS (
         SELECT 1
         FROM citizens c2
         WHERE c2.id = tickets.citizen_id
         AND c2.email IS NOT NULL
          AND TRIM(c2.email) <> ''
       )`
  );

  // Ensure default tenant exists and is assigned to legacy records.
  const defaultTenantId = 'tenant_default';
  await db.run(
    `INSERT INTO tenants (id, slug, name, tenant_type, active)
     SELECT ?, ?, ?, ?, 1
     WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE id = ?)`,
    [defaultTenantId, 'default', 'Standard-Mandant', 'verbandsgemeinde', defaultTenantId]
  );
  await db.run(
    `UPDATE tickets
     SET tenant_id = ?
     WHERE tenant_id IS NULL OR TRIM(tenant_id) = ''`,
    [defaultTenantId]
  );
  await db.run(
    `UPDATE admin_users
     SET is_global_admin = 1
     WHERE (is_global_admin IS NULL OR is_global_admin = 0)
       AND UPPER(TRIM(COALESCE(role, ''))) = 'ADMIN'`
  );
  try {
    const usersForTenantScope = await db.all<any>(
      `SELECT id, role
       FROM admin_users
       WHERE id IS NOT NULL`
    );
    for (const row of usersForTenantScope || []) {
      const userId = String(row?.id || '').trim();
      if (!userId) continue;
      const exists = await db.get<any>(
        `SELECT id
         FROM admin_user_tenant_scopes
         WHERE admin_user_id = ?
           AND tenant_id = ?
         LIMIT 1`,
        [userId, defaultTenantId]
      );
      if (exists?.id) continue;
      const isTenantAdmin = String(row?.role || '').trim().toUpperCase() === 'ADMIN';
      await db.run(
        `INSERT INTO admin_user_tenant_scopes (id, admin_user_id, tenant_id, is_tenant_admin)
         VALUES (?, ?, ?, ?)`,
        [
          `auts_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          userId,
          defaultTenantId,
          isTenantAdmin ? 1 : 0,
        ]
      );
    }
  } catch (tenantScopeError) {
    console.warn('Could not backfill admin tenant scopes:', tenantScopeError);
  }

  // Backfill legacy assigned_to strings to primary assignee user IDs where possible.
  try {
    const legacyAssignedRows = await db.all<any>(
      `SELECT id, assigned_to
       FROM tickets
       WHERE (primary_assignee_user_id IS NULL OR TRIM(primary_assignee_user_id) = '')
         AND assigned_to IS NOT NULL
         AND TRIM(assigned_to) <> ''`
    );
    for (const row of legacyAssignedRows || []) {
      const ticketId = String(row?.id || '').trim();
      const assignedRaw = String(row?.assigned_to || '').trim();
      if (!ticketId || !assignedRaw) continue;
      const assignedLower = assignedRaw.toLowerCase();
      const user = await db.get<any>(
        `SELECT id
         FROM admin_users
         WHERE id = ?
            OR LOWER(TRIM(username)) = ?
            OR LOWER(TRIM(COALESCE(email, ''))) = ?
         LIMIT 1`,
        [assignedRaw, assignedLower, assignedLower]
      );
      if (user?.id) {
        await db.run(
          `UPDATE tickets
           SET primary_assignee_user_id = ?,
               assignment_updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [String(user.id), ticketId]
        );
      } else {
        await db.run(
          `INSERT INTO ticket_comments (
            id, ticket_id, author_type, author_name, visibility, comment_type, content, metadata_json
          ) VALUES (?, ?, 'system', 'migration', 'internal', 'note', ?, ?)`,
          [
            `tc_mig_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            ticketId,
            'Legacy assignment konnte nicht auf Benutzer/Team aufgelöst werden.',
            JSON.stringify({
              source: 'migration.assignment',
              legacy_assignment: assignedRaw,
            }),
          ]
        );
      }
    }
  } catch (migrationError) {
    console.warn('Could not backfill legacy ticket assignments:', migrationError);
  }

  // Create indexes for performance after schema alignment on legacy databases
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_submissions_citizen ON submissions(citizen_id);
    CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
    CREATE INDEX IF NOT EXISTS idx_submission_images_submission ON submission_images(submission_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_submission ON tickets(submission_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_tickets_citizen ON tickets(citizen_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_citizen_email_created ON tickets(citizen_email_normalized, created_at);
    CREATE INDEX IF NOT EXISTS idx_tickets_responsibility_authority ON tickets(responsibility_authority);
    CREATE INDEX IF NOT EXISTS idx_tickets_tenant_created ON tickets(tenant_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_tickets_tenant_owning_org ON tickets(tenant_id, owning_org_unit_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_tickets_tenant_primary_user ON tickets(tenant_id, primary_assignee_user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_tickets_tenant_primary_org ON tickets(tenant_id, primary_assignee_org_unit_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at);
    CREATE INDEX IF NOT EXISTS idx_tickets_updated_at ON tickets(updated_at);
    CREATE INDEX IF NOT EXISTS idx_tickets_status_created ON tickets(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_tickets_status_updated ON tickets(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_ai_logs_ticket ON ai_logs(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_ai_logs_created ON ai_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_escalations_ticket ON escalations(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_oauth_provider ON oauth_tokens(provider);
    CREATE INDEX IF NOT EXISTS idx_admin_sessions_active ON admin_sessions(is_active, last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(admin_user_id, issued_at);
    CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_admin_registration_email_status ON admin_user_registration_requests(email_normalized, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_registration_tenant_status ON admin_user_registration_requests(tenant_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_registration_token_expires ON admin_user_registration_requests(verification_token_hash, verification_expires_at);
    CREATE INDEX IF NOT EXISTS idx_admin_registration_workflow_state ON admin_user_registration_requests(workflow_state, updated_at);
    CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
    CREATE INDEX IF NOT EXISTS idx_tenants_active ON tenants(active, updated_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_profiles_tenant ON tenant_profiles(tenant_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_settings_email_tenant ON tenant_settings_email(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_tenant_settings_email_updated ON tenant_settings_email(updated_at);
    CREATE INDEX IF NOT EXISTS idx_org_unit_types_tenant_sort ON org_unit_types(tenant_id, sort_order, active);
    CREATE INDEX IF NOT EXISTS idx_org_unit_types_tenant_key ON org_unit_types(tenant_id, \`key\`);
    CREATE INDEX IF NOT EXISTS idx_org_units_tenant_parent ON org_units(tenant_id, parent_id, active);
    CREATE INDEX IF NOT EXISTS idx_org_units_tenant_type ON org_units(tenant_id, type_id, active);
    CREATE INDEX IF NOT EXISTS idx_org_units_tenant_code ON org_units(tenant_id, code);
    CREATE INDEX IF NOT EXISTS idx_org_units_tenant_contact_email ON org_units(tenant_id, contact_email);
    CREATE INDEX IF NOT EXISTS idx_org_unit_closure_tenant_ancestor ON org_unit_closure(tenant_id, ancestor_id, descendant_id, depth);
    CREATE INDEX IF NOT EXISTS idx_org_unit_closure_tenant_descendant ON org_unit_closure(tenant_id, descendant_id, ancestor_id, depth);
    CREATE INDEX IF NOT EXISTS idx_admin_user_tenant_scopes_user_tenant ON admin_user_tenant_scopes(admin_user_id, tenant_id);
    CREATE INDEX IF NOT EXISTS idx_admin_user_tenant_scopes_tenant_admin ON admin_user_tenant_scopes(tenant_id, is_tenant_admin, admin_user_id);
    CREATE INDEX IF NOT EXISTS idx_admin_user_org_scopes_user_tenant_unit ON admin_user_org_scopes(admin_user_id, tenant_id, org_unit_id);
    CREATE INDEX IF NOT EXISTS idx_admin_user_org_scopes_tenant_unit ON admin_user_org_scopes(tenant_id, org_unit_id, can_write);
    CREATE INDEX IF NOT EXISTS idx_ticket_collaborators_ticket ON ticket_collaborators(ticket_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_ticket_collaborators_tenant_user ON ticket_collaborators(tenant_id, user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_ticket_collaborators_tenant_org ON ticket_collaborators(tenant_id, org_unit_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_workflow_internal_tasks_ticket ON workflow_internal_tasks(ticket_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_workflow_internal_tasks_execution_step ON workflow_internal_tasks(workflow_execution_id, step_id, status);
    CREATE INDEX IF NOT EXISTS idx_workflow_internal_tasks_assignee_user ON workflow_internal_tasks(assignee_user_id, status, due_at);
    CREATE INDEX IF NOT EXISTS idx_workflow_internal_tasks_assignee_org ON workflow_internal_tasks(assignee_org_unit_id, status, due_at);
    CREATE INDEX IF NOT EXISTS idx_workflow_internal_tasks_tenant_status ON workflow_internal_tasks(tenant_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_workflow_internal_task_events_task_created ON workflow_internal_task_events(task_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_citizen_accounts_email ON citizen_accounts(email_normalized);
    CREATE INDEX IF NOT EXISTS idx_citizen_magic_links_token_expires ON citizen_magic_links(token_hash, expires_at);
    CREATE INDEX IF NOT EXISTS idx_citizen_magic_links_email_created ON citizen_magic_links(email_normalized, created_at);
    CREATE INDEX IF NOT EXISTS idx_citizen_sessions_hash ON citizen_sessions(session_hash);
    CREATE INDEX IF NOT EXISTS idx_citizen_sessions_account_expires ON citizen_sessions(account_id, expires_at);
    CREATE INDEX IF NOT EXISTS idx_citizen_sessions_revoked_expires ON citizen_sessions(revoked_at, expires_at);
    CREATE INDEX IF NOT EXISTS idx_citizen_auth_audit_created ON citizen_auth_audit(created_at);
    CREATE INDEX IF NOT EXISTS idx_citizen_auth_audit_account_created ON citizen_auth_audit(citizen_account_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_citizen_app_messages_account_created ON citizen_app_messages(account_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_citizen_app_messages_account_read_created ON citizen_app_messages(account_id, read_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_citizen_push_subscriptions_account_active ON citizen_push_subscriptions(account_id, revoked_at, last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_citizen_push_subscriptions_session_active ON citizen_push_subscriptions(session_id, revoked_at, last_seen_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_citizen_push_subscriptions_endpoint_hash ON citizen_push_subscriptions(endpoint_hash);
    CREATE INDEX IF NOT EXISTS idx_admin_push_subscriptions_user_active ON admin_push_subscriptions(admin_user_id, revoked_at, last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_admin_push_subscriptions_session_active ON admin_push_subscriptions(session_id, revoked_at, last_seen_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_push_subscriptions_endpoint_hash ON admin_push_subscriptions(endpoint_hash);
    CREATE INDEX IF NOT EXISTS idx_admin_journal_created ON admin_journal(created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_journal_event ON admin_journal(event_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_journal_user ON admin_journal(admin_user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_validations_ticket ON ticket_validations(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_validations_token ON ticket_validations(validation_token);
    CREATE INDEX IF NOT EXISTS idx_validations_expires ON ticket_validations(expires_at);
    CREATE INDEX IF NOT EXISTS idx_workflow_validations_token ON workflow_validations(validation_token);
    CREATE INDEX IF NOT EXISTS idx_workflow_validations_execution ON workflow_validations(execution_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket_created ON ticket_comments(ticket_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_workflow_data_requests_token ON workflow_data_requests(token);
    CREATE INDEX IF NOT EXISTS idx_workflow_data_requests_ticket_status ON workflow_data_requests(ticket_id, status);
    CREATE INDEX IF NOT EXISTS idx_workflow_data_request_answers_request ON workflow_data_request_answers(data_request_id);
    CREATE INDEX IF NOT EXISTS idx_llm_pseudonym_mappings_scope ON llm_pseudonym_mappings(scope_key, entity_type, real_value_hash);
    CREATE INDEX IF NOT EXISTS idx_ticket_labels_ticket_label_created ON ticket_labels(ticket_id, label, created_at);
    CREATE INDEX IF NOT EXISTS idx_ticket_reporter_pseudonyms_scope ON ticket_reporter_pseudonyms(scope_key, updated_at);
    CREATE INDEX IF NOT EXISTS idx_ai_situation_reports_created ON ai_situation_reports(created_at);
    CREATE INDEX IF NOT EXISTS idx_ai_situation_reports_scope ON ai_situation_reports(scope_key, created_at);
    CREATE INDEX IF NOT EXISTS idx_ai_analysis_memory_scope_type_created ON ai_analysis_memory(scope_key, report_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_ai_analysis_memory_report ON ai_analysis_memory(report_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_notifications_status_created ON admin_notifications(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_notifications_event_created ON admin_notifications(event_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_user_notification_preferences_user ON admin_user_notification_preferences(admin_user_id, event_type);
    CREATE INDEX IF NOT EXISTS idx_admin_feed_tokens_scope_active ON admin_feed_tokens(scope, revoked_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_feed_tokens_user_scope ON admin_feed_tokens(admin_user_id, scope, revoked_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_feed_tokens_token ON admin_feed_tokens(token);
    CREATE INDEX IF NOT EXISTS idx_admin_api_tokens_user_active ON admin_api_tokens(admin_user_id, revoked_at, expires_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_api_tokens_hash ON admin_api_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_admin_passkeys_user_active ON admin_passkeys(admin_user_id, revoked_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_passkeys_last_used ON admin_passkeys(last_used_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_passkeys_credential_id ON admin_passkeys(credential_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_totp_factors_user ON admin_totp_factors(admin_user_id);
    CREATE INDEX IF NOT EXISTS idx_admin_totp_factors_enabled ON admin_totp_factors(enabled, updated_at);
    CREATE INDEX IF NOT EXISTS idx_admin_auth_challenges_purpose_expires ON admin_auth_challenges(purpose, expires_at);
    CREATE INDEX IF NOT EXISTS idx_admin_auth_challenges_user_purpose ON admin_auth_challenges(admin_user_id, purpose, expires_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_chat_accounts_admin ON admin_chat_accounts(admin_user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_chat_accounts_xmpp ON admin_chat_accounts(xmpp_username);
    CREATE INDEX IF NOT EXISTS idx_admin_chat_custom_groups_tenant ON admin_chat_custom_groups(tenant_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_chat_custom_groups_creator ON admin_chat_custom_groups(created_by_admin_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_chat_custom_group_members_unique
      ON admin_chat_custom_group_members(group_id, admin_user_id);
    CREATE INDEX IF NOT EXISTS idx_admin_chat_custom_group_members_user
      ON admin_chat_custom_group_members(admin_user_id, joined_at);
    CREATE INDEX IF NOT EXISTS idx_admin_chat_files_uploader ON admin_chat_files(uploaded_by_admin_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_chat_messages_conversation_created
      ON admin_chat_messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_chat_messages_sender_created
      ON admin_chat_messages(sender_admin_user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_chat_messages_recipient_created
      ON admin_chat_messages(recipient_admin_user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_chat_messages_group_created
      ON admin_chat_messages(group_kind, group_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_chatbot_messages_user_created
      ON admin_chatbot_messages(admin_user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_chatbot_messages_user_role_created
      ON admin_chatbot_messages(admin_user_id, role, created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_chat_message_reads_user_read
      ON admin_chat_message_reads(admin_user_id, read_at);
    CREATE INDEX IF NOT EXISTS idx_admin_chat_message_reads_message_read
      ON admin_chat_message_reads(message_id, read_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_chat_message_reactions_unique
      ON admin_chat_message_reactions(message_id, admin_user_id, emoji);
    CREATE INDEX IF NOT EXISTS idx_admin_chat_message_reactions_message
      ON admin_chat_message_reactions(message_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_chat_message_reactions_user
      ON admin_chat_message_reactions(admin_user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings(\`key\`);
    CREATE INDEX IF NOT EXISTS idx_translations_lang ON translations(language);
    CREATE INDEX IF NOT EXISTS idx_email_template_translations_lang ON email_template_translations(language);
    CREATE INDEX IF NOT EXISTS idx_email_template_translations_template ON email_template_translations(template_id);
    CREATE INDEX IF NOT EXISTS idx_email_queue_status_schedule ON email_queue(status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_email_queue_created ON email_queue(created_at);
    CREATE INDEX IF NOT EXISTS idx_email_queue_sent ON email_queue(sent_at);
    CREATE INDEX IF NOT EXISTS idx_email_queue_ticket_id ON email_queue(ticket_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_email_queue_tenant_id ON email_queue(tenant_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_email_queue_provider_message_id ON email_queue(provider_message_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mailbox_messages_mailbox_uid ON mailbox_messages(mailbox_name, mailbox_uid);
    CREATE INDEX IF NOT EXISTS idx_mailbox_messages_ticket ON mailbox_messages(ticket_id, received_at);
    CREATE INDEX IF NOT EXISTS idx_mailbox_messages_subject ON mailbox_messages(subject);
    CREATE INDEX IF NOT EXISTS idx_mailbox_messages_from_email ON mailbox_messages(from_email);
    CREATE INDEX IF NOT EXISTS idx_mailbox_messages_message_id ON mailbox_messages(message_id);
    CREATE INDEX IF NOT EXISTS idx_mailbox_attachments_message ON mailbox_attachments(message_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_ai_queue_status_schedule ON ai_queue(status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_ai_queue_created ON ai_queue(created_at);
    CREATE INDEX IF NOT EXISTS idx_ai_queue_purpose_status ON ai_queue(purpose, status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_blog_posts_slug ON platform_blog_posts(slug);
    CREATE INDEX IF NOT EXISTS idx_platform_blog_posts_status_published ON platform_blog_posts(status, published_at);
    CREATE INDEX IF NOT EXISTS idx_platform_blog_posts_created ON platform_blog_posts(created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_category_library_scope_item
      ON knowledge_category_library(scope, tenant_id, item_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_category_library_scope_name
      ON knowledge_category_library(scope, tenant_id, name, updated_at);
    CREATE INDEX IF NOT EXISTS idx_knowledge_category_library_origin
      ON knowledge_category_library(origin_item_id, tenant_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_template_library_scope_item
      ON workflow_template_library(scope, tenant_id, item_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_template_library_scope_name
      ON workflow_template_library(scope, tenant_id, name, updated_at);
    CREATE INDEX IF NOT EXISTS idx_workflow_template_library_origin
      ON workflow_template_library(origin_item_id, tenant_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_email_template_library_scope_item
      ON email_template_library(scope, tenant_id, item_id);
    CREATE INDEX IF NOT EXISTS idx_email_template_library_scope_subject
      ON email_template_library(scope, tenant_id, subject, updated_at);
    CREATE INDEX IF NOT EXISTS idx_email_template_library_origin
      ON email_template_library(origin_item_id, tenant_id);
  `);
  }

  await seedPlatformBlogPostsIfEmpty(db);
  await syncPlatformHistorySeedPosts(db);

  // Remove deprecated external recipients setting
  try {
    await db.run(`DELETE FROM system_settings WHERE \`key\` = 'externalRecipients'`);
  } catch (error) {
    console.warn('Failed to cleanup externalRecipients setting:', error);
  }
}

async function seedPlatformBlogPostsIfEmpty(db: AppDatabase): Promise<void> {
  try {
    const row = await db.get<any>(`SELECT COUNT(*) AS count FROM platform_blog_posts`);
    if (Number(row?.count || 0) > 0) return;

    const seedPosts = [
      {
        id: 'pblog_20230525_launch',
        slug: 'start-schadenmelder-otterbach',
        title: 'Startsignal: behebes geht 2023 in den produktiven Betrieb',
        excerpt:
          'Im Mai 2023 wurde behebes als digitaler Schadenmelder erstmals produktiv ausgerollt.',
        contentMd: `## Der erste produktive Schritt

Mit dem Rollout am **25. Mai 2023** wurde aus einer Idee ein nutzbarer Verwaltungsdienst:

- digitale Erfassung statt Papierprozess
- strukturierte Ticketanlage
- nachvollziehbarer Bearbeitungsstatus für Bürgerinnen und Bürger`,
        status: 'published',
        publishedAt: '2023-05-25 09:00:00',
      },
      {
        id: 'pblog_202404_workflow',
        slug: 'workflow-fundament-im-betrieb',
        title: '2024: Prozesse werden zu Workflows',
        excerpt:
          'Wiederkehrende Bearbeitungsschritte wurden als belastbare Workflow-Bausteine modelliert.',
        contentMd: `## Von Einzelfallarbeit zu Systemarbeit

2024 lag der Fokus auf stabilen internen Abläufen:

- Übergaben wurden explizit gemacht
- Zuständigkeiten wurden klarer
- wiederkehrende Schritte wurden standardisiert`,
        status: 'published',
        publishedAt: '2024-04-12 11:30:00',
      },
      {
        id: 'pblog_202504_digitale_doerfer',
        slug: 'netzwerk-digitale-doerfer-rheinland-pfalz',
        title: 'Transferphase: Austausch im Netzwerk Digitale Dörfer',
        excerpt:
          'behebes wurde aktiv in den kommunalen Erfahrungsaustausch eingebracht.',
        contentMd: `## Lernen im Verbund

Im Frühjahr 2025 stand nicht nur Technik, sondern auch Transfer im Mittelpunkt:

- Austausch mit anderen Kommunen
- Vergleich realer Einsatzszenarien
- Schärfung der Produktziele aus der Praxis`,
        status: 'published',
        publishedAt: '2025-04-01 08:00:00',
      },
      {
        id: 'pblog_202512_old_platform_stop',
        slug: 'ehrliche-zurueckschau-projektstopp-ende-2025',
        title: 'Ende 2025: Das alte behebes wurde bewusst abgebrochen',
        excerpt:
          'Wir haben den damaligen Stand nicht schöngeredet und den alten Ansatz bewusst beendet.',
        contentMd: `## Warum wir gestoppt haben

Zum Jahresende 2025 wurde klar: Der damalige technische Zuschnitt war nicht tragfähig genug für den Anspruch an Stabilität und Wartbarkeit.

Die Entscheidung war bewusst und transparent:

- Altlasten nicht weiterziehen
- Betriebsrisiken nicht kaschieren
- Neuaufbau statt Flickwerk`,
        status: 'published',
        publishedAt: '2025-12-15 09:30:00',
      },
      {
        id: 'pblog_202601_technical_pause',
        slug: 'anfang-2026-technische-probleme-und-pause',
        title: 'Anfang 2026: Betrieb wegen massiver technischer Probleme eingestellt',
        excerpt:
          'Die harte Wahrheit: Anfang 2026 wurde der laufende Betrieb temporär vollständig gestoppt.',
        contentMd: `## Ehrliche Bestandsaufnahme

Zu Beginn von 2026 führten technische Probleme im Altstand zu einem klaren Schnitt.

Diese Pause war notwendig, um:

- Zuverlässigkeit neu aufzubauen
- Sicherheits- und Betriebsstandards zu erhöhen
- eine langfristig tragfähige Plattformbasis zu schaffen`,
        status: 'published',
        publishedAt: '2026-01-18 08:15:00',
      },
      {
        id: 'pblog_202602_rebuild',
        slug: 'neustart-2026-behebes-neu-und-besser',
        title: 'Neustart 2026: behebes wird von Grund auf besser gebaut',
        excerpt:
          'Seit Februar 2026 setzen wir auf einen sauberen Neuaufbau mit klarer Architektur, Multi-Mandanten-Basis und robuster Betriebsführung.',
        contentMd: `## Unsere Zusage für die nächste Ausbaustufe

Der Neustart folgt einem klaren Prinzip: **Stabilität vor Tempo, Qualität vor Kosmetik**.

Der neue Plattformaufbau richtet sich auf:

- klare Mandantenfähigkeit
- robuste Callback- und PWA-Pfade
- modulare Erweiterbarkeit
- zuverlässige operative Nutzung im Verwaltungsalltag`,
        status: 'published',
        publishedAt: '2026-02-22 14:20:00',
      },
    ];

    for (const post of seedPosts) {
      await db.run(
        `INSERT INTO platform_blog_posts (
          id, slug, title, excerpt, content_md, status, published_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          post.id,
          post.slug,
          post.title,
          post.excerpt,
          post.contentMd,
          post.status,
          post.publishedAt,
        ]
      );
    }
  } catch (error) {
    console.warn('Failed to seed platform blog posts:', error);
  }
}

async function syncPlatformHistorySeedPosts(db: AppDatabase): Promise<void> {
  try {
    const defaultPosts = [
      {
        id: 'pblog_20230525_launch',
        slug: 'start-schadenmelder-otterbach',
        title: 'Startsignal: behebes geht 2023 in den produktiven Betrieb',
        excerpt:
          'Im Mai 2023 wurde behebes als digitaler Schadenmelder erstmals produktiv ausgerollt.',
        contentMd: `## Der erste produktive Schritt

Mit dem Rollout am **25. Mai 2023** wurde aus einer Idee ein nutzbarer Verwaltungsdienst:

- digitale Erfassung statt Papierprozess
- strukturierte Ticketanlage
- nachvollziehbarer Bearbeitungsstatus für Bürgerinnen und Bürger`,
        status: 'published',
        publishedAt: '2023-05-25 09:00:00',
      },
      {
        id: 'pblog_202404_workflow',
        slug: 'workflow-fundament-im-betrieb',
        title: '2024: Prozesse werden zu Workflows',
        excerpt:
          'Wiederkehrende Bearbeitungsschritte wurden als belastbare Workflow-Bausteine modelliert.',
        contentMd: `## Von Einzelfallarbeit zu Systemarbeit

2024 lag der Fokus auf stabilen internen Abläufen:

- Übergaben wurden explizit gemacht
- Zuständigkeiten wurden klarer
- wiederkehrende Schritte wurden standardisiert`,
        status: 'published',
        publishedAt: '2024-04-12 11:30:00',
      },
      {
        id: 'pblog_202504_digitale_doerfer',
        slug: 'netzwerk-digitale-doerfer-rheinland-pfalz',
        title: 'Transferphase: Austausch im Netzwerk Digitale Dörfer',
        excerpt:
          'behebes wurde aktiv in den kommunalen Erfahrungsaustausch eingebracht.',
        contentMd: `## Lernen im Verbund

Im Frühjahr 2025 stand nicht nur Technik, sondern auch Transfer im Mittelpunkt:

- Austausch mit anderen Kommunen
- Vergleich realer Einsatzszenarien
- Schärfung der Produktziele aus der Praxis`,
        status: 'published',
        publishedAt: '2025-04-01 08:00:00',
      },
      {
        id: 'pblog_202512_old_platform_stop',
        slug: 'ehrliche-zurueckschau-projektstopp-ende-2025',
        title: 'Ende 2025: Das alte behebes wurde bewusst abgebrochen',
        excerpt:
          'Wir haben den damaligen Stand nicht schöngeredet und den alten Ansatz bewusst beendet.',
        contentMd: `## Warum wir gestoppt haben

Zum Jahresende 2025 wurde klar: Der damalige technische Zuschnitt war nicht tragfähig genug für den Anspruch an Stabilität und Wartbarkeit.

Die Entscheidung war bewusst und transparent:

- Altlasten nicht weiterziehen
- Betriebsrisiken nicht kaschieren
- Neuaufbau statt Flickwerk`,
        status: 'published',
        publishedAt: '2025-12-15 09:30:00',
      },
      {
        id: 'pblog_202601_technical_pause',
        slug: 'anfang-2026-technische-probleme-und-pause',
        title: 'Anfang 2026: Betrieb wegen massiver technischer Probleme eingestellt',
        excerpt:
          'Die harte Wahrheit: Anfang 2026 wurde der laufende Betrieb temporär vollständig gestoppt.',
        contentMd: `## Ehrliche Bestandsaufnahme

Zu Beginn von 2026 führten technische Probleme im Altstand zu einem klaren Schnitt.

Diese Pause war notwendig, um:

- Zuverlässigkeit neu aufzubauen
- Sicherheits- und Betriebsstandards zu erhöhen
- eine langfristig tragfähige Plattformbasis zu schaffen`,
        status: 'published',
        publishedAt: '2026-01-18 08:15:00',
      },
      {
        id: 'pblog_202602_rebuild',
        slug: 'neustart-2026-behebes-neu-und-besser',
        title: 'Neustart 2026: behebes wird von Grund auf besser gebaut',
        excerpt:
          'Seit Februar 2026 setzen wir auf einen sauberen Neuaufbau mit klarer Architektur, Multi-Mandanten-Basis und robuster Betriebsführung.',
        contentMd: `## Unsere Zusage für die nächste Ausbaustufe

Der Neustart folgt einem klaren Prinzip: **Stabilität vor Tempo, Qualität vor Kosmetik**.

Der neue Plattformaufbau richtet sich auf:

- klare Mandantenfähigkeit
- robuste Callback- und PWA-Pfade
- modulare Erweiterbarkeit
- zuverlässige operative Nutzung im Verwaltungsalltag`,
        status: 'published',
        publishedAt: '2026-02-22 14:20:00',
      },
    ];

    for (const post of defaultPosts) {
      const existing = await db.get<any>(
        `SELECT id, created_by_admin_id
         FROM platform_blog_posts
         WHERE id = ?
         LIMIT 1`,
        [post.id]
      );
      if (!existing?.id) {
        await db.run(
          `INSERT INTO platform_blog_posts (
            id, slug, title, excerpt, content_md, status, published_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [post.id, post.slug, post.title, post.excerpt, post.contentMd, post.status, post.publishedAt]
        );
        continue;
      }

      if (existing.created_by_admin_id) {
        continue;
      }

      await db.run(
        `UPDATE platform_blog_posts
         SET slug = ?,
             title = ?,
             excerpt = ?,
             content_md = ?,
             status = ?,
             published_at = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [post.slug, post.title, post.excerpt, post.contentMd, post.status, post.publishedAt, post.id]
      );
    }
  } catch (error) {
    console.warn('Failed to sync platform history seed posts:', error);
  }
}

const SQLITE_TO_MYSQL_MIGRATION_TABLE_ORDER = [
  'citizens',
  'submissions',
  'submission_images',
  'tickets',
  'ai_logs',
  'admin_users',
  'admin_password_resets',
  'admin_sessions',
  'tenants',
  'tenant_profiles',
  'tenant_settings_email',
  'admin_user_registration_requests',
  'org_unit_types',
  'org_units',
  'org_unit_closure',
  'admin_user_tenant_scopes',
  'admin_user_org_scopes',
  'ticket_collaborators',
  'workflow_internal_tasks',
  'workflow_internal_task_events',
  'citizen_accounts',
  'citizen_magic_links',
  'citizen_sessions',
  'citizen_auth_audit',
  'citizen_app_messages',
  'citizen_push_subscriptions',
  'admin_push_subscriptions',
  'admin_journal',
  'oauth_tokens',
  'knowledge_versions',
  'escalations',
  'ticket_validations',
  'workflow_validations',
  'ticket_comments',
  'workflow_data_requests',
  'workflow_data_request_answers',
  'llm_pseudonym_pools',
  'llm_pseudonym_mappings',
  'ticket_labels',
  'ticket_reporter_pseudonyms',
  'ai_situation_reports',
  'ai_analysis_memory',
  'admin_notifications',
  'admin_feed_tokens',
  'admin_api_tokens',
  'admin_passkeys',
  'admin_totp_factors',
  'admin_auth_challenges',
  'admin_chat_accounts',
  'admin_chat_custom_groups',
  'admin_chat_custom_group_members',
  'admin_chat_files',
  'admin_chat_messages',
  'admin_chatbot_messages',
  'admin_chat_message_reads',
  'admin_chat_message_reactions',
  'admin_chat_presence_settings',
  'admin_user_notification_preferences',
  'system_settings',
  'translations',
  'email_template_translations',
  'knowledge_category_library',
  'workflow_template_library',
  'email_template_library',
  'email_queue',
  'mailbox_messages',
  'mailbox_attachments',
  'ai_queue',
  'platform_blog_posts',
];

function quoteMysqlIdentifier(identifier: string): string {
  return `\`${String(identifier || '').replace(/`/g, '')}\``;
}

function quoteSqliteIdentifier(identifier: string): string {
  return `"${String(identifier || '').replace(/"/g, '""')}"`;
}

async function migrateSqliteDataToMysqlIfNeeded(db: AppDatabase, config: Config): Promise<void> {
  if (db.dialect !== 'mysql') return;
  if (!config.mysql.migrateFromSqlite) return;

  const migrationPath = path.resolve(config.mysql.migrationSourcePath || config.databasePath);
  if (!migrationPath || !fs.existsSync(migrationPath)) return;

  const stats = fs.statSync(migrationPath);
  if (!stats.isFile() || stats.size <= 0) return;

  const destinationTables = await db.all<any>(
    `SELECT
       table_name AS table_name
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_type = 'BASE TABLE'`
  );
  const destinationTableNames = destinationTables
    .map((row: any) => String(row?.table_name ?? row?.TABLE_NAME ?? '').trim())
    .filter(Boolean);

  if (!destinationTableNames.length) return;

  let destinationHasData = false;
  for (const tableName of destinationTableNames) {
    const countRow: any = await db.get(
      `SELECT COUNT(*) AS count FROM ${quoteMysqlIdentifier(tableName)}`
    );
    if (Number(countRow?.count || 0) > 0) {
      destinationHasData = true;
      break;
    }
  }
  if (destinationHasData) return;

  const sqliteSource = await open({
    filename: migrationPath,
    driver: sqlite3.Database,
  });

  try {
    const sourceTableRows = await sqliteSource.all(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
    );
    const sourceTableNames = new Set(
      (sourceTableRows || [])
        .map((row: any) => String(row?.name || '').trim())
        .filter(Boolean)
    );

    const orderedTables = [
      ...SQLITE_TO_MYSQL_MIGRATION_TABLE_ORDER.filter((table) => sourceTableNames.has(table)),
      ...Array.from(sourceTableNames).filter((table) => !SQLITE_TO_MYSQL_MIGRATION_TABLE_ORDER.includes(table)),
    ].filter((table) => destinationTableNames.includes(table));

    if (!orderedTables.length) return;

    await db.exec('SET FOREIGN_KEY_CHECKS = 0');
    await db.exec('BEGIN');

    try {
      for (const tableName of orderedTables) {
        const sourceCountRow: any = await sqliteSource.get(
          `SELECT COUNT(*) AS count FROM ${quoteSqliteIdentifier(tableName)}`
        );
        const sourceCount = Number(sourceCountRow?.count || 0);
        if (sourceCount <= 0) continue;

        const sourceColumnRows = await sqliteSource.all(
          `PRAGMA table_info(${quoteSqliteIdentifier(tableName)})`
        );
        const sourceColumns = (sourceColumnRows || [])
          .map((row: any) => String(row?.name || '').trim())
          .filter(Boolean);
        if (!sourceColumns.length) continue;

        const destinationColumnRows = await db.all<any>(
          `SELECT
             column_name AS column_name
           FROM information_schema.columns
           WHERE table_schema = DATABASE()
             AND table_name = ?
           ORDER BY ordinal_position`,
          [tableName]
        );
        const destinationColumns = new Set(
          destinationColumnRows
            .map((row: any) => String(row?.column_name ?? row?.COLUMN_NAME ?? '').trim())
            .filter(Boolean)
        );

        const commonColumns = sourceColumns.filter((column) => destinationColumns.has(column));
        if (!commonColumns.length) continue;

        const sqliteColumnSql = commonColumns.map((column) => quoteSqliteIdentifier(column)).join(', ');
        const mysqlColumnSql = commonColumns.map((column) => quoteMysqlIdentifier(column)).join(', ');

        const hasBinaryPayload = commonColumns.some((column) =>
          ['image_data'].includes(column)
        );
        const batchSize = hasBinaryPayload ? 10 : 200;
        let offset = 0;

        while (true) {
          const rows = await sqliteSource.all<any>(
            `SELECT ${sqliteColumnSql}
             FROM ${quoteSqliteIdentifier(tableName)}
             LIMIT ? OFFSET ?`,
            [batchSize, offset]
          );
          if (!rows || rows.length === 0) break;

          const placeholders = rows
            .map(() => `(${commonColumns.map(() => '?').join(', ')})`)
            .join(', ');
          const params: any[] = [];

          for (const row of rows) {
            for (const column of commonColumns) {
              params.push((row as any)?.[column] ?? null);
            }
          }

          await db.run(
            `INSERT INTO ${quoteMysqlIdentifier(tableName)} (${mysqlColumnSql}) VALUES ${placeholders}`,
            params
          );

          offset += rows.length;
        }
      }

      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    } finally {
      await db.exec('SET FOREIGN_KEY_CHECKS = 1');
    }
  } finally {
    await sqliteSource.close();
  }
}

async function ensureAdminSchema(db: AppDatabase) {
  try {
    const columns = await db.all(`PRAGMA table_info(admin_users)`);
    const columnNames = new Set(columns.map((col: any) => col.name));
    if (!columnNames.has('password_hash')) {
      await db.exec(`ALTER TABLE admin_users ADD COLUMN password_hash TEXT`);
    }
    if (!columnNames.has('role')) {
      await db.exec(`ALTER TABLE admin_users ADD COLUMN role TEXT DEFAULT 'SACHBEARBEITER'`);
    }
    if (!columnNames.has('active')) {
      await db.exec(`ALTER TABLE admin_users ADD COLUMN active BOOLEAN DEFAULT TRUE`);
    }
    if (!columnNames.has('email')) {
      await db.exec(`ALTER TABLE admin_users ADD COLUMN email TEXT`);
    }
    if (!columnNames.has('first_name')) {
      await db.exec(`ALTER TABLE admin_users ADD COLUMN first_name TEXT`);
    }
    if (!columnNames.has('last_name')) {
      await db.exec(`ALTER TABLE admin_users ADD COLUMN last_name TEXT`);
    }
    if (!columnNames.has('job_title')) {
      await db.exec(`ALTER TABLE admin_users ADD COLUMN job_title TEXT`);
    }
    if (!columnNames.has('work_phone')) {
      await db.exec(`ALTER TABLE admin_users ADD COLUMN work_phone TEXT`);
    }
    if (!columnNames.has('is_global_admin')) {
      await db.exec(`ALTER TABLE admin_users ADD COLUMN is_global_admin BOOLEAN DEFAULT FALSE`);
    }
    await db.exec(`UPDATE admin_users SET role = 'SACHBEARBEITER' WHERE role IS NULL OR TRIM(role) = ''`);
    await db.exec(`UPDATE admin_users SET role = 'ADMIN' WHERE UPPER(TRIM(role)) = 'SUPERADMIN'`);
    await db.exec(`UPDATE admin_users SET active = 1 WHERE active IS NULL`);
    await db.exec(
      `UPDATE admin_users
       SET is_global_admin = 1
       WHERE (is_global_admin IS NULL OR is_global_admin = 0)
         AND UPPER(TRIM(COALESCE(role, ''))) = 'ADMIN'`
    );
  } catch (error) {
    console.warn('Admin schema check failed:', error);
  }
}

async function ensureColumn(db: AppDatabase, table: string, column: string, type: string) {
  // Legacy schema evolution path: keep for compatibility until all historical
  // column mutations are fully represented as versioned migrations.
  try {
    const columns = await db.all(`PRAGMA table_info(${table})`);
    const hasColumn = columns.some((c: any) => c.name === column);
    if (!hasColumn) {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  } catch (error) {
    console.error(`Fehler beim Hinzufügen der Spalte ${column} in ${table}:`, error);
  }
}
