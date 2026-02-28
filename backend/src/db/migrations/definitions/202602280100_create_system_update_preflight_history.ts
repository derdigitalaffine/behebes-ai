import type { MigrationDefinition } from '../types.js';

export const migration202602280100CreateSystemUpdatePreflightHistory: MigrationDefinition = {
  version: '202602280100',
  name: 'create_system_update_preflight_history',
  checksumSource: [
    'CREATE TABLE IF NOT EXISTS system_update_preflight_history',
    '(id, admin_user_id, username, report_json, created_at)',
  ].join(' '),
  up: async (db) => {
    await db.run(
      `CREATE TABLE IF NOT EXISTS system_update_preflight_history (
        id VARCHAR(80) NOT NULL PRIMARY KEY,
        admin_user_id VARCHAR(80),
        username VARCHAR(255),
        report_json TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    );
  },
};
