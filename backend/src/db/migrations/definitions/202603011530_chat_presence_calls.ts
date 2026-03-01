import type { MigrationDefinition } from '../types.js';
import { migrationCreateIndexIfNotExists } from '../helpers.js';

export const migration202603011530ChatPresenceCalls: MigrationDefinition = {
  version: '202603011530',
  name: 'create_chat_presence_heartbeats_and_call_sessions',
  checksumSource: '202603011530:create_chat_presence_heartbeats_and_call_sessions:v1',
  up: async (db) => {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS admin_chat_presence_heartbeats (
        admin_user_id VARCHAR(80) NOT NULL,
        resource VARCHAR(80) NOT NULL,
        transport VARCHAR(32) NOT NULL DEFAULT 'xmpp',
        app_kind VARCHAR(32) NOT NULL DEFAULT 'admin',
        last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (admin_user_id, resource, app_kind)
      )
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS admin_chat_call_sessions (
        call_id VARCHAR(120) NOT NULL PRIMARY KEY,
        caller_user_id VARCHAR(80),
        callee_user_id VARCHAR(80),
        claimed_by_user_id VARCHAR(80),
        claimed_by_resource VARCHAR(80),
        state VARCHAR(32) NOT NULL DEFAULT 'proposed',
        started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ended_at DATETIME,
        expires_at DATETIME,
        meta_json TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'admin_chat_presence_heartbeats',
      indexName: 'idx_chat_presence_heartbeat_user_lastseen',
      columns: ['admin_user_id', 'last_seen_at'],
    });
    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'admin_chat_presence_heartbeats',
      indexName: 'idx_chat_presence_heartbeat_lastseen',
      columns: ['last_seen_at'],
    });

    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'admin_chat_call_sessions',
      indexName: 'idx_chat_call_sessions_state',
      columns: ['state', 'expires_at'],
    });
    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'admin_chat_call_sessions',
      indexName: 'idx_chat_call_sessions_callee_state',
      columns: ['callee_user_id', 'state', 'expires_at'],
    });
    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'admin_chat_call_sessions',
      indexName: 'idx_chat_call_sessions_claimed_user',
      columns: ['claimed_by_user_id', 'updated_at'],
    });
  },
};

