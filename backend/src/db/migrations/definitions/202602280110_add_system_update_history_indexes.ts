import type { MigrationDefinition } from '../types.js';
import { migrationCreateIndexIfNotExists } from '../helpers.js';

export const migration202602280110AddSystemUpdateHistoryIndexes: MigrationDefinition = {
  version: '202602280110',
  name: 'add_system_update_history_indexes',
  checksumSource: [
    'CREATE INDEX idx_system_update_preflight_history_created_at ON system_update_preflight_history(created_at)',
    'CREATE INDEX idx_system_update_preflight_history_admin_created ON system_update_preflight_history(admin_user_id, created_at)',
  ].join(';'),
  up: async (db) => {
    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'system_update_preflight_history',
      indexName: 'idx_system_update_preflight_history_created_at',
      columns: ['created_at'],
    });
    await migrationCreateIndexIfNotExists({
      db,
      tableName: 'system_update_preflight_history',
      indexName: 'idx_system_update_preflight_history_admin_created',
      columns: ['admin_user_id', 'created_at'],
    });
  },
};
