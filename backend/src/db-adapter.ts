/**
 * © Dominik Tröster, Verbandsgemeinde Otterbach Otterberg
 * Apache License 2.0
 */

import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open, type Database as SqliteDatabase } from 'sqlite';
import mysql from 'mysql2/promise';
import type { Config } from './config.js';
import { formatSqlDateTime } from './utils/sql-date.js';

export type DatabaseDialect = 'sqlite' | 'mysql';

export interface AppDatabase {
  readonly dialect: DatabaseDialect;
  run(sql: string, params?: any[] | any): Promise<{ lastID?: number; changes?: number }>;
  get<T = any>(sql: string, params?: any[] | any): Promise<T | undefined>;
  all<T = any>(sql: string, params?: any[] | any): Promise<T[]>;
  exec(sql: string): Promise<void>;
}

const LONG_TEXT_COLUMN_NAMES = new Set([
  'anonymized_text',
  'original_description',
  'translated_description_de',
  'description',
  'ai_decision',
  'ai_reasoning',
  'admin_feedback',
  'reason',
  'details',
  'access_token',
  'refresh_token',
  'value',
  'content',
  'requested_questions_json',
  'answers_json',
  'raw_payload_json',
  'entries_json',
  'result_json',
  'raw_data_json',
  'summary',
  'details_json',
  'prompt_instruction',
  'message',
  'context_json',
  'metadata_json',
  'html_content',
  'text_content',
  'translation_notice',
  'source_subject',
  'source_html_content',
  'source_text_content',
  'last_error',
  'prompt',
  'result_text',
  'meta_json',
  'nominatim_raw_json',
  'weather_report_json',
  'exif_json',
  'ai_description_text',
  'ai_description_error',
]);

function normalizeParams(params?: any[] | any): any[] {
  if (typeof params === 'undefined') return [];
  return Array.isArray(params) ? params : [params];
}

const ISO_DATE_TIME_WITH_T_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?$/;

function normalizeMysqlParamValue(value: any): any {
  if (value instanceof Date) {
    return formatSqlDateTime(value);
  }

  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || !trimmed.includes('T')) return value;
  if (!ISO_DATE_TIME_WITH_T_REGEX.test(trimmed)) return value;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return value;
  return formatSqlDateTime(parsed);
}

function normalizeMysqlParams(params: any[]): any[] {
  if (!Array.isArray(params) || params.length === 0) return params;
  return params.map((entry) => normalizeMysqlParamValue(entry));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const prev = i > 0 ? sql[i - 1] : '';

    if (ch === "'" && !inDouble && !inBacktick && prev !== '\\') {
      inSingle = !inSingle;
      current += ch;
      continue;
    }

    if (ch === '"' && !inSingle && !inBacktick && prev !== '\\') {
      inDouble = !inDouble;
      current += ch;
      continue;
    }

    if (ch === '`' && !inSingle && !inDouble && prev !== '\\') {
      inBacktick = !inBacktick;
      current += ch;
      continue;
    }

    if (ch === ';' && !inSingle && !inDouble && !inBacktick) {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = '';
      continue;
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

function parseIntervalModifier(value: any): { value: number; unit: 'SECOND' | 'MINUTE' | 'HOUR' | 'DAY' } | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { value: Math.trunc(value), unit: 'SECOND' };
  }

  const raw = String(value ?? '').trim();
  const match = raw.match(/^([+-]?\d+)\s*(seconds?|minutes?|hours?|days?)$/i);
  if (!match) return null;

  const parsedValue = parseInt(match[1], 10);
  if (!Number.isFinite(parsedValue)) return null;

  const rawUnit = match[2].toLowerCase();
  if (rawUnit.startsWith('day')) return { value: parsedValue, unit: 'DAY' };
  if (rawUnit.startsWith('hour')) return { value: parsedValue, unit: 'HOUR' };
  if (rawUnit.startsWith('minute')) return { value: parsedValue, unit: 'MINUTE' };
  return { value: parsedValue, unit: 'SECOND' };
}

