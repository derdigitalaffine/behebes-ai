import type { MigrationDefinition } from '../types.js';
import {
  migrationAddColumnIfMissing,
  migrationCreateIndexIfNotExists,
  migrationTableExists,
} from '../helpers.js';

export const migration202603011700ChatCallMediaExtensions: MigrationDefinition = {
  version: '202603011700',
  name: 'extend_chat_call_sessions_for_media_and_first_catch',
  checksumSource: '202603011700:extend_chat_call_sessions_for_media_and_first_catch:v1',
  up: async (db) => {
    const callTableExists = await migrationTableExists(db, 'admin_chat_call_sessions');
    if (!callTableExists) return;

    await migrationAddColumnIfMissing({
      db,
      tableName: 'admin_chat_call_sessions',
      columnName: 'media_type',
      columnDefinition: "VARCHAR(16) NOT NULL DEFAULT 'audio'",
    });
    await migrationAddColumnIfMissing({
      db,
      tableName: 'admin_chat_call_sessions',
      columnName: 'client_connection_id',
      columnDefinition: 'VARCHAR(120)',
    });
    await migrationAddColumnIfMissing({
      db,
      tableName: 'admin_chat_call_sessions',
      columnName: 'ended_reason',
      columnDefinition: 'VARCHAR(120)',
    });

    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'admin_chat_call_sessions',
      indexName: 'idx_chat_call_sessions_call_state',
      columns: ['call_id', 'state'],
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
      indexName: 'idx_chat_call_sessions_claimed_resource_state',
      columns: ['claimed_by_user_id', 'claimed_by_resource', 'state'],
    });
  },
};

