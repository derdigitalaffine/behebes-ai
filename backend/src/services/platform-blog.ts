import { getDatabase } from '../database.js';
import { formatSqlDateTime } from '../utils/sql-date.js';

export type PlatformBlogStatus = 'draft' | 'scheduled' | 'published' | 'archived';

export interface PlatformBlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  contentMd: string;
  status: PlatformBlogStatus;
  publishedAt: string | null;
  createdByAdminId: string | null;
  updatedByAdminId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  effectiveStatus: 'draft' | 'scheduled' | 'published' | 'archived';
  isPublished: boolean;
}

export interface PlatformBlogListOptions {
  status?: 'all' | PlatformBlogStatus;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface PlatformBlogPublicListOptions {
  limit?: number;
  offset?: number;
}

export interface PlatformBlogMutationInput {
  title?: unknown;
  slug?: unknown;
  excerpt?: unknown;
  contentMd?: unknown;
  status?: unknown;
  publishedAt?: unknown;
}

const BLOG_STATUSES: PlatformBlogStatus[] = ['draft', 'scheduled', 'published', 'archived'];

function sanitizeText(value: unknown, maxLength: number): string {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeSlug(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase();
  return raw
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 160);
}

function slugFromTitle(title: string): string {
  const normalized = normalizeSlug(title);
  if (normalized) return normalized;
  return `post-${Date.now().toString(36)}`;
}

function normalizeStatus(value: unknown, fallback: PlatformBlogStatus = 'draft'): PlatformBlogStatus {
  const normalized = String(value || '').trim().toLowerCase();
  if (BLOG_STATUSES.includes(normalized as PlatformBlogStatus)) {
    return normalized as PlatformBlogStatus;
  }
  return fallback;
}

function parseDateMs(value: unknown): number {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  let withTimezone = raw;
  if (!/z$|[+-]\d{2}:\d{2}$/i.test(withTimezone)) {
    if (withTimezone.includes(' ')) {
      withTimezone = withTimezone.replace(' ', 'T');
    }
    withTimezone = `${withTimezone}Z`;
  }
  const parsed = new Date(withTimezone);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function normalizePublishedAt(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const parsedMs = parseDateMs(value);
  if (!parsedMs) return null;
  return formatSqlDateTime(new Date(parsedMs));
}

function mapRow(row: any): PlatformBlogPost | null {
  if (!row) return null;
  const id = String(row.id || '').trim();
  const slug = normalizeSlug(row.slug);
  const title = sanitizeText(row.title, 300);
  const contentMd = String(row.content_md || '').trim();
  if (!id || !slug || !title || !contentMd) return null;
  const status = normalizeStatus(row.status, 'draft');
  const nowMs = Date.now();
  const publishedAt = row.published_at ? String(row.published_at) : null;
  const publishedAtMs = parseDateMs(publishedAt);

  let effectiveStatus: PlatformBlogPost['effectiveStatus'] = status;
  if (status === 'scheduled' && publishedAtMs && publishedAtMs <= nowMs) {
    effectiveStatus = 'published';
  }
  if (status === 'published' && publishedAtMs && publishedAtMs > nowMs) {
    effectiveStatus = 'scheduled';
  }

  const isPublished = effectiveStatus === 'published';

  return {
    id,
    slug,
    title,
    excerpt: String(row.excerpt || '').trim(),
    contentMd,
    status,
    publishedAt,
    createdByAdminId: row.created_by_admin_id ? String(row.created_by_admin_id) : null,
    updatedByAdminId: row.updated_by_admin_id ? String(row.updated_by_admin_id) : null,
    createdAt: row.created_at ? String(row.created_at) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
    effectiveStatus,
    isPublished,
  };
}

function clampLimit(value: unknown, fallback = 20, max = 200): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

function clampOffset(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function comparePostsDesc(left: PlatformBlogPost, right: PlatformBlogPost): number {
  const leftPrimary = parseDateMs(left.publishedAt || left.createdAt) || 0;
  const rightPrimary = parseDateMs(right.publishedAt || right.createdAt) || 0;
  if (leftPrimary !== rightPrimary) return rightPrimary - leftPrimary;
  const leftUpdated = parseDateMs(left.updatedAt || left.createdAt) || 0;
  const rightUpdated = parseDateMs(right.updatedAt || right.createdAt) || 0;
  if (leftUpdated !== rightUpdated) return rightUpdated - leftUpdated;
  return right.title.localeCompare(left.title, 'de');
}

async function slugExists(slug: string, excludeId = ''): Promise<boolean> {
  const db = getDatabase();
  if (excludeId) {
    const row = await db.get<any>(
      `SELECT id FROM platform_blog_posts WHERE slug = ? AND id <> ? LIMIT 1`,
      [slug, excludeId]
    );
    return !!row?.id;
  }
  const row = await db.get<any>(`SELECT id FROM platform_blog_posts WHERE slug = ? LIMIT 1`, [slug]);
  return !!row?.id;
}

async function ensureUniqueSlug(base: string, excludeId = ''): Promise<string> {
  const normalizedBase = normalizeSlug(base) || `post-${Date.now().toString(36)}`;
  if (!(await slugExists(normalizedBase, excludeId))) return normalizedBase;

  for (let index = 2; index <= 5000; index += 1) {
    const candidate = normalizeSlug(`${normalizedBase}-${index}`);
    if (!candidate) continue;
    if (!(await slugExists(candidate, excludeId))) return candidate;
  }

  return `${normalizedBase}-${Date.now().toString(36)}`;
}

function applyLifecycleRules(input: {
  status: PlatformBlogStatus;
  publishedAt: string | null;
}): { status: PlatformBlogStatus; publishedAt: string | null } {
  const next = {
    status: input.status,
    publishedAt: input.publishedAt,
  };

  if (next.status === 'scheduled') {
    if (!next.publishedAt) {
      throw new Error('Für geplante Beiträge ist ein Veröffentlichungszeitpunkt erforderlich.');
    }
    return next;
  }

  if (next.status === 'published') {
    if (!next.publishedAt) {
      next.publishedAt = formatSqlDateTime(new Date());
    }
    return next;
  }

  if (next.status === 'draft') {
    return {
      ...next,
      publishedAt: null,
    };
  }

  return next;
}

export async function listPlatformBlogPosts(
  options: PlatformBlogListOptions = {}
): Promise<{ items: PlatformBlogPost[]; total: number; limit: number; offset: number }> {
  const db = getDatabase();
  const status = options.status && options.status !== 'all' ? normalizeStatus(options.status) : 'all';
  const search = sanitizeText(options.search, 120).toLowerCase();
  const limit = clampLimit(options.limit, 50, 300);
  const offset = clampOffset(options.offset);

  const rows = await db.all<any>(
    `SELECT id, slug, title, excerpt, content_md, status, published_at, created_by_admin_id, updated_by_admin_id, created_at, updated_at
     FROM platform_blog_posts`
  );

  const allItems = (rows || [])
    .map((row) => mapRow(row))
    .filter((row): row is PlatformBlogPost => !!row)
    .filter((row) => (status === 'all' ? true : row.status === status))
    .filter((row) => {
      if (!search) return true;
      const haystack = `${row.title}\n${row.excerpt}\n${row.slug}`.toLowerCase();
      return haystack.includes(search);
    })
    .sort(comparePostsDesc);

  return {
    items: allItems.slice(offset, offset + limit),
    total: allItems.length,
    limit,
    offset,
  };
}

export async function listPublicPlatformBlogPosts(
  options: PlatformBlogPublicListOptions = {}
): Promise<{ items: PlatformBlogPost[]; total: number; limit: number; offset: number }> {
  const limit = clampLimit(options.limit, 12, 120);
  const offset = clampOffset(options.offset);

  const db = getDatabase();
  const rows = await db.all<any>(
    `SELECT id, slug, title, excerpt, content_md, status, published_at, created_by_admin_id, updated_by_admin_id, created_at, updated_at
     FROM platform_blog_posts`
  );
  const publishedItems = (rows || [])
    .map((row) => mapRow(row))
    .filter((row): row is PlatformBlogPost => !!row)
    .filter((item) => item.isPublished && item.status !== 'archived')
    .sort(comparePostsDesc);

  return {
    items: publishedItems.slice(offset, offset + limit),
    total: publishedItems.length,
    limit,
    offset,
  };
}

export async function getPlatformBlogPostById(id: string): Promise<PlatformBlogPost | null> {
  const normalizedId = sanitizeText(id, 120);
  if (!normalizedId) return null;
  const db = getDatabase();
  const row = await db.get<any>(
    `SELECT id, slug, title, excerpt, content_md, status, published_at, created_by_admin_id, updated_by_admin_id, created_at, updated_at
     FROM platform_blog_posts
     WHERE id = ?
     LIMIT 1`,
    [normalizedId]
  );
  return mapRow(row);
}

export async function getPlatformBlogPostBySlug(slug: string): Promise<PlatformBlogPost | null> {
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug) return null;
  const db = getDatabase();
  const row = await db.get<any>(
    `SELECT id, slug, title, excerpt, content_md, status, published_at, created_by_admin_id, updated_by_admin_id, created_at, updated_at
     FROM platform_blog_posts
     WHERE slug = ?
     LIMIT 1`,
    [normalizedSlug]
  );
  const mapped = mapRow(row);
  if (!mapped || !mapped.isPublished || mapped.status === 'archived') return null;
  return mapped;
}

export async function createPlatformBlogPost(input: PlatformBlogMutationInput, actorAdminUserId: string): Promise<PlatformBlogPost> {
  const title = sanitizeText(input.title, 240);
  if (!title) throw new Error('Titel ist erforderlich.');
  const excerpt = sanitizeText(input.excerpt, 700);
  const contentMd = String(input.contentMd || '').trim();
  if (!contentMd) throw new Error('Inhalt ist erforderlich.');

  const status = normalizeStatus(input.status, 'draft');
  const publishedAtRaw = normalizePublishedAt(input.publishedAt);
  const lifecycle = applyLifecycleRules({ status, publishedAt: publishedAtRaw });

  const requestedSlug = normalizeSlug(input.slug) || slugFromTitle(title);
  const uniqueSlug = await ensureUniqueSlug(requestedSlug);

  const id = `pblog_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const actor = sanitizeText(actorAdminUserId, 120) || null;

  const db = getDatabase();
  await db.run(
    `INSERT INTO platform_blog_posts (
      id, slug, title, excerpt, content_md, status, published_at, created_by_admin_id, updated_by_admin_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [id, uniqueSlug, title, excerpt || null, contentMd, lifecycle.status, lifecycle.publishedAt, actor, actor]
  );

  const created = await getPlatformBlogPostById(id);
  if (!created) throw new Error('Beitrag konnte nach dem Speichern nicht geladen werden.');
  return created;
}

export async function updatePlatformBlogPost(
  id: string,
  input: PlatformBlogMutationInput,
  actorAdminUserId: string
): Promise<PlatformBlogPost | null> {
  const existing = await getPlatformBlogPostById(id);
  if (!existing) return null;

  const title = Object.prototype.hasOwnProperty.call(input, 'title')
    ? sanitizeText(input.title, 240)
    : existing.title;
  if (!title) throw new Error('Titel ist erforderlich.');

  const contentMd = Object.prototype.hasOwnProperty.call(input, 'contentMd')
    ? String(input.contentMd || '').trim()
    : existing.contentMd;
  if (!contentMd) throw new Error('Inhalt ist erforderlich.');

  const excerpt = Object.prototype.hasOwnProperty.call(input, 'excerpt')
    ? sanitizeText(input.excerpt, 700)
    : existing.excerpt;

  const status = Object.prototype.hasOwnProperty.call(input, 'status')
    ? normalizeStatus(input.status, existing.status)
    : existing.status;

  const publishedAtInput = Object.prototype.hasOwnProperty.call(input, 'publishedAt')
    ? normalizePublishedAt(input.publishedAt)
    : existing.publishedAt;

  const lifecycle = applyLifecycleRules({
    status,
    publishedAt: publishedAtInput,
  });

  const slugCandidate = Object.prototype.hasOwnProperty.call(input, 'slug')
    ? normalizeSlug(input.slug)
    : existing.slug;
  const nextSlug = await ensureUniqueSlug(slugCandidate || slugFromTitle(title), existing.id);

  const actor = sanitizeText(actorAdminUserId, 120) || null;
  const db = getDatabase();
  await db.run(
    `UPDATE platform_blog_posts
     SET slug = ?,
         title = ?,
         excerpt = ?,
         content_md = ?,
         status = ?,
         published_at = ?,
         updated_by_admin_id = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      nextSlug,
      title,
      excerpt || null,
      contentMd,
      lifecycle.status,
      lifecycle.publishedAt,
      actor,
      existing.id,
    ]
  );

  return getPlatformBlogPostById(existing.id);
}

export async function deletePlatformBlogPost(id: string): Promise<{ deleted: number }> {
  const normalizedId = sanitizeText(id, 120);
  if (!normalizedId) return { deleted: 0 };
  const db = getDatabase();
  const result = await db.run(`DELETE FROM platform_blog_posts WHERE id = ?`, [normalizedId]);
  return { deleted: Number(result?.changes || 0) };
}
