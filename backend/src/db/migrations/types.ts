import type { AppDatabase } from '../../db-adapter.js';

export interface MigrationDefinition {
  version: string;
  name: string;
  checksumSource?: string;
  up: (db: AppDatabase) => Promise<void>;
}

export interface MigrationExecutionResult {
  version: string;
  name: string;
  checksum: string;
  durationMs: number;
  success: boolean;
  skipped: boolean;
  reason?: string;
}
