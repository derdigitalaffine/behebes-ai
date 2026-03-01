import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import LanguageSelector from '../components/LanguageSelector';
import { useI18n } from '../i18n/I18nProvider';
import './PlatformLanding.css';

const PLATFORM_WORDMARK_REGEX = /(behebes)/gi;
const BLOG_VISIBLE_DEFAULT = 3;

const normalizePath = (value: unknown, fallback = '/'): string => {
  const raw = String(value || '').trim();
  const base = raw || fallback;
  const withLeadingSlash = base.startsWith('/') ? base : `/${base}`;
  const normalized = withLeadingSlash.replace(/\/+$/g, '') || '/';
  return normalized;
};

interface PlatformBlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  contentMd: string;
  status: 'draft' | 'scheduled' | 'published' | 'archived';
  publishedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface PlatformStatsResponse {
  totals?: {
    tickets?: number;
    openTickets?: number;
    tenants?: number;
    adminUsers?: number;
  };
  generatedAt?: string;
}

const summarizeMarkdown = (value: string, maxLength = 96): string => {
  const cleaned = String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/[_*~`>-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength).trimEnd()}…`;
};

const formatBlogDate = (value: string | null, locale: string, fallback: string): string => {
  if (!value) return fallback;
  const parsed = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toLocaleDateString(locale || 'de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

const formatNumber = (value: unknown, locale: string): string => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return '0';
  return new Intl.NumberFormat(locale || 'de-DE').format(Math.floor(numeric));
};

const PlatformWordmark: React.FC<{ className?: string }> = ({ className }) => (
  <span className={`platform-wordmark${className ? ` ${className}` : ''}`} role="text" aria-label="behebes">
    <span className="platform-wordmark-base" aria-hidden="true">beheb</span>
    <span className="platform-wordmark-highlight" aria-hidden="true">es</span>
  </span>
);

const renderPlatformText = (value: unknown): React.ReactNode => {
  const text = String(value || '');
  if (!text) return '';
  const parts = text.split(PLATFORM_WORDMARK_REGEX);
  return parts.map((part, index) => {
    if (part.toLowerCase() !== 'behebes') {
      return <React.Fragment key={`platform-text-${index}`}>{part}</React.Fragment>;
    }
    return <PlatformWordmark key={`platform-wordmark-${index}`} />;
  });
};

const resolveBlogStatusLabel = (
  status: PlatformBlogPost['status'],
  t: (key: string, vars?: Record<string, string | number>) => string
): string => {
  if (status === 'published') return t('platform_blog_status_published');
  if (status === 'scheduled') return t('platform_blog_status_scheduled');
  if (status === 'draft') return t('platform_blog_status_draft');
  return t('platform_blog_status_archived');
};

const PlatformLanding: React.FC = () => {
  const { routing, canonicalBasePath, locale, t } = useI18n();
  const [blogItems, setBlogItems] = useState<PlatformBlogPost[]>([]);
  const [blogLoading, setBlogLoading] = useState(true);
  const [blogError, setBlogError] = useState(false);
  const [showAllBlogItems, setShowAllBlogItems] = useState(false);
  const [platformStats, setPlatformStats] = useState<PlatformStatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const citizenPortalPath = useMemo(() => {
    if (routing.rootMode === 'tenant') return '/';
    const canonical = normalizePath(canonicalBasePath || '/', '/');
    if (canonical !== '/') return canonical;
    const fallbackSlug = String(routing.resolvedTenantSlug || '').trim() || 'default';
    return `/c/${fallbackSlug}`;
  }, [canonicalBasePath, routing.resolvedTenantSlug, routing.rootMode]);

  const signals = useMemo(
    () => [
      t('platform_v2_signal_1'),
      t('platform_v2_signal_2'),
      t('platform_v2_signal_3'),
      t('platform_v2_signal_4'),
      t('platform_v2_signal_5'),
    ],
    [t]
  );

  const valueCards = useMemo(
    () => [
      { title: t('platform_v2_value_title_1'), text: t('platform_v2_value_text_1') },
      { title: t('platform_v2_value_title_2'), text: t('platform_v2_value_text_2') },
      { title: t('platform_v2_value_title_3'), text: t('platform_v2_value_text_3') },
      { title: t('platform_v2_value_title_4'), text: t('platform_v2_value_text_4') },
    ],
    [t]
  );

  const heroStats = useMemo(
    () => [
      {
        label: t('platform_stat_1_label'),
        value: statsLoading ? t('platform_stat_loading') : formatNumber(platformStats?.totals?.tickets, locale),
      },
      {
        label: t('platform_stat_2_label'),
        value: statsLoading ? t('platform_stat_loading') : formatNumber(platformStats?.totals?.openTickets, locale),
      },
      {
        label: t('platform_stat_3_label'),
        value: statsLoading ? t('platform_stat_loading') : formatNumber(platformStats?.totals?.adminUsers, locale),
      },
      {
        label: t('platform_stat_4_label'),
        value: statsLoading ? t('platform_stat_loading') : formatNumber(platformStats?.totals?.tenants, locale),
      },
    ],
    [locale, platformStats?.totals?.adminUsers, platformStats?.totals?.openTickets, platformStats?.totals?.tenants, platformStats?.totals?.tickets, statsLoading, t]
  );

  useEffect(() => {
    let active = true;
    const loadBlog = async () => {
      setBlogLoading(true);
      try {
        const response = await fetch('/api/platform/blog?limit=8', {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (!active) return;
        const items = Array.isArray(payload?.items) ? payload.items : [];
        setBlogItems(items as PlatformBlogPost[]);
        setBlogError(false);
      } catch {
        if (!active) return;
        setBlogItems([]);
        setBlogError(true);
      } finally {
        if (active) setBlogLoading(false);
      }
    };

    void loadBlog();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadStats = async () => {
      setStatsLoading(true);
      try {
        const response = await fetch('/api/platform/stats', {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as PlatformStatsResponse;
        if (!active) return;
        setPlatformStats(payload);
      } catch {
        if (!active) return;
        setPlatformStats(null);
      } finally {
        if (active) setStatsLoading(false);
      }
    };

    void loadStats();
    return () => {
      active = false;
    };
  }, []);

  const visibleBlogItems = useMemo(() => {
    if (showAllBlogItems) return blogItems;
    return blogItems.slice(0, BLOG_VISIBLE_DEFAULT);
  }, [blogItems, showAllBlogItems]);

  const hiddenBlogItemsCount = Math.max(0, blogItems.length - BLOG_VISIBLE_DEFAULT);

  return (
    <section className="platform-v2" aria-label={t('platform_aria_overview')}>
      <div className="platform-v2-bg" aria-hidden="true" />
      <div className="platform-v2-gridfx" aria-hidden="true" />

      <header className="platform-v2-topbar">
        <Link to={citizenPortalPath} className="platform-v2-brand" aria-label={t('platform_cta_citizen')}>
          <img src="/logo.png" alt={t('platform_brand_product_alt')} />
          <PlatformWordmark className="platform-v2-brand-word" />
        </Link>
        <div className="platform-v2-topbar-right">
          <span className="platform-v2-badge">{renderPlatformText(t('platform_v2_top_badge'))}</span>
          <div className="platform-v2-lang">
            <LanguageSelector />
          </div>
        </div>
      </header>

      <section className="platform-v2-hero">
        <div className="platform-v2-hero-copy">
          <p className="platform-v2-kicker">{renderPlatformText(t('platform_v2_kicker'))}</p>
          <h1>{renderPlatformText(t('platform_v2_title'))}</h1>
          <p>{renderPlatformText(t('platform_v2_subtitle'))}</p>

          <div className="platform-v2-cta-row">
            <Link to={citizenPortalPath} className="platform-v2-btn">
              {renderPlatformText(t('platform_v2_cta_citizen'))}
            </Link>
            <a href="/ops" className="platform-v2-btn platform-v2-btn--ops">
              {renderPlatformText(t('platform_v2_cta_ops'))}
            </a>
            <a
              href="https://github.com/derdigitalaffine/behebes-ai"
              target="_blank"
              rel="noreferrer"
              className="platform-v2-btn platform-v2-btn--ghost"
            >
              {renderPlatformText(t('platform_v2_cta_github'))}
            </a>
          </div>

          <ul className="platform-v2-signals" aria-label={t('platform_hero_keywords_aria')}>
            {signals.map((signal) => (
              <li key={signal}>{renderPlatformText(signal)}</li>
            ))}
          </ul>
        </div>

        <aside className="platform-v2-hero-side" aria-label={t('platform_brand_stack_aria')}>
          <div className="platform-v2-metrics" role="list" aria-label={t('platform_stats_aria')}>
            {heroStats.map((item) => (
              <article key={item.label} className="platform-v2-metric" role="listitem">
                <span>{renderPlatformText(item.label)}</span>
                <strong>{renderPlatformText(item.value)}</strong>
              </article>
            ))}
          </div>

          <div className="platform-v2-brandwall">
            <article>
              <img src="/logo.png" alt={t('platform_brand_product_alt')} />
              <p>{renderPlatformText(t('platform_brand_product_caption'))}</p>
            </article>
            <article>
              <img src="/verbandsgemeinde-otterbach-otterberg-logo.jpg" alt={t('platform_brand_partner_alt')} />
              <p>{renderPlatformText(t('platform_brand_partner_caption'))}</p>
            </article>
          </div>
        </aside>
      </section>

      <main className="platform-v2-main">
        <section className="platform-v2-values" aria-label={t('platform_v2_values_aria')}>
          <div className="platform-v2-headline">
            <h2>{renderPlatformText(t('platform_v2_values_title'))}</h2>
            <p>{renderPlatformText(t('platform_v2_values_subtitle'))}</p>
          </div>
          <div className="platform-v2-value-grid">
            {valueCards.map((card, idx) => (
              <article key={card.title} className="platform-v2-value-card">
                <span>{`0${idx + 1}`}</span>
                <h3>{renderPlatformText(card.title)}</h3>
                <p>{renderPlatformText(card.text)}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="platform-v2-story" aria-label={t('platform_v2_story_aria')}>
          <div className="platform-v2-headline">
            <h2>{renderPlatformText(t('platform_v2_story_title'))}</h2>
          </div>
          <ul>
            <li>{renderPlatformText(t('platform_v2_story_point_1'))}</li>
            <li>{renderPlatformText(t('platform_v2_story_point_2'))}</li>
            <li>{renderPlatformText(t('platform_v2_story_point_3'))}</li>
          </ul>
          <p className="platform-v2-story-meta">
            {renderPlatformText(t('platform_stats_updated_label'))}:{' '}
            {formatBlogDate(platformStats?.generatedAt || null, locale, t('platform_blog_date_fallback'))}
          </p>
        </section>

        <section className="platform-v2-blog" aria-label={t('platform_blog_aria')}>
          <div className="platform-v2-headline platform-v2-headline--blog">
            <h2>{renderPlatformText(t('platform_v2_blog_title'))}</h2>
          </div>

          {blogError ? (
            <p className="platform-v2-blog-empty">{renderPlatformText(t('platform_blog_error'))}</p>
          ) : blogLoading ? (
            <p className="platform-v2-blog-empty">{renderPlatformText(t('platform_blog_loading'))}</p>
          ) : blogItems.length === 0 ? (
            <p className="platform-v2-blog-empty">{renderPlatformText(t('platform_blog_empty'))}</p>
          ) : (
            <>
              <div className="platform-v2-blog-list">
                {visibleBlogItems.map((post) => {
                  const teaser = post.excerpt || summarizeMarkdown(post.contentMd) || t('platform_blog_teaser_fallback');
                  const statusLabel = resolveBlogStatusLabel(post.status, t);
                  return (
                    <article key={post.id} className="platform-v2-blog-card">
                      <div className="platform-v2-blog-meta">
                        <time dateTime={post.publishedAt || post.createdAt || undefined}>
                          {formatBlogDate(post.publishedAt || post.createdAt, locale, t('platform_blog_date_fallback'))}
                        </time>
                        <span className={`platform-v2-blog-status status-${post.status}`}>{renderPlatformText(statusLabel)}</span>
                      </div>
                      <h3>{renderPlatformText(post.title)}</h3>
                      <p>{renderPlatformText(teaser)}</p>
                    </article>
                  );
                })}
              </div>

              {hiddenBlogItemsCount > 0 ? (
                <button
                  type="button"
                  className="platform-v2-blog-toggle"
                  onClick={() => setShowAllBlogItems((current) => !current)}
                >
                  {showAllBlogItems
                    ? renderPlatformText(t('platform_blog_show_less'))
                    : renderPlatformText(
                        t('platform_blog_show_more', {
                          count: hiddenBlogItemsCount,
                        })
                      )}
                </button>
              ) : null}
            </>
          )}
        </section>
      </main>
    </section>
  );
};

export default PlatformLanding;