function countPlaceholdersBefore(sql: string, endIndex: number): number {
  let count = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;

  for (let i = 0; i < endIndex; i += 1) {
    const ch = sql[i];
    const prev = i > 0 ? sql[i - 1] : '';

    if (ch === "'" && !inDouble && !inBacktick && prev !== '\\') {
      inSingle = !inSingle;
      continue;
    }

    if (ch === '"' && !inSingle && !inBacktick && prev !== '\\') {
      inDouble = !inDouble;
      continue;
    }

    if (ch === '`' && !inSingle && !inDouble && prev !== '\\') {
      inBacktick = !inBacktick;
      continue;
    }

    if (ch === '?' && !inSingle && !inDouble && !inBacktick) {
      count += 1;
    }
  }

  return count;
}

function replaceNowWithInterval(
  sql: string,
  params: any[],
  kind: 'datetime' | 'date'
): { sql: string; params: any[] } {
  const regex =
    kind === 'datetime'
      ? /datetime\(\s*'now'\s*,\s*\?\s*\)/gi
      : /date\(\s*'now'\s*,\s*\?\s*\)/gi;
  const matches = Array.from(sql.matchAll(regex));
  if (matches.length === 0) return { sql, params };

  let nextSql = sql;
  const nextParams = [...params];

  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const match = matches[i];
    const start = match.index ?? 0;
    const paramIndex = countPlaceholdersBefore(sql, start);
    const parsed = parseIntervalModifier(nextParams[paramIndex]);

    const intervalValue = parsed?.value ?? 0;
    const intervalUnit = parsed?.unit ?? 'SECOND';
    nextParams[paramIndex] = intervalValue;

    const replacement =
      kind === 'datetime'
        ? `DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? ${intervalUnit})`
        : `DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? ${intervalUnit}))`;

    nextSql = `${nextSql.slice(0, start)}${replacement}${nextSql.slice(start + match[0].length)}`;
  }

  return { sql: nextSql, params: nextParams };
}

function isShortTextColumnName(columnName: string): boolean {
  if (!columnName) return false;
  return (
    columnName === 'id' ||
    columnName.endsWith('_id') ||
    columnName.endsWith('_token') ||
    columnName === 'token' ||
    columnName.endsWith('_email') ||
    columnName === 'email' ||
    columnName.endsWith('_username') ||
    columnName === 'username' ||
    columnName.endsWith('_role') ||
    columnName === 'role' ||
    columnName.endsWith('_status') ||
    columnName === 'status' ||
    columnName.endsWith('_severity') ||
    columnName === 'severity' ||
    columnName.endsWith('_type') ||
    columnName === 'type' ||
    columnName.endsWith('_kind') ||
    columnName === 'kind' ||
    columnName.endsWith('_scope') ||
    columnName === 'scope' ||
    columnName.endsWith('_key') ||
    columnName === 'key' ||
    columnName.endsWith('_language') ||
    columnName === 'language' ||
    columnName.endsWith('_template_id') ||
    columnName.endsWith('_provider') ||
    columnName === 'provider' ||
    columnName.endsWith('_purpose') ||
    columnName === 'purpose' ||
    columnName.endsWith('_category') ||
    columnName === 'category' ||
    columnName.endsWith('_priority') ||
    columnName === 'priority' ||
    columnName.endsWith('_city') ||
    columnName === 'city' ||
    columnName.endsWith('_postal_code') ||
    columnName.endsWith('_project') ||
    columnName.endsWith('_assigned_to') ||
    columnName.endsWith('_method') ||
    columnName.endsWith('_path') ||
    columnName.endsWith('_ip_address') ||
    columnName.endsWith('_user_agent') ||
    columnName.endsWith('_label') ||
    columnName === 'label' ||
    columnName.endsWith('_version') ||
    columnName.endsWith('_file_name') ||
    columnName.endsWith('_account_id') ||
    columnName.endsWith('_first_name') ||
    columnName.endsWith('_last_name') ||
    columnName.endsWith('_name') ||
    columnName.endsWith('_hash') ||
    columnName.endsWith('_by') ||
    columnName.endsWith('_to')
  );
}

function translateSqliteTextTypeToMysql(columnName: string, rest: string): string {
  const lowerName = columnName.toLowerCase();
  const hasDefault = /\bDEFAULT\b/i.test(rest);
  const hasInlineKeyConstraint = /\bPRIMARY\s+KEY\b|\bUNIQUE\b/i.test(rest);
  const shortByName = isShortTextColumnName(lowerName);

  if (hasInlineKeyConstraint || shortByName) {
    return 'VARCHAR(191)';
  }

  if (hasDefault) {
    return 'VARCHAR(255)';
  }

  if (LONG_TEXT_COLUMN_NAMES.has(lowerName) || lowerName.endsWith('_json')) {
    return 'LONGTEXT';
  }

  return 'LONGTEXT';
}

