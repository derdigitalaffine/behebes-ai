import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { getAdminToken } from '../lib/auth';
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
  };
  build: {
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
    return value.length > 200 ? `${value.slice(0, 200)}…` : value;
  }
  try {
    const serialized = JSON.stringify(value);
    if (!serialized) return '–';
    return serialized.length > 200 ? `${serialized.slice(0, 200)}…` : serialized;
  } catch {
    return String(value);
  }
};

const renderPackageVersion = (entry: PackageMetadata) => {
  return `${entry.name}@${entry.version}`;
};

const SystemInfos: React.FC = () => {
  const [data, setData] = useState<SystemInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [tableSearch, setTableSearch] = useState('');

  const loadSystemInfos = async (silent = false) => {
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
      setData(response.data);
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
  };

  useEffect(() => {
    void loadSystemInfos(false);
  }, []);

  const filteredTables = useMemo(() => {
    if (!data) return [];
    const query = tableSearch.trim().toLowerCase();
    if (!query) return data.databaseStructure.tables;
    return data.databaseStructure.tables.filter((table) => {
      if (table.name.toLowerCase().includes(query)) return true;
      return table.columns.some((column) => column.name.toLowerCase().includes(query));
    });
  }, [data, tableSearch]);

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
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void loadSystemInfos(true)}
          disabled={refreshing}
        >
          {refreshing ? 'Aktualisiere…' : 'Neu laden'}
        </button>
      </div>

      {error && <div className="systeminfos-alert error">{error}</div>}

      {data?.warnings?.length ? (
        <div className="systeminfos-alert warning">
          {data.warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
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
              <span>Tabellen</span>
              <strong>{formatInteger(data.databaseStructure.tableCount)}</strong>
              <small>
                Backend: {renderPackageVersion(data.versions.backend)} | Admin: {renderPackageVersion(data.versions.admin)}
              </small>
            </article>
          </section>

          <section className="systeminfos-section">
            <h3>Backend, Runtime und Versionen</h3>
            <div className="systeminfos-grid">
              <article className="systeminfos-card">
                <h4>Laufzeit</h4>
                <dl>
                  <div><dt>Framework</dt><dd>{data.backend.framework}</dd></div>
                  <div><dt>Node</dt><dd>{data.backend.runtime.nodeVersion}</dd></div>
                  <div><dt>PID</dt><dd>{data.backend.runtime.pid}</dd></div>
                  <div><dt>Uptime</dt><dd>{formatUptime(data.backend.runtime.uptimeSeconds)}</dd></div>
                  <div><dt>Gestartet</dt><dd>{formatDateTime(data.backend.runtime.startedAt)}</dd></div>
                  <div><dt>Plattform</dt><dd>{data.backend.runtime.platform}/{data.backend.runtime.arch}</dd></div>
                  <div><dt>Zeitzone</dt><dd>{data.backend.runtime.timezone}</dd></div>
                  <div><dt>Heap genutzt</dt><dd>{formatBytes(data.backend.runtime.memory.heapUsedBytes)}</dd></div>
                </dl>
              </article>

              <article className="systeminfos-card">
                <h4>Backend-Konfiguration</h4>
                <dl>
                  <div><dt>Environment</dt><dd>{data.backend.environment.nodeEnv}</dd></div>
                  <div><dt>Port</dt><dd>{data.backend.environment.port}</dd></div>
                  <div><dt>Trust Proxy</dt><dd>{String(data.backend.environment.trustProxy)}</dd></div>
                  <div><dt>Datenbank</dt><dd>{data.backend.database.client}</dd></div>
                  {data.backend.database.client === 'sqlite' ? (
                    <div><dt>SQLite Pfad</dt><dd>{data.backend.database.sqlitePath || '–'}</dd></div>
                  ) : (
                    <>
                      <div><dt>MySQL Host</dt><dd>{data.backend.database.mysql?.host || '–'}</dd></div>
                      <div><dt>MySQL Port</dt><dd>{data.backend.database.mysql?.port || '–'}</dd></div>
                      <div><dt>MySQL DB</dt><dd>{data.backend.database.mysql?.database || '–'}</dd></div>
                    </>
                  )}
                  <div><dt>Frontend URL</dt><dd>{data.backend.environment.frontendUrl}</dd></div>
                  <div><dt>Admin URL</dt><dd>{data.backend.environment.adminUrl}</dd></div>
                </dl>
              </article>

              <article className="systeminfos-card">
                <h4>KI-Backend</h4>
                <dl>
                  <div><dt>Provider</dt><dd>{data.backend.ai.provider}</dd></div>
                  <div><dt>Modell</dt><dd>{data.backend.ai.model}</dd></div>
                  <div><dt>Provider Quelle</dt><dd>{data.backend.ai.providerSource}</dd></div>
                  <div><dt>Model Quelle</dt><dd>{data.backend.ai.modelSource}</dd></div>
                  <div><dt>OpenAI Client ID</dt><dd>{data.backend.ai.credentials.hasOpenaiClientId ? 'gesetzt' : 'leer'}</dd></div>
                  <div><dt>OpenAI Secret</dt><dd>{data.backend.ai.credentials.hasOpenaiClientSecret ? 'gesetzt' : 'leer'}</dd></div>
                  <div><dt>AskCodi Key</dt><dd>{data.backend.ai.credentials.hasAskcodiApiKey ? 'gesetzt' : 'leer'}</dd></div>
                  <div><dt>AskCodi Base URL</dt><dd>{data.backend.ai.credentials.askcodiBaseUrl}</dd></div>
                </dl>
              </article>

              <article className="systeminfos-card">
                <h4>Build & Version</h4>
                <dl>
                  <div><dt>Workspace</dt><dd>{renderPackageVersion(data.versions.workspace)}</dd></div>
                  <div><dt>Backend</dt><dd>{renderPackageVersion(data.versions.backend)}</dd></div>
                  <div><dt>Admin</dt><dd>{renderPackageVersion(data.versions.admin)}</dd></div>
                  <div><dt>Frontend</dt><dd>{renderPackageVersion(data.versions.frontend)}</dd></div>
                  <div><dt>Build-ID</dt><dd>{data.build.envBuildId || '–'}</dd></div>
                  <div><dt>Build-Zeit</dt><dd>{formatDateTime(data.build.envBuildTime)}</dd></div>
                  <div><dt>Commit (ENV)</dt><dd>{data.build.envCommitRef || '–'}</dd></div>
                  <div><dt>Git Branch</dt><dd>{data.build.git.branch || '–'}</dd></div>
                </dl>
              </article>
            </div>
          </section>

          <section className="systeminfos-section">
            <h3>Offene Sessions</h3>
            <div className="systeminfos-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Benutzer</th>
                    <th>Rolle</th>
                    <th>IP</th>
                    <th>Letzte Aktivität</th>
                    <th>Ablauf</th>
                    <th>Remember</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sessions.active.length === 0 ? (
                    <tr>
                      <td colSpan={6}>Keine aktiven Sessions.</td>
                    </tr>
                  ) : (
                    data.sessions.active.map((session) => (
                      <tr key={session.id}>
                        <td>{session.username || session.adminUserId}</td>
                        <td>{session.role || '–'}</td>
                        <td>{session.ipAddress || '–'}</td>
                        <td>{formatDateTime(session.lastSeenAt)}</td>
                        <td>{session.expiresAt ? formatDateTime(session.expiresAt) : 'ohne Ablauf'}</td>
                        <td>{session.rememberMe ? 'ja' : 'nein'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="systeminfos-section">
            <h3>Offene Tokens</h3>

            <div className="systeminfos-subsection">
              <h4>Feed-Tokens</h4>
              <div className="systeminfos-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Scope</th>
                      <th>Benutzer</th>
                      <th>Token</th>
                      <th>Erstellt</th>
                      <th>Zuletzt genutzt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tokens.feedTokens.length === 0 ? (
                      <tr>
                        <td colSpan={5}>Keine offenen Feed-Tokens.</td>
                      </tr>
                    ) : (
                      data.tokens.feedTokens.map((token) => (
                        <tr key={token.id}>
                          <td>{token.scope}</td>
                          <td>{token.username || token.adminUserId}</td>
                          <td>{token.tokenMasked || '–'}</td>
                          <td>{formatDateTime(token.createdAt)}</td>
                          <td>{formatDateTime(token.lastUsedAt)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="systeminfos-subsection">
              <h4>OAuth-Tokens</h4>
              <div className="systeminfos-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>Account</th>
                      <th>Status</th>
                      <th>Ablauf</th>
                      <th>Aktualisiert</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tokens.oauthTokens.length === 0 ? (
                      <tr>
                        <td colSpan={5}>Keine OAuth-Tokens vorhanden.</td>
                      </tr>
                    ) : (
                      data.tokens.oauthTokens.map((token) => (
                        <tr key={token.id}>
                          <td>{token.provider || '–'}</td>
                          <td>{token.accountId || '–'}</td>
                          <td>{token.isExpired ? 'abgelaufen' : 'aktiv'}</td>
                          <td>{token.expiresAt ? formatDateTime(token.expiresAt) : 'kein Ablauf'}</td>
                          <td>{formatDateTime(token.updatedAt)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="systeminfos-subsection">
              <h4>Ticket-Validierungstokens</h4>
              <div className="systeminfos-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Ticket</th>
                      <th>E-Mail</th>
                      <th>Token</th>
                      <th>Erstellt</th>
                      <th>Ablauf</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tokens.ticketValidationTokens.length === 0 ? (
                      <tr>
                        <td colSpan={5}>Keine offenen Ticket-Validierungstokens.</td>
                      </tr>
                    ) : (
                      data.tokens.ticketValidationTokens.map((token) => (
                        <tr key={token.id}>
                          <td>{token.ticketId || '–'}</td>
                          <td>{token.citizenEmail || '–'}</td>
                          <td>{token.tokenMasked || '–'}</td>
                          <td>{formatDateTime(token.createdAt)}</td>
                          <td>{token.expiresAt ? formatDateTime(token.expiresAt) : 'kein Ablauf'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="systeminfos-subsection">
              <h4>Workflow-Validierungstokens</h4>
              <div className="systeminfos-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Ticket</th>
                      <th>Empfänger</th>
                      <th>Token</th>
                      <th>Erstellt</th>
                      <th>Ablauf</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tokens.workflowValidationTokens.length === 0 ? (
                      <tr>
                        <td colSpan={5}>Keine offenen Workflow-Validierungstokens.</td>
                      </tr>
                    ) : (
                      data.tokens.workflowValidationTokens.map((token) => (
                        <tr key={token.id}>
                          <td>{token.ticketId || '–'}</td>
                          <td>{token.recipientEmail || '–'}</td>
                          <td>{token.tokenMasked || '–'}</td>
                          <td>{formatDateTime(token.createdAt)}</td>
                          <td>{token.expiresAt ? formatDateTime(token.expiresAt) : 'kein Ablauf'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="systeminfos-section">
            <div className="systeminfos-section-head">
              <h3>Datenbankstruktur</h3>
              <input
                type="text"
                value={tableSearch}
                onChange={(event) => setTableSearch(event.target.value)}
                placeholder="Tabellen-/Spaltenname filtern…"
              />
            </div>
            <p className="systeminfos-note">
              Snapshot: {formatDateTime(data.databaseStructure.generatedAt)} | Tabellen: {formatInteger(data.databaseStructure.tableCount)} | Größe:{' '}
              {formatBytes(data.databaseStructure.database.sizeBytes)}
            </p>

            <div className="systeminfos-db-grid">
              {filteredTables.length === 0 ? (
                <div className="systeminfos-empty">Keine Tabellen für den aktuellen Filter.</div>
              ) : (
                filteredTables.map((table) => (
                  <article key={table.name} className="systeminfos-db-card">
                    <header>
                      <h4>{table.name}</h4>
                      <span>{formatInteger(table.rowCount)} Zeilen</span>
                    </header>
                    <p>
                      Spalten: {formatInteger(table.columns.length)} | Foreign Keys: {formatInteger(table.foreignKeys.length)}
                    </p>
                    <details>
                      <summary>Spalten anzeigen</summary>
                      <div className="systeminfos-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Name</th>
                              <th>Typ</th>
                              <th>PK</th>
                              <th>Not Null</th>
                              <th>Default</th>
                            </tr>
                          </thead>
                          <tbody>
                            {table.columns.map((column) => (
                              <tr key={`${table.name}-${column.cid}-${column.name}`}>
                                <td>{column.name}</td>
                                <td>{column.type || '–'}</td>
                                <td>{column.primaryKeyOrder > 0 ? String(column.primaryKeyOrder) : '–'}</td>
                                <td>{column.notNull ? 'ja' : 'nein'}</td>
                                <td>{column.defaultValue ?? '–'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                    {table.foreignKeys.length > 0 ? (
                      <details>
                        <summary>Foreign Keys anzeigen</summary>
                        <div className="systeminfos-table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>Von</th>
                                <th>Nach Tabelle</th>
                                <th>Nach Spalte</th>
                                <th>On Update</th>
                                <th>On Delete</th>
                              </tr>
                            </thead>
                            <tbody>
                              {table.foreignKeys.map((fk) => (
                                <tr key={`${table.name}-fk-${fk.id}-${fk.seq}`}>
                                  <td>{fk.from}</td>
                                  <td>{fk.table}</td>
                                  <td>{fk.to}</td>
                                  <td>{fk.onUpdate || '–'}</td>
                                  <td>{fk.onDelete || '–'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    ) : null}
                    {table.createSql ? (
                      <details>
                        <summary>CREATE SQL anzeigen</summary>
                        <pre>{table.createSql}</pre>
                      </details>
                    ) : null}
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="systeminfos-section">
            <h3>Build-Historie</h3>
            <div className="systeminfos-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Zeit</th>
                    <th>Commit</th>
                    <th>Autor</th>
                    <th>Beschreibung</th>
                  </tr>
                </thead>
                <tbody>
                  {data.buildHistory.length === 0 ? (
                    <tr>
                      <td colSpan={4}>
                        Keine Build-Historie verfügbar.
                        {data.build.git.error ? ` (${data.build.git.error})` : ''}
                      </td>
                    </tr>
                  ) : (
                    data.buildHistory.map((entry) => (
                      <tr key={entry.commit}>
                        <td>{formatDateTime(entry.authoredAt)}</td>
                        <td>{entry.shortCommit}</td>
                        <td>{entry.author}</td>
                        <td>{entry.subject}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="systeminfos-section">
            <h3>Feature-Historie (Admin-Journal)</h3>
            <div className="systeminfos-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Zeit</th>
                    <th>Event</th>
                    <th>Benutzer</th>
                    <th>Methode</th>
                    <th>Pfad</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {data.featureHistory.length === 0 ? (
                    <tr>
                      <td colSpan={6}>Keine Feature-Historie im Journal gefunden.</td>
                    </tr>
                  ) : (
                    data.featureHistory.map((entry) => (
                      <tr key={entry.id}>
                        <td>{formatDateTime(entry.createdAt)}</td>
                        <td>{entry.eventType || '–'}</td>
                        <td>{entry.username || '–'}</td>
                        <td>{entry.method || '–'}</td>
                        <td>{entry.path || '–'}</td>
                        <td>{formatJsonPreview(entry.details)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
};

export default SystemInfos;
