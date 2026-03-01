import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Alert, Button, Chip, Stack, TextField, Typography } from '@mui/material';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { getAdminToken } from '../lib/auth';
import {
  SmartTable,
  type SmartTableColumnDef,
} from '../modules/smart-table';
import './SystemInfos.css';

interface PackageMetadata {
  name: string;
  version: string;
  description?: string;
  path: string;
  available: boolean;
}

interface BuildHistoryEntry {
  commit: string;
  shortCommit: string;
  authoredAt: string;
  author: string;
  subject: string;
}

interface FeatureHistoryEntry {
  id: string;
  createdAt: string;
  eventType: string;
  severity: string;
  username: string;
  method: string;
  path: string;
  details: unknown;
}

interface SystemSessionEntry {
  id: string;
  adminUserId: string;
  username: string;
  role: string;
  ipAddress: string;
  userAgent: string;
  rememberMe: boolean;
  issuedAt: string | null;
  lastSeenAt: string | null;
  expiresAt: string | null;
  isExpired: boolean;
}

interface FeedTokenEntry {
  id: string;
  adminUserId: string;
  username: string;
  role: string;
  scope: string;
  tokenMasked: string;
  tokenLength: number;
  createdAt: string | null;
  lastUsedAt: string | null;
}

interface OAuthTokenEntry {
  id: string;
  provider: string;
  accountId: string;
  expiresAt: string | null;
  expiresAtMs: number | null;
  isExpired: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

interface ValidationTokenEntry {
  id: string;
  ticketId: string;
  submissionId?: string;
  executionId?: string;
  taskId?: string;
  citizenEmail?: string;
  recipientEmail?: string;
  tokenMasked: string;
  tokenLength: number;
  createdAt: string | null;
  expiresAt: string | null;
  isExpired: boolean;
}

interface DatabaseStructureColumn {
  cid: number;
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
  primaryKeyOrder: number;
}

interface DatabaseStructureForeignKey {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  onUpdate: string;
  onDelete: string;
  match: string;
}

interface DatabaseStructureTable {
  name: string;
  rowCount: number;
  createSql: string;
  columns: DatabaseStructureColumn[];
  foreignKeys: DatabaseStructureForeignKey[];
}

interface SystemInfoResponse {
  generatedAt: string;
  warnings: string[];
  backend: {
    framework: string;
    runtime: {
      nodeVersion: string;
      pid: number;
      uptimeSeconds: number;
      startedAt: string;
      platform: string;
      arch: string;
      timezone: string;
      memory: {
        rssBytes: number;
        heapTotalBytes: number;
        heapUsedBytes: number;
        externalBytes: number;
      };
    };
    environment: {
      nodeEnv: string;
      port: number;
      trustProxy: boolean | number;
      frontendUrl: string;
      adminUrl: string;
    };
    database: {
      client: 'sqlite' | 'mysql';
      sqlitePath: string | null;
      mysql:
        | {
            host: string;
            port: number;
            database: string;
            migrationSourcePath: string;
          }
        | null;
    };
    ai: {
      provider: string;
      model: string;
      providerSource: string;
      modelSource: string;
      credentials: {
        askcodiBaseUrl: string;
        hasOpenaiClientId: boolean;
        hasOpenaiClientSecret: boolean;
        hasAskcodiApiKey: boolean;
        openaiClientIdSource: string;
        openaiClientSecretSource: string;
        askcodiApiKeySource: string;
        askcodiBaseUrlSource: string;
      };
    };
  };
  versions: {
    workspace: PackageMetadata;
    backend: PackageMetadata;
    admin: PackageMetadata;
    frontend: PackageMetadata;
    ops: PackageMetadata;
  };
  build: {
    appVersion: string | null;
    envBuildId: string | null;
    envBuildTime: string | null;
    envCommitRef: string | null;
    git: {
      available: boolean;
      branch: string | null;
      headCommit: string | null;
      describe: string | null;
      fetchedAt: string;
      error: string | null;
    };
  };
  sessions: {
    totalCount: number;
    activeCount: number;
    activeButExpiredCount: number;
    active: SystemSessionEntry[];
  };
  tokens: {
    summary: {
      openFeedTokens: number;
      openOauthTokens: number;
      storedOauthTokens: number;
      openTicketValidationTokens: number;
      openWorkflowValidationTokens: number;
    };
    feedTokens: FeedTokenEntry[];
    oauthTokens: OAuthTokenEntry[];
    ticketValidationTokens: ValidationTokenEntry[];
    workflowValidationTokens: ValidationTokenEntry[];
  };
  databaseStructure: {
    database: {
      pageCount: number;
      pageSize: number;
      sizeBytes: number;
      sizeMb: number;
    };
    tableCount: number;
    tables: DatabaseStructureTable[];
    generatedAt: string;
  };
  buildHistory: BuildHistoryEntry[];
  featureHistory: FeatureHistoryEntry[];
}

interface SystemFactRow {
  id: string;
  section: string;
  key: string;
  value: string;
}

interface VersionRow {
  id: string;
  component: string;
  packageName: string;
  version: string;
  available: string;
  path: string;
  description: string;
}

interface GitInfoRow {
  id: string;
  release: string;
  appVersion: string;
  buildId: string;
  buildTime: string;
  envCommit: string;
  branch: string;
  headCommit: string;
  describe: string;
  fetchedAt: string;
  gitAvailable: string;
  gitError: string;
}

interface SessionRow {
  id: string;
  user: string;
  role: string;
  ipAddress: string;
  userAgent: string;
  rememberMe: string;
  issuedAt: string;
  lastSeenAt: string;
  expiresAt: string;
  status: string;
}

interface FeedTokenRow {
  id: string;
  scope: string;
  user: string;
  role: string;
  tokenMasked: string;
  tokenLength: number;
  createdAt: string;
  lastUsedAt: string;
}

interface OAuthTokenRow {
  id: string;
  provider: string;
  accountId: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

interface ValidationTokenRow {
  id: string;
  ticketId: string;
  submissionId: string;
  executionId: string;
  taskId: string;
  email: string;
  tokenMasked: string;
  tokenLength: number;
  status: string;
  createdAt: string;
  expiresAt: string;
}

interface DatabaseTableRow {
  id: string;
  name: string;
  rowCount: number;
  columnCount: number;
  foreignKeyCount: number;
}

interface DatabaseColumnRow {
  id: string;
  name: string;
  type: string;
  primaryKeyOrder: string;
  notNull: string;
  defaultValue: string;
}

interface DatabaseForeignKeyRow {
  id: string;
  from: string;
  table: string;
  to: string;
  onUpdate: string;
  onDelete: string;
  match: string;
}

interface BuildHistoryRow {
  id: string;
  authoredAt: string;
  shortCommit: string;
  commit: string;
  author: string;
  subject: string;
}

interface FeatureHistoryRow {
  id: string;
  createdAt: string;
  eventType: string;
  severity: string;
  username: string;
  method: string;
  path: string;
  detailsPreview: string;
}

const formatDateTime = (value?: string | null): string => {
  if (!value) return '–';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('de-DE');
};

const formatInteger = (value: number): string => {
  return new Intl.NumberFormat('de-DE').format(Number.isFinite(value) ? value : 0);
};

const formatBytes = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let current = value;
  let idx = 0;
  while (current >= 1024 && idx < units.length - 1) {
    current /= 1024;
    idx += 1;
  }
  return `${current.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
};

const formatUptime = (seconds: number): string => {
  const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
};

const formatJsonPreview = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '–';
  if (typeof value === 'string') {
    return value.length > 250 ? `${value.slice(0, 250)}…` : value;
  }
  try {
    const serialized = JSON.stringify(value);
    if (!serialized) return '–';
    return serialized.length > 250 ? `${serialized.slice(0, 250)}…` : serialized;
  } catch {
    return String(value);
  }
};

const asYesNo = (value: boolean): string => (value ? 'ja' : 'nein');

const renderPackageVersion = (entry: PackageMetadata) => `${entry.name}@${entry.version}`;

const SystemInfos: React.FC = () => {
  const [data, setData] = useState<SystemInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [tableSearch, setTableSearch] = useState('');
  const [selectedTableName, setSelectedTableName] = useState('');

  const currentToken = getAdminToken();
  const tableUserId = currentToken || 'anonymous';

  const loadSystemInfos = useCallback(async (silent = false) => {
    const token = getAdminToken();
    if (!token) {
      setError('Kein Admin-Token gefunden. Bitte erneut anmelden.');
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      const response = await axios.get<SystemInfoResponse>('/api/admin/system-info', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const next = response.data;
      setData(next);
      setSelectedTableName((current) => {
        const names = new Set((next.databaseStructure.tables || []).map((table) => table.name));
        if (current && names.has(current)) return current;
        return next.databaseStructure.tables[0]?.name || '';
      });
      setError('');
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.message || 'Systeminfos konnten nicht geladen werden.');
      } else {
        setError('Systeminfos konnten nicht geladen werden.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadSystemInfos(false);
  }, [loadSystemInfos]);

  const filteredTables = useMemo(() => {
    if (!data) return [];
    const query = tableSearch.trim().toLowerCase();
    if (!query) return data.databaseStructure.tables;
    return data.databaseStructure.tables.filter((table) => {
      if (table.name.toLowerCase().includes(query)) return true;
      return table.columns.some((column) => column.name.toLowerCase().includes(query));
    });
  }, [data, tableSearch]);

  useEffect(() => {
    if (!filteredTables.length) {
      setSelectedTableName('');
      return;
    }
    if (!selectedTableName || !filteredTables.some((table) => table.name === selectedTableName)) {
      setSelectedTableName(filteredTables[0].name);
    }
  }, [filteredTables, selectedTableName]);

  const selectedTable = useMemo(
    () => filteredTables.find((table) => table.name === selectedTableName) || null,
    [filteredTables, selectedTableName]
  );

  const totalOpenTokens = useMemo(() => {
    if (!data) return 0;
    const summary = data.tokens.summary;
    return (
      Number(summary.openFeedTokens || 0) +
      Number(summary.openOauthTokens || 0) +
      Number(summary.openTicketValidationTokens || 0) +
      Number(summary.openWorkflowValidationTokens || 0)
    );
  }, [data]);

  const systemFacts = useMemo<SystemFactRow[]>(() => {
    if (!data) return [];
    const mysql = data.backend.database.mysql;
    const rows: Array<Omit<SystemFactRow, 'id'>> = [
      { section: 'Runtime', key: 'Framework', value: data.backend.framework },
      { section: 'Runtime', key: 'Node', value: data.backend.runtime.nodeVersion },
      { section: 'Runtime', key: 'PID', value: String(data.backend.runtime.pid) },
      { section: 'Runtime', key: 'Uptime', value: formatUptime(data.backend.runtime.uptimeSeconds) },
      { section: 'Runtime', key: 'Gestartet', value: formatDateTime(data.backend.runtime.startedAt) },
      { section: 'Runtime', key: 'Plattform', value: `${data.backend.runtime.platform}/${data.backend.runtime.arch}` },
      { section: 'Runtime', key: 'Zeitzone', value: data.backend.runtime.timezone },
      { section: 'Runtime', key: 'RSS', value: formatBytes(data.backend.runtime.memory.rssBytes) },
      { section: 'Runtime', key: 'Heap total', value: formatBytes(data.backend.runtime.memory.heapTotalBytes) },
      { section: 'Runtime', key: 'Heap genutzt', value: formatBytes(data.backend.runtime.memory.heapUsedBytes) },
      { section: 'Runtime', key: 'External', value: formatBytes(data.backend.runtime.memory.externalBytes) },

      { section: 'Backend', key: 'NODE_ENV', value: data.backend.environment.nodeEnv },
      { section: 'Backend', key: 'Port', value: String(data.backend.environment.port) },
      { section: 'Backend', key: 'Trust Proxy', value: String(data.backend.environment.trustProxy) },
      { section: 'Backend', key: 'Datenbank-Client', value: data.backend.database.client },
      {
        section: 'Backend',
        key: 'SQLite Pfad',
        value: data.backend.database.client === 'sqlite' ? data.backend.database.sqlitePath || '–' : '–',
      },
      { section: 'Backend', key: 'MySQL Host', value: mysql?.host || '–' },
      { section: 'Backend', key: 'MySQL Port', value: mysql?.port ? String(mysql.port) : '–' },
      { section: 'Backend', key: 'MySQL DB', value: mysql?.database || '–' },
      { section: 'Backend', key: 'Migrationspfad', value: mysql?.migrationSourcePath || '–' },
      { section: 'Backend', key: 'Frontend URL', value: data.backend.environment.frontendUrl || '–' },
      { section: 'Backend', key: 'Admin URL', value: data.backend.environment.adminUrl || '–' },

      { section: 'KI', key: 'Provider', value: data.backend.ai.provider || '–' },
      { section: 'KI', key: 'Modell', value: data.backend.ai.model || '–' },
      { section: 'KI', key: 'Provider Quelle', value: data.backend.ai.providerSource || '–' },
      { section: 'KI', key: 'Modell Quelle', value: data.backend.ai.modelSource || '–' },
      { section: 'KI', key: 'OpenAI Client ID', value: data.backend.ai.credentials.hasOpenaiClientId ? 'gesetzt' : 'leer' },
      { section: 'KI', key: 'OpenAI Secret', value: data.backend.ai.credentials.hasOpenaiClientSecret ? 'gesetzt' : 'leer' },
      { section: 'KI', key: 'AskCodi API Key', value: data.backend.ai.credentials.hasAskcodiApiKey ? 'gesetzt' : 'leer' },
      { section: 'KI', key: 'OpenAI Client ID Quelle', value: data.backend.ai.credentials.openaiClientIdSource || '–' },
      { section: 'KI', key: 'OpenAI Secret Quelle', value: data.backend.ai.credentials.openaiClientSecretSource || '–' },
      { section: 'KI', key: 'AskCodi Key Quelle', value: data.backend.ai.credentials.askcodiApiKeySource || '–' },
      { section: 'KI', key: 'AskCodi Base URL', value: data.backend.ai.credentials.askcodiBaseUrl || '–' },
      { section: 'KI', key: 'AskCodi URL Quelle', value: data.backend.ai.credentials.askcodiBaseUrlSource || '–' },
    ];
    return rows.map((row, index) => ({
      id: `fact-${index}-${row.section}-${row.key}`,
      ...row,
    }));
  }, [data]);

  const versionsRows = useMemo<VersionRow[]>(() => {
    if (!data) return [];
    const entries: Array<[string, PackageMetadata]> = [
      ['Workspace', data.versions.workspace],
      ['Backend', data.versions.backend],
      ['Admin', data.versions.admin],
      ['Frontend', data.versions.frontend],
      ['Ops', data.versions.ops],
    ];
    return entries.map(([component, entry]) => ({
      id: component.toLowerCase(),
      component,
      packageName: entry.name,
      version: entry.version,
      available: entry.available ? 'ja' : 'nein',
      path: entry.path || '–',
      description: entry.description || '–',
    }));
  }, [data]);

  const gitInfoRows = useMemo<GitInfoRow[]>(() => {
    if (!data) return [];
    const release = data.build.appVersion ? `v${data.build.appVersion}` : renderPackageVersion(data.versions.workspace);
    return [
      {
        id: 'git-build',
        release,
        appVersion: data.build.appVersion || data.versions.workspace.version,
        buildId: data.build.envBuildId || '–',
        buildTime: formatDateTime(data.build.envBuildTime),
        envCommit: data.build.envCommitRef || '–',
        branch: data.build.git.branch || '–',
        headCommit: data.build.git.headCommit || '–',
        describe: data.build.git.describe || '–',
        fetchedAt: formatDateTime(data.build.git.fetchedAt),
        gitAvailable: data.build.git.available ? 'ja' : 'nein',
        gitError: data.build.git.error || '–',
      },
    ];
  }, [data]);

  const sessionRows = useMemo<SessionRow[]>(() => {
    if (!data) return [];
    return data.sessions.active.map((entry) => ({
      id: entry.id,
      user: entry.username || entry.adminUserId,
      role: entry.role || '–',
      ipAddress: entry.ipAddress || '–',
      userAgent: entry.userAgent || '–',
      rememberMe: entry.rememberMe ? 'ja' : 'nein',
      issuedAt: formatDateTime(entry.issuedAt),
      lastSeenAt: formatDateTime(entry.lastSeenAt),
      expiresAt: entry.expiresAt ? formatDateTime(entry.expiresAt) : 'ohne Ablauf',
      status: entry.isExpired ? 'abgelaufen' : 'aktiv',
    }));
  }, [data]);

  const feedTokenRows = useMemo<FeedTokenRow[]>(() => {
    if (!data) return [];
    return data.tokens.feedTokens.map((entry) => ({
      id: entry.id,
      scope: entry.scope || '–',
      user: entry.username || entry.adminUserId,
      role: entry.role || '–',
      tokenMasked: entry.tokenMasked || '–',
      tokenLength: Number(entry.tokenLength || 0),
      createdAt: formatDateTime(entry.createdAt),
      lastUsedAt: formatDateTime(entry.lastUsedAt),
    }));
  }, [data]);

  const oauthTokenRows = useMemo<OAuthTokenRow[]>(() => {
    if (!data) return [];
    return data.tokens.oauthTokens.map((entry) => ({
      id: entry.id,
      provider: entry.provider || '–',
      accountId: entry.accountId || '–',
      status: entry.isExpired ? 'abgelaufen' : 'aktiv',
      expiresAt: entry.expiresAt ? formatDateTime(entry.expiresAt) : 'kein Ablauf',
      createdAt: formatDateTime(entry.createdAt),
      updatedAt: formatDateTime(entry.updatedAt),
    }));
  }, [data]);

  const ticketValidationRows = useMemo<ValidationTokenRow[]>(() => {
    if (!data) return [];
    return data.tokens.ticketValidationTokens.map((entry) => ({
      id: entry.id,
      ticketId: entry.ticketId || '–',
      submissionId: entry.submissionId || '–',
      executionId: entry.executionId || '–',
      taskId: entry.taskId || '–',
      email: entry.citizenEmail || '–',
      tokenMasked: entry.tokenMasked || '–',
      tokenLength: Number(entry.tokenLength || 0),
      status: entry.isExpired ? 'abgelaufen' : 'aktiv',
      createdAt: formatDateTime(entry.createdAt),
      expiresAt: entry.expiresAt ? formatDateTime(entry.expiresAt) : 'kein Ablauf',
    }));
  }, [data]);

  const workflowValidationRows = useMemo<ValidationTokenRow[]>(() => {
    if (!data) return [];
    return data.tokens.workflowValidationTokens.map((entry) => ({
      id: entry.id,
      ticketId: entry.ticketId || '–',
      submissionId: entry.submissionId || '–',
      executionId: entry.executionId || '–',
      taskId: entry.taskId || '–',
      email: entry.recipientEmail || '–',
      tokenMasked: entry.tokenMasked || '–',
      tokenLength: Number(entry.tokenLength || 0),
      status: entry.isExpired ? 'abgelaufen' : 'aktiv',
      createdAt: formatDateTime(entry.createdAt),
      expiresAt: entry.expiresAt ? formatDateTime(entry.expiresAt) : 'kein Ablauf',
    }));
  }, [data]);

  const databaseTableRows = useMemo<DatabaseTableRow[]>(() => {
    return filteredTables.map((table) => ({
      id: table.name,
      name: table.name,
      rowCount: Number(table.rowCount || 0),
      columnCount: Number(table.columns.length || 0),
      foreignKeyCount: Number(table.foreignKeys.length || 0),
    }));
  }, [filteredTables]);

  const selectedColumnRows = useMemo<DatabaseColumnRow[]>(() => {
    if (!selectedTable) return [];
    return selectedTable.columns.map((column) => ({
      id: `${selectedTable.name}-${column.cid}-${column.name}`,
      name: column.name,
      type: column.type || '–',
      primaryKeyOrder: column.primaryKeyOrder > 0 ? String(column.primaryKeyOrder) : '–',
      notNull: asYesNo(column.notNull),
      defaultValue: column.defaultValue ?? '–',
    }));
  }, [selectedTable]);

  const selectedForeignKeyRows = useMemo<DatabaseForeignKeyRow[]>(() => {
    if (!selectedTable) return [];
    return selectedTable.foreignKeys.map((fk) => ({
      id: `${selectedTable.name}-fk-${fk.id}-${fk.seq}`,
      from: fk.from || '–',
      table: fk.table || '–',
      to: fk.to || '–',
      onUpdate: fk.onUpdate || '–',
      onDelete: fk.onDelete || '–',
      match: fk.match || '–',
    }));
  }, [selectedTable]);

  const buildHistoryRows = useMemo<BuildHistoryRow[]>(() => {
    if (!data) return [];
    return data.buildHistory.map((entry, index) => ({
      id: `${entry.commit}-${entry.authoredAt}-${index}`,
      authoredAt: formatDateTime(entry.authoredAt),
      shortCommit: entry.shortCommit || '–',
      commit: entry.commit || '–',
      author: entry.author || '–',
      subject: entry.subject || '–',
    }));
  }, [data]);

  const featureHistoryRows = useMemo<FeatureHistoryRow[]>(() => {
    if (!data) return [];
    return data.featureHistory.map((entry) => ({
      id: entry.id,
      createdAt: formatDateTime(entry.createdAt),
      eventType: entry.eventType || '–',
      severity: entry.severity || '–',
      username: entry.username || '–',
      method: entry.method || '–',
      path: entry.path || '–',
      detailsPreview: formatJsonPreview(entry.details),
    }));
  }, [data]);

  const systemFactsColumns = useMemo<SmartTableColumnDef<SystemFactRow>[]>(
    () => [
      { field: 'section', headerName: 'Bereich', minWidth: 160 },
      { field: 'key', headerName: 'Schlüssel', minWidth: 220, flex: 1 },
      { field: 'value', headerName: 'Wert', minWidth: 260, flex: 1 },
    ],
    []
  );

  const versionsColumns = useMemo<SmartTableColumnDef<VersionRow>[]>(
    () => [
      { field: 'component', headerName: 'Komponente', minWidth: 140 },
      { field: 'packageName', headerName: 'Paket', minWidth: 190 },
      { field: 'version', headerName: 'Version', minWidth: 120 },
      { field: 'available', headerName: 'Verfügbar', minWidth: 110 },
      { field: 'path', headerName: 'Pfad', minWidth: 260, flex: 1 },
      { field: 'description', headerName: 'Beschreibung', minWidth: 240, flex: 1 },
    ],
    []
  );

  const gitInfoColumns = useMemo<SmartTableColumnDef<GitInfoRow>[]>(
    () => [
      { field: 'release', headerName: 'Release', minWidth: 140 },
      { field: 'appVersion', headerName: 'App-Version', minWidth: 120 },
      { field: 'buildId', headerName: 'Build-ID', minWidth: 180 },
      { field: 'buildTime', headerName: 'Build-Zeit', minWidth: 170 },
      { field: 'envCommit', headerName: 'Commit (ENV)', minWidth: 180 },
      { field: 'branch', headerName: 'Git Branch', minWidth: 140 },
      { field: 'headCommit', headerName: 'Git Head Commit', minWidth: 220 },
      { field: 'describe', headerName: 'Git Describe', minWidth: 180 },
      { field: 'fetchedAt', headerName: 'Git aktualisiert', minWidth: 170 },
      { field: 'gitAvailable', headerName: 'Git verfügbar', minWidth: 120 },
      { field: 'gitError', headerName: 'Git Fehler', minWidth: 260, flex: 1 },
    ],
    []
  );

  const sessionColumns = useMemo<SmartTableColumnDef<SessionRow>[]>(
    () => [
      { field: 'user', headerName: 'Benutzer', minWidth: 170 },
      { field: 'role', headerName: 'Rolle', minWidth: 120 },
      { field: 'ipAddress', headerName: 'IP', minWidth: 140 },
      { field: 'rememberMe', headerName: 'Remember', minWidth: 100 },
      { field: 'status', headerName: 'Status', minWidth: 110 },
      { field: 'issuedAt', headerName: 'Ausgestellt', minWidth: 170 },
      { field: 'lastSeenAt', headerName: 'Letzte Aktivität', minWidth: 170 },
      { field: 'expiresAt', headerName: 'Ablauf', minWidth: 170 },
      { field: 'userAgent', headerName: 'User-Agent', minWidth: 300, flex: 1 },
    ],
    []
  );

  const feedTokenColumns = useMemo<SmartTableColumnDef<FeedTokenRow>[]>(
    () => [
      { field: 'scope', headerName: 'Scope', minWidth: 140 },
      { field: 'user', headerName: 'Benutzer', minWidth: 170 },
      { field: 'role', headerName: 'Rolle', minWidth: 120 },
      { field: 'tokenMasked', headerName: 'Token', minWidth: 180 },
      { field: 'tokenLength', headerName: 'Länge', minWidth: 90 },
      { field: 'createdAt', headerName: 'Erstellt', minWidth: 170 },
      { field: 'lastUsedAt', headerName: 'Zuletzt genutzt', minWidth: 170 },
    ],
    []
  );

  const oauthTokenColumns = useMemo<SmartTableColumnDef<OAuthTokenRow>[]>(
    () => [
      { field: 'provider', headerName: 'Provider', minWidth: 130 },
      { field: 'accountId', headerName: 'Account', minWidth: 190 },
      { field: 'status', headerName: 'Status', minWidth: 120 },
      { field: 'expiresAt', headerName: 'Ablauf', minWidth: 170 },
      { field: 'createdAt', headerName: 'Erstellt', minWidth: 170 },
      { field: 'updatedAt', headerName: 'Aktualisiert', minWidth: 170 },
    ],
    []
  );

  const validationTokenColumns = useMemo<SmartTableColumnDef<ValidationTokenRow>[]>(
    () => [
      { field: 'ticketId', headerName: 'Ticket', minWidth: 130 },
      { field: 'submissionId', headerName: 'Submission', minWidth: 150 },
      { field: 'executionId', headerName: 'Execution', minWidth: 150 },
      { field: 'taskId', headerName: 'Task', minWidth: 150 },
      { field: 'email', headerName: 'E-Mail', minWidth: 220, flex: 1 },
      { field: 'tokenMasked', headerName: 'Token', minWidth: 180 },
      { field: 'tokenLength', headerName: 'Länge', minWidth: 90 },
      { field: 'status', headerName: 'Status', minWidth: 120 },
      { field: 'createdAt', headerName: 'Erstellt', minWidth: 170 },
      { field: 'expiresAt', headerName: 'Ablauf', minWidth: 170 },
    ],
    []
  );

  const databaseTableColumns = useMemo<SmartTableColumnDef<DatabaseTableRow>[]>(
    () => [
      { field: 'name', headerName: 'Tabelle', minWidth: 220, flex: 1 },
      { field: 'rowCount', headerName: 'Zeilen', minWidth: 120 },
      { field: 'columnCount', headerName: 'Spalten', minWidth: 120 },
      { field: 'foreignKeyCount', headerName: 'Foreign Keys', minWidth: 140 },
    ],
    []
  );

  const databaseColumnColumns = useMemo<SmartTableColumnDef<DatabaseColumnRow>[]>(
    () => [
      { field: 'name', headerName: 'Name', minWidth: 220, flex: 1 },
      { field: 'type', headerName: 'Typ', minWidth: 160 },
      { field: 'primaryKeyOrder', headerName: 'PK', minWidth: 70 },
      { field: 'notNull', headerName: 'Not Null', minWidth: 90 },
      { field: 'defaultValue', headerName: 'Default', minWidth: 180, flex: 1 },
    ],
    []
  );

  const databaseForeignKeyColumns = useMemo<SmartTableColumnDef<DatabaseForeignKeyRow>[]>(
    () => [
      { field: 'from', headerName: 'Von', minWidth: 130 },
      { field: 'table', headerName: 'Nach Tabelle', minWidth: 180 },
      { field: 'to', headerName: 'Nach Spalte', minWidth: 160 },
      { field: 'onUpdate', headerName: 'On Update', minWidth: 130 },
      { field: 'onDelete', headerName: 'On Delete', minWidth: 130 },
      { field: 'match', headerName: 'Match', minWidth: 100 },
    ],
    []
  );

  const buildHistoryColumns = useMemo<SmartTableColumnDef<BuildHistoryRow>[]>(
    () => [
      { field: 'authoredAt', headerName: 'Zeit', minWidth: 170 },
      { field: 'shortCommit', headerName: 'Kurz-Commit', minWidth: 140 },
      { field: 'commit', headerName: 'Commit', minWidth: 220 },
      { field: 'author', headerName: 'Autor', minWidth: 190 },
      { field: 'subject', headerName: 'Beschreibung', minWidth: 340, flex: 1 },
    ],
    []
  );

  const featureHistoryColumns = useMemo<SmartTableColumnDef<FeatureHistoryRow>[]>(
    () => [
      { field: 'createdAt', headerName: 'Zeit', minWidth: 170 },
      { field: 'eventType', headerName: 'Event', minWidth: 170 },
      { field: 'severity', headerName: 'Severity', minWidth: 110 },
      { field: 'username', headerName: 'Benutzer', minWidth: 170 },
      { field: 'method', headerName: 'Methode', minWidth: 110 },
      { field: 'path', headerName: 'Pfad', minWidth: 260, flex: 1 },
      { field: 'detailsPreview', headerName: 'Details', minWidth: 340, flex: 1 },
    ],
    []
  );

  if (loading) {
    return (
      <div className="systeminfos-page">
        <div className="systeminfos-loading">Systeminfos werden geladen…</div>
      </div>
    );
  }

  return (
    <div className="systeminfos-page">
      <div className="systeminfos-toolbar">
        <div>
          <h2>Systeminfos</h2>
          <p>Letzte Aktualisierung: {formatDateTime(data?.generatedAt)}</p>
        </div>
        <Button
          type="button"
          variant="outlined"
          color="secondary"
          startIcon={<RefreshRoundedIcon />}
          onClick={() => void loadSystemInfos(true)}
          disabled={refreshing}
        >
          {refreshing ? 'Aktualisiere…' : 'Neu laden'}
        </Button>
      </div>

      {error ? <Alert severity="error">{error}</Alert> : null}

      {data?.warnings?.length ? (
        <Alert severity="warning">
          <Stack spacing={0.4}>
            {data.warnings.map((warning) => (
              <span key={warning}>{warning}</span>
            ))}
          </Stack>
        </Alert>
      ) : null}

      {data ? (
        <>
          <section className="systeminfos-kpis">
            <article>
              <span>Aktive Sessions</span>
              <strong>{formatInteger(data.sessions.activeCount)}</strong>
              <small>Gesamt: {formatInteger(data.sessions.totalCount)}</small>
            </article>
            <article>
              <span>Offene Tokens</span>
              <strong>{formatInteger(totalOpenTokens)}</strong>
              <small>OAuth gespeichert: {formatInteger(data.tokens.summary.storedOauthTokens)}</small>
            </article>
            <article>
              <span>Datenbankgröße</span>
              <strong>{formatBytes(data.databaseStructure.database.sizeBytes)}</strong>
              <small>Seiten: {formatInteger(data.databaseStructure.database.pageCount)}</small>
            </article>
            <article>
              <span>Git-Stand</span>
              <strong>{data.build.git.branch || '–'}</strong>
              <small>{data.build.git.headCommit ? data.build.git.headCommit.slice(0, 12) : 'kein Commit'}</small>
            </article>
          </section>

          <section className="systeminfos-section">
            <div className="systeminfos-section-head">
              <h3>Version & Git</h3>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                <Chip
                  size="small"
                  label={data.build.appVersion ? `Release v${data.build.appVersion}` : renderPackageVersion(data.versions.workspace)}
                  color="primary"
                  variant="outlined"
                />
                <Chip
                  size="small"
                  label={`Branch: ${data.build.git.branch || '–'}`}
                  color="secondary"
                  variant="outlined"
                />
                <Chip
                  size="small"
                  label={`Commit: ${data.build.git.headCommit ? data.build.git.headCommit.slice(0, 12) : data.build.envCommitRef || '–'}`}
                  color="secondary"
                  variant="outlined"
                />
              </Stack>
            </div>
            <div className="systeminfos-table-block">
              <SmartTable<GitInfoRow>
                tableId="systeminfos-git"
                userId={tableUserId}
                title="Git & Build"
                rows={gitInfoRows}
                columns={gitInfoColumns}
                loading={refreshing}
                onRefresh={() => {
                  void loadSystemInfos(true);
                }}
                defaultPageSize={1}
                pageSizeOptions={[1, 5, 10]}
                disableRowSelectionOnClick
              />
            </div>
            <div className="systeminfos-table-block">
              <SmartTable<VersionRow>
                tableId="systeminfos-versions"
                userId={tableUserId}
                title="Komponenten-Versionen"
                rows={versionsRows}
                columns={versionsColumns}
                loading={refreshing}
                onRefresh={() => {
                  void loadSystemInfos(true);
                }}
                defaultPageSize={10}
                pageSizeOptions={[5, 10, 20]}
                disableRowSelectionOnClick
              />
            </div>
          </section>

          <section className="systeminfos-section">
            <h3>Systemdetails</h3>
            <SmartTable<SystemFactRow>
              tableId="systeminfos-facts"
              userId={tableUserId}
              title="Runtime, Backend und KI"
              rows={systemFacts}
              columns={systemFactsColumns}
              loading={refreshing}
              onRefresh={() => {
                void loadSystemInfos(true);
              }}
              defaultPageSize={25}
              pageSizeOptions={[10, 25, 50, 100]}
              disableRowSelectionOnClick
            />
          </section>

          <section className="systeminfos-section">
            <h3>Offene Sessions</h3>
            <SmartTable<SessionRow>
              tableId="systeminfos-sessions"
              userId={tableUserId}
              title="Aktive Sessions"
              rows={sessionRows}
              columns={sessionColumns}
              loading={refreshing}
              onRefresh={() => {
                void loadSystemInfos(true);
              }}
              defaultPageSize={10}
              pageSizeOptions={[5, 10, 20, 50]}
              disableRowSelectionOnClick
            />
          </section>

          <section className="systeminfos-section">
            <h3>Offene Tokens</h3>

            <div className="systeminfos-subsection">
              <Typography variant="subtitle1" fontWeight={700}>Feed-Tokens</Typography>
              <SmartTable<FeedTokenRow>
                tableId="systeminfos-feed-tokens"
                userId={tableUserId}
                title="Feed-Tokens"
                rows={feedTokenRows}
                columns={feedTokenColumns}
                loading={refreshing}
                onRefresh={() => {
                  void loadSystemInfos(true);
                }}
                defaultPageSize={10}
                pageSizeOptions={[5, 10, 20]}
                disableRowSelectionOnClick
              />
            </div>

            <div className="systeminfos-subsection">
              <Typography variant="subtitle1" fontWeight={700}>OAuth-Tokens</Typography>
              <SmartTable<OAuthTokenRow>
                tableId="systeminfos-oauth-tokens"
                userId={tableUserId}
                title="OAuth-Tokens"
                rows={oauthTokenRows}
                columns={oauthTokenColumns}
                loading={refreshing}
                onRefresh={() => {
                  void loadSystemInfos(true);
                }}
                defaultPageSize={10}
                pageSizeOptions={[5, 10, 20]}
                disableRowSelectionOnClick
              />
            </div>

            <div className="systeminfos-subsection">
              <Typography variant="subtitle1" fontWeight={700}>Ticket-Validierungstokens</Typography>
              <SmartTable<ValidationTokenRow>
                tableId="systeminfos-ticket-validation-tokens"
                userId={tableUserId}
                title="Ticket-Validierungstokens"
                rows={ticketValidationRows}
                columns={validationTokenColumns}
                loading={refreshing}
                onRefresh={() => {
                  void loadSystemInfos(true);
                }}
                defaultPageSize={10}
                pageSizeOptions={[5, 10, 20]}
                disableRowSelectionOnClick
              />
            </div>

            <div className="systeminfos-subsection">
              <Typography variant="subtitle1" fontWeight={700}>Workflow-Validierungstokens</Typography>
              <SmartTable<ValidationTokenRow>
                tableId="systeminfos-workflow-validation-tokens"
                userId={tableUserId}
                title="Workflow-Validierungstokens"
                rows={workflowValidationRows}
                columns={validationTokenColumns}
                loading={refreshing}
                onRefresh={() => {
                  void loadSystemInfos(true);
                }}
                defaultPageSize={10}
                pageSizeOptions={[5, 10, 20]}
                disableRowSelectionOnClick
              />
            </div>
          </section>

          <section className="systeminfos-section">
            <div className="systeminfos-section-head">
              <h3>Datenbankstruktur</h3>
              <TextField
                size="small"
                value={tableSearch}
                onChange={(event) => setTableSearch(event.target.value)}
                placeholder="Tabellen-/Spaltenname filtern…"
              />
            </div>
            <p className="systeminfos-note">
              Snapshot: {formatDateTime(data.databaseStructure.generatedAt)} | Tabellen: {formatInteger(data.databaseStructure.tableCount)} | Größe: {formatBytes(data.databaseStructure.database.sizeBytes)}
            </p>

            <SmartTable<DatabaseTableRow>
              tableId="systeminfos-database-tables"
              userId={tableUserId}
              title="Tabellen"
              rows={databaseTableRows}
              columns={databaseTableColumns}
              loading={refreshing}
              onRowClick={(row) => setSelectedTableName(row.name)}
              onRefresh={() => {
                void loadSystemInfos(true);
              }}
              defaultPageSize={10}
              pageSizeOptions={[5, 10, 20, 50]}
              disableRowSelectionOnClick
            />

            {selectedTable ? (
              <div className="systeminfos-db-detail-grid">
                <div className="systeminfos-table-block">
                  <Typography variant="subtitle1" fontWeight={700}>
                    {selectedTable.name} · Spalten ({formatInteger(selectedTable.columns.length)})
                  </Typography>
                  <SmartTable<DatabaseColumnRow>
                    tableId={`systeminfos-db-columns-${selectedTable.name}`}
                    userId={tableUserId}
                    title="Spalten"
                    rows={selectedColumnRows}
                    columns={databaseColumnColumns}
                    loading={refreshing}
                    defaultPageSize={10}
                    pageSizeOptions={[5, 10, 25, 50]}
                    disableRowSelectionOnClick
                  />
                </div>

                <div className="systeminfos-table-block">
                  <Typography variant="subtitle1" fontWeight={700}>
                    {selectedTable.name} · Foreign Keys ({formatInteger(selectedTable.foreignKeys.length)})
                  </Typography>
                  <SmartTable<DatabaseForeignKeyRow>
                    tableId={`systeminfos-db-fks-${selectedTable.name}`}
                    userId={tableUserId}
                    title="Foreign Keys"
                    rows={selectedForeignKeyRows}
                    columns={databaseForeignKeyColumns}
                    loading={refreshing}
                    defaultPageSize={10}
                    pageSizeOptions={[5, 10, 25, 50]}
                    disableRowSelectionOnClick
                  />
                </div>

                <div className="systeminfos-table-block systeminfos-create-sql-block">
                  <Typography variant="subtitle1" fontWeight={700}>CREATE SQL</Typography>
                  <pre className="systeminfos-create-sql">{selectedTable.createSql || '–'}</pre>
                </div>
              </div>
            ) : (
              <div className="systeminfos-empty">Keine Tabellen für den aktuellen Filter.</div>
            )}
          </section>

          <section className="systeminfos-section">
            <h3>Build-Historie</h3>
            <SmartTable<BuildHistoryRow>
              tableId="systeminfos-build-history"
              userId={tableUserId}
              title="Build-Historie"
              rows={buildHistoryRows}
              columns={buildHistoryColumns}
              loading={refreshing}
              onRefresh={() => {
                void loadSystemInfos(true);
              }}
              defaultPageSize={10}
              pageSizeOptions={[5, 10, 20, 50]}
              disableRowSelectionOnClick
            />
            {buildHistoryRows.length === 0 && data.build.git.error ? (
              <Alert severity="info">Build-Historie derzeit nicht verfügbar: {data.build.git.error}</Alert>
            ) : null}
          </section>

          <section className="systeminfos-section">
            <h3>Feature-Historie (Admin-Journal)</h3>
            <SmartTable<FeatureHistoryRow>
              tableId="systeminfos-feature-history"
              userId={tableUserId}
              title="Feature-Historie"
              rows={featureHistoryRows}
              columns={featureHistoryColumns}
              loading={refreshing}
              onRefresh={() => {
                void loadSystemInfos(true);
              }}
              defaultPageSize={10}
              pageSizeOptions={[5, 10, 20, 50, 100]}
              disableRowSelectionOnClick
            />
          </section>
        </>
      ) : null}
    </div>
  );
};

export default SystemInfos;