function translateColumnTypeDefinition(columnName: string, sqliteType: string, rest: string): string {
  const normalizedType = sqliteType.toUpperCase();
  if (normalizedType === 'TEXT') {
    return `${translateSqliteTextTypeToMysql(columnName, rest)}${rest}`;
  }
  if (normalizedType === 'INTEGER') {
    return `BIGINT${rest}`;
  }
  if (normalizedType === 'REAL') {
    return `DOUBLE${rest}`;
  }
  if (normalizedType === 'BOOLEAN') {
    return `TINYINT(1)${rest}`;
  }
  if (normalizedType === 'BLOB') {
    return `LONGBLOB${rest}`;
  }
  if (normalizedType === 'DATETIME') {
    return `DATETIME${rest}`;
  }
  if (normalizedType === 'JSON') {
    return `LONGTEXT${rest}`;
  }
  return `${sqliteType}${rest}`;
}

function translateCreateTableForMysql(statement: string): string {
  const lines = statement.split('\n');
  const transformed = lines.map((line) => {
    const match = line.match(/^(\s*)([`"']?)([A-Za-z0-9_]+)\2\s+([A-Za-z]+)(.*)$/);
    if (!match) return line;

    const [, indent, , rawColumnName, rawType, rawRest] = match;
    const upperType = rawType.toUpperCase();
    const definitionKeywords = new Set(['CREATE', 'PRIMARY', 'FOREIGN', 'UNIQUE', 'CONSTRAINT', 'CHECK']);
    if (definitionKeywords.has(rawColumnName.toUpperCase())) {
      return line;
    }

    const nextTypeDefinition = translateColumnTypeDefinition(rawColumnName, upperType, rawRest);
    const mysqlColumnName = `\`${rawColumnName.replace(/`/g, '')}\``;
    return `${indent}${mysqlColumnName} ${nextTypeDefinition}`;
  });

  let rebuilt = transformed.join('\n').trim();
  if (rebuilt.endsWith(')') && !/ENGINE\s*=\s*/i.test(rebuilt)) {
    rebuilt += ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
  }

  return rebuilt;
}

function translateAlterTableAddColumnForMysql(statement: string): string {
  const match = statement.match(
    /^\s*ALTER\s+TABLE\s+([`"']?[A-Za-z0-9_]+[`"']?)\s+ADD\s+COLUMN\s+([`"']?)([A-Za-z0-9_]+)\2\s+([A-Za-z]+)(.*)$/i
  );
  if (!match) return statement;

  const [, rawTableName, , columnName, rawType, rawRest] = match;
  const mysqlTypeDefinition = translateColumnTypeDefinition(columnName, rawType.toUpperCase(), rawRest);
  const tableName = rawTableName.replace(/[`"']/g, '');
  return `ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${mysqlTypeDefinition}`;
}

function translateCreateIndexForMysql(statement: string): string {
  const match = statement.match(
    /^\s*CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+([`"']?[A-Za-z0-9_]+[`"']?)\s+ON\s+([`"']?[A-Za-z0-9_]+[`"']?)\s*\(([\s\S]+)\)\s*$/i
  );
  if (!match) return statement;

  const [, uniquePart, rawIndexName, rawTableName, rawColumns] = match;
  const indexName = rawIndexName.replace(/[`"']/g, '');
  const tableName = rawTableName.replace(/[`"']/g, '');
  const uniquePrefix = uniquePart ? 'UNIQUE ' : '';
  return `CREATE ${uniquePrefix}INDEX \`${indexName}\` ON \`${tableName}\` (${rawColumns.trim()})`;
}

function isCreateIndexSql(sql: string): boolean {
  return /^\s*CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(sql);
}

function isIgnorableCreateIndexError(error: any, sql: string): boolean {
  if (!isCreateIndexSql(sql)) return false;
  const code = String(error?.code || '');
  return code === 'ER_DUP_KEYNAME';
}

function translateStrftimeForMysql(sql: string): string {
  return sql.replace(/strftime\(\s*'([^']+)'\s*,\s*([^\)]+?)\s*\)/gi, (_full, format: string, expr: string) => {
    return `DATE_FORMAT(${expr.trim()}, '${format}')`;
  });
}

function translateJuliandayForMysql(sql: string): string {
  let translated = sql;
  translated = translated.replace(
    /julianday\(\s*'now'\s*\)/gi,
    '(UNIX_TIMESTAMP(UTC_TIMESTAMP()) / 86400)'
  );
  translated = translated.replace(
    /julianday\(\s*COALESCE\(([^\)]+)\)\s*\)/gi,
    '(UNIX_TIMESTAMP(CAST(COALESCE($1) AS DATETIME)) / 86400)'
  );
  translated = translated.replace(
    /julianday\(\s*([A-Za-z0-9_`.]+)\s*\)/gi,
    '(UNIX_TIMESTAMP(CAST($1 AS DATETIME)) / 86400)'
  );
  return translated;
}

function translateSqlForMysql(sql: string, params: any[]): { sql: string; params: any[] } {
  let translated = sql.trim();
  let nextParams = [...params];

  if (!translated) {
    return { sql: '', params: nextParams };
  }

  if (/^CREATE\s+TABLE\s+/i.test(translated)) {
    translated = translateCreateTableForMysql(translated);
    return { sql: translated, params: nextParams };
  }

  if (/^ALTER\s+TABLE\s+/i.test(translated) && /\bADD\s+COLUMN\b/i.test(translated)) {
    translated = translateAlterTableAddColumnForMysql(translated);
  }

  if (/^CREATE\s+(UNIQUE\s+)?INDEX\s+/i.test(translated)) {
    translated = translateCreateIndexForMysql(translated);
  }

  translated = translated.replace(/\bINSERT\s+OR\s+REPLACE\s+INTO\b/gi, 'REPLACE INTO');
  translated = translated.replace(
    /ON\s+CONFLICT\s*\([^)]+\)\s*DO\s+UPDATE\s+SET/gi,
    'ON DUPLICATE KEY UPDATE'
  );
  translated = translated.replace(/\bexcluded\.\s*`([^`]+)`/gi, 'VALUES(`$1`)');
  translated = translated.replace(/\bexcluded\.\s*"([^"]+)"/gi, 'VALUES(`$1`)');
  translated = translated.replace(/\bexcluded\.\s*([A-Za-z0-9_]+)/gi, 'VALUES(`$1`)');

  translated = translated.replace(
    /datetime\(\s*'now'\s*,\s*'\+'\s*\|\|\s*\?\s*\|\|\s*' seconds'\s*\)/gi,
    'DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND)'
  );

  ({ sql: translated, params: nextParams } = replaceNowWithInterval(translated, nextParams, 'datetime'));
  ({ sql: translated, params: nextParams } = replaceNowWithInterval(translated, nextParams, 'date'));

  translated = translated.replace(/datetime\(\s*'now'\s*\)/gi, 'UTC_TIMESTAMP()');
  translated = translated.replace(/date\(\s*'now'\s*\)/gi, 'UTC_DATE()');
  translated = translateJuliandayForMysql(translated);

  translated = translateStrftimeForMysql(translated);

  // SQLite allows datetime(?) / date(?) for parameter normalization; MySQL requires explicit casts.
  translated = translated.replace(/datetime\(\s*\?\s*\)/gi, 'CAST(? AS DATETIME)');
  translated = translated.replace(/date\(\s*\?\s*\)/gi, 'DATE(?)');

  translated = translated.replace(
    /datetime\(\s*COALESCE\(([^\)]+)\)\s*\)/gi,
    'CAST(COALESCE($1) AS DATETIME)'
  );
  translated = translated.replace(/datetime\(\s*([A-Za-z0-9_`.]+)\s*\)/gi, 'CAST($1 AS DATETIME)');
  translated = translated.replace(/\bAS\s+INTEGER\b/gi, 'AS SIGNED');

  return { sql: translated, params: nextParams };
}

function isRecoverableMysqlError(error: any): boolean {
  const code = String(error?.code || '');
  if (!code) return false;
  return [
    'PROTOCOL_CONNECTION_LOST',
    'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
    'PROTOCOL_ENQUEUE_AFTER_QUIT',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EPIPE',
    'ER_LOCK_DEADLOCK',
    'ER_LOCK_WAIT_TIMEOUT',
  ].includes(code);
}

class SqliteAdapter implements AppDatabase {
  readonly dialect: DatabaseDialect = 'sqlite';

  constructor(private readonly sqliteDb: SqliteDatabase) {}

  async run(sql: string, params?: any[] | any): Promise<{ lastID?: number; changes?: number }> {
    const normalizedParams = normalizeParams(params);
    const result: any = await this.sqliteDb.run(sql, normalizedParams);
    return {
      lastID: result?.lastID,
      changes: result?.changes,
    };
  }

  async get<T = any>(sql: string, params?: any[] | any): Promise<T | undefined> {
    const normalizedParams = normalizeParams(params);
    return this.sqliteDb.get<T>(sql, normalizedParams);
  }

  async all<T = any>(sql: string, params?: any[] | any): Promise<T[]> {
    const normalizedParams = normalizeParams(params);
    const rows = await this.sqliteDb.all<T[]>(sql, normalizedParams);
    return rows as unknown as T[];
  }

  async exec(sql: string): Promise<void> {
    await this.sqliteDb.exec(sql);
  }
}

class MysqlAdapter implements AppDatabase {
  readonly dialect: DatabaseDialect = 'mysql';

  private connection: mysql.Connection | null = null;
  private connectionPromise: Promise<mysql.Connection> | null = null;

  constructor(private readonly config: Config['mysql']) {}

  async initialize(): Promise<void> {
    await this.ensureConnection();
  }

  private async ensureConnection(): Promise<mysql.Connection> {
    if (this.connection) return this.connection;
    if (this.connectionPromise) return this.connectionPromise;

    this.connectionPromise = this.connectWithRetry();

    try {
      this.connection = await this.connectionPromise;
      return this.connection;
    } finally {
      this.connectionPromise = null;
    }
  }

  private async connectWithRetry(): Promise<mysql.Connection> {
    const retries = Math.max(1, this.config.connectionRetries);
    const retryDelayMs = Math.max(250, this.config.connectionRetryDelayMs);

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        const connection = await mysql.createConnection({
          host: this.config.host,
          port: this.config.port,
          user: this.config.user,
          password: this.config.password,
          database: this.config.database,
          charset: 'utf8mb4',
          connectTimeout: this.config.connectTimeoutMs,
          supportBigNumbers: true,
          decimalNumbers: true,
        });

        await connection.query("SET time_zone = '+00:00'");
        return connection;
      } catch (error: any) {
        if (error?.code === 'ER_BAD_DB_ERROR') {
          await this.ensureDatabaseExists();
        }

        if (attempt >= retries) {
          throw error;
        }
        await sleep(retryDelayMs);
      }
    }

    throw new Error('Could not connect to MySQL database');
  }

  private async ensureDatabaseExists(): Promise<void> {
    const bootstrap = await mysql.createConnection({
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      charset: 'utf8mb4',
      connectTimeout: this.config.connectTimeoutMs,
    });

    try {
      const escaped = this.config.database.replace(/`/g, '');
      await bootstrap.query(
        `CREATE DATABASE IF NOT EXISTS \`${escaped}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      );
    } finally {
      await bootstrap.end();
    }
  }

  private async reconnect(): Promise<mysql.Connection> {
    try {
      if (this.connection) {
        await this.connection.end();
      }
    } catch {
      // ignore close errors
    }
    this.connection = null;
    return this.ensureConnection();
  }

  private async queryWithRetry(sql: string, params: any[] = []): Promise<any> {
    const normalizedParams = normalizeMysqlParams(params);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const connection = await this.ensureConnection();
      try {
        const [result] = await connection.query(sql, normalizedParams);
        return result;
      } catch (error: any) {
        if (attempt >= 2 || !isRecoverableMysqlError(error)) {
          throw error;
        }
        await this.reconnect();
      }
    }

    return undefined;
  }

  private extractPragmaTableName(sql: string, pragma: 'table_info' | 'foreign_key_list'): string | null {
    const regex =
      pragma === 'table_info'
        ? /^\s*PRAGMA\s+table_info\(\s*([`"']?)([A-Za-z0-9_]+)\1\s*\)\s*;?\s*$/i
        : /^\s*PRAGMA\s+foreign_key_list\(\s*([`"']?)([A-Za-z0-9_]+)\1\s*\)\s*;?\s*$/i;
    const match = sql.match(regex);
    return match ? String(match[2]) : null;
  }

  private async getPragmaPageCount(): Promise<any> {
    const row: any = await this.queryWithRetry(
      `SELECT COALESCE(SUM(data_length + index_length), 0) AS size_bytes
       FROM information_schema.tables
       WHERE table_schema = DATABASE()`
    );
    const firstRow = Array.isArray(row) ? row[0] : row;
    const pageSize = 16384;
    const bytes = Number(firstRow?.size_bytes || 0);
    const pageCount = Math.max(0, Math.ceil(bytes / pageSize));
    return { page_count: pageCount, pageCount };
  }

  private async getPragmaPageSize(): Promise<any> {
    return { page_size: 16384, pageSize: 16384 };
  }

  private async getPragmaTableInfo(tableName: string): Promise<any[]> {
    const rows: any = await this.queryWithRetry(
      `SELECT
         ordinal_position - 1 AS cid,
         column_name AS name,
         column_type AS type,
         CASE WHEN is_nullable = 'NO' THEN 1 ELSE 0 END AS notnull,
         column_default AS dflt_value,
         CASE WHEN column_key = 'PRI' THEN 1 ELSE 0 END AS pk
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = ?
       ORDER BY ordinal_position`,
      [tableName]
    );
    return Array.isArray(rows) ? rows : [];
  }

  private async getPragmaForeignKeyList(tableName: string): Promise<any[]> {
    const rows: any = await this.queryWithRetry(
      `SELECT
         kcu.constraint_name AS id,
         kcu.ordinal_position AS seq,
         kcu.column_name AS \`from\`,
         kcu.referenced_table_name AS \`table\`,
         kcu.referenced_column_name AS \`to\`,
         COALESCE(rc.update_rule, 'NO ACTION') AS on_update,
         COALESCE(rc.delete_rule, 'NO ACTION') AS on_delete,
         'NONE' AS \`match\`
       FROM information_schema.key_column_usage kcu
       LEFT JOIN information_schema.referential_constraints rc
         ON rc.constraint_schema = kcu.table_schema
        AND rc.table_name = kcu.table_name
        AND rc.constraint_name = kcu.constraint_name
       WHERE kcu.table_schema = DATABASE()
         AND kcu.table_name = ?
         AND kcu.referenced_table_name IS NOT NULL
       ORDER BY kcu.constraint_name, kcu.ordinal_position`,
      [tableName]
    );
    return Array.isArray(rows) ? rows : [];
  }

  private async getSqliteMasterRows(): Promise<any[]> {
    const tableRows: any = await this.queryWithRetry(
      `SELECT
         table_name AS table_name,
         table_type AS table_type
       FROM information_schema.tables
       WHERE table_schema = DATABASE()
       ORDER BY table_name`
    );

    const items = Array.isArray(tableRows) ? tableRows : [];
    const rows: any[] = [];

    for (const item of items) {
      const tableName = String(item?.table_name ?? item?.TABLE_NAME ?? '').trim();
      if (!tableName) continue;
      const tableTypeRaw = String(item?.table_type ?? item?.TABLE_TYPE ?? '').toUpperCase();
      const tableType = tableTypeRaw === 'VIEW' ? 'view' : 'table';
      const escapedTableName = `\`${tableName.replace(/`/g, '``')}\``;

      let createSql = '';
      try {
        if (tableType === 'view') {
          const createViewRows: any = await this.queryWithRetry(`SHOW CREATE VIEW ${escapedTableName}`);
          const first = Array.isArray(createViewRows) ? createViewRows[0] : null;
          createSql = String(first?.['Create View'] || first?.CreateView || '');
        } else {
          const createTableRows: any = await this.queryWithRetry(`SHOW CREATE TABLE ${escapedTableName}`);
          const first = Array.isArray(createTableRows) ? createTableRows[0] : null;
          createSql = String(first?.['Create Table'] || first?.CreateTable || '');
        }
      } catch {
        createSql = '';
      }

      if (!createSql) continue;
      rows.push({
        type: tableType,
        name: tableName,
        tbl_name: tableName,
        sql: createSql,
      });
    }

    return rows;
  }

  async run(sql: string, params?: any[] | any): Promise<{ lastID?: number; changes?: number }> {
    const normalizedParams = normalizeParams(params);
    const { sql: translatedSql, params: translatedParams } = translateSqlForMysql(sql, normalizedParams);
    if (!translatedSql.trim()) {
      return { lastID: 0, changes: 0 };
    }

    const result: any = await this.queryWithRetry(translatedSql, translatedParams);
    if (Array.isArray(result)) {
      return {
        lastID: 0,
        changes: result.length,
      };
    }

    return {
      lastID: Number(result?.insertId || 0),
      changes: Number(result?.affectedRows ?? 0),
    };
  }

  async get<T = any>(sql: string, params?: any[] | any): Promise<T | undefined> {
    const normalizedSql = sql.trim();

    if (/^\s*PRAGMA\s+page_count\s*;?\s*$/i.test(normalizedSql)) {
      return (await this.getPragmaPageCount()) as T;
    }
    if (/^\s*PRAGMA\s+page_size\s*;?\s*$/i.test(normalizedSql)) {
      return (await this.getPragmaPageSize()) as T;
    }

    const normalizedParams = normalizeParams(params);
    const { sql: translatedSql, params: translatedParams } = translateSqlForMysql(sql, normalizedParams);
    if (!translatedSql.trim()) return undefined;

    const rows: any = await this.queryWithRetry(translatedSql, translatedParams);
    if (!Array.isArray(rows) || rows.length === 0) return undefined;
    return rows[0] as T;
  }

  async all<T = any>(sql: string, params?: any[] | any): Promise<T[]> {
    const normalizedSql = sql.trim();

    const pragmaTableInfoName = this.extractPragmaTableName(normalizedSql, 'table_info');
    if (pragmaTableInfoName) {
      return (await this.getPragmaTableInfo(pragmaTableInfoName)) as T[];
    }

    const pragmaForeignKeyName = this.extractPragmaTableName(normalizedSql, 'foreign_key_list');
    if (pragmaForeignKeyName) {
      return (await this.getPragmaForeignKeyList(pragmaForeignKeyName)) as T[];
    }

    if (/\bFROM\s+sqlite_master\b/i.test(normalizedSql)) {
      return (await this.getSqliteMasterRows()) as T[];
    }

    const normalizedParams = normalizeParams(params);
    const { sql: translatedSql, params: translatedParams } = translateSqlForMysql(sql, normalizedParams);
    if (!translatedSql.trim()) return [];

    const rows: any = await this.queryWithRetry(translatedSql, translatedParams);
    return (Array.isArray(rows) ? rows : []) as T[];
  }

  async exec(sql: string): Promise<void> {
    const statements = splitSqlStatements(sql);
    if (statements.length === 0) return;

    for (const statement of statements) {
      const normalized = statement.trim();
      if (!normalized) continue;

      if (/^\s*PRAGMA\s+foreign_keys\s*=\s*(ON|OFF)\s*$/i.test(normalized)) {
        continue;
      }

      if (/^\s*BEGIN(?:\s+TRANSACTION)?\s*$/i.test(normalized)) {
        await this.queryWithRetry('START TRANSACTION');
        continue;
      }

      if (/^\s*COMMIT\s*$/i.test(normalized)) {
        await this.queryWithRetry('COMMIT');
        continue;
      }

      if (/^\s*ROLLBACK\s*$/i.test(normalized)) {
        await this.queryWithRetry('ROLLBACK');
        continue;
      }

      const { sql: translatedSql, params: translatedParams } = translateSqlForMysql(normalized, []);
      if (!translatedSql.trim()) continue;
      try {
        await this.queryWithRetry(translatedSql, translatedParams);
      } catch (error: any) {
        if (isIgnorableCreateIndexError(error, translatedSql)) {
          continue;
        }
        throw error;
      }
    }
  }
}

export async function createDatabaseAdapter(config: Config): Promise<AppDatabase> {
  if (config.databaseClient === 'mysql') {
    const adapter = new MysqlAdapter(config.mysql);
    await adapter.initialize();
    return adapter;
  }

  const dbDir = path.dirname(config.databasePath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const sqliteDb = await open({
    filename: config.databasePath,
    driver: sqlite3.Database,
  });

  await sqliteDb.exec('PRAGMA foreign_keys = ON');
  return new SqliteAdapter(sqliteDb);
}
