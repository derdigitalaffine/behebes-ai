export interface UpdateBackupSnapshot {
  available: boolean;
  latestPath: string | null;
  latestAt: string | null;
  ageHours: number | null;
  artifactCount: number;
  requiredMaxAgeHours: number;
  isFresh: boolean;
}

export interface UpdateMigrationSnapshot {
  schemaMigrationsTable: boolean;
  appliedCount: number;
  migrationFilesCount: number;
  pendingCount: number;
  consistent: boolean;
}

export interface SystemUpdateStatus {
  currentVersion: string;
  latestTagVersion: string | null;
  git: {
    available: boolean;
    branch: string | null;
    headCommit: string | null;
    describe: string | null;
    dirty: boolean;
  };
  runtimeType: 'docker-compose' | 'node';
  backup: UpdateBackupSnapshot;
  migrations: UpdateMigrationSnapshot;
  checkedAt: string;
}

export interface UpdatePreflightCheckResult {
  ok: boolean;
  detail: string;
}

export interface UpdatePreflightReport {
  ok: boolean;
  blockedReasons: string[];
  checks: Record<string, UpdatePreflightCheckResult>;
  status: SystemUpdateStatus;
  durationMs: number;
  checkedAt: string;
}
