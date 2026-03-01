import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import LanguageSelector from '../components/LanguageSelector';
import { useI18n } from '../i18n/I18nProvider';
import './PlatformLanding.css';

const PLATFORM_WORDMARK_REGEX = /(behebes)/gi;
const BLOG_VISIBLE_DEFAULT = 6;

type PlatformSubPage = 'home' | 'opensource' | 'product' | 'news';

const normalizePath = (value: unknown, fallback = '/'): string => {
  const raw = String(value || '').trim();
  const base = raw || fallback;
  const withLeadingSlash = base.startsWith('/') ? base : `/${base}`;
  return withLeadingSlash.replace(/\/+$/g, '') || '/';
};

const buildSubPagePath = (platformPath: string, subPage: PlatformSubPage): string => {
  const base = normalizePath(platformPath || '/plattform', '/plattform');
  if (subPage === 'home') return base;
  if (base === '/') return `/${subPage}`;
  return `${base}/${subPage}`;
};

const resolveSubPage = (pathname: string, platformPath: string): PlatformSubPage => {
  const normalizedPath = normalizePath(pathname || '/', '/');
  const normalizedBase = normalizePath(platformPath || '/plattform', '/plattform');

  let remainder = '';
  if (normalizedBase === '/') {
    remainder = normalizedPath.replace(/^\/+|\/+$/g, '');
  } else if (normalizedPath === normalizedBase) {
    remainder = '';
  } else if (normalizedPath.startsWith(`${normalizedBase}/`)) {
    remainder = normalizedPath.slice(normalizedBase.length + 1);
  } else {
    remainder = '';
  }

  const section = String(remainder || '')
    .split('/')
    .filter(Boolean)[0]
    ?.toLowerCase();
  if (section === 'opensource') return 'opensource';
  if (section === 'product') return 'product';
  if (section === 'news') return 'news';
  return 'home';
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

const summarizeMarkdown = (value: string, maxLength = 140): string => {
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
    <span className="platform-wordmark-base" aria-hidden="true">
      beheb
    </span>
    <span className="platform-wordmark-highlight" aria-hidden="true">
      es
    </span>
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
  const location = useLocation();
  const [blogItems, setBlogItems] = useState<PlatformBlogPost[]>([]);
  const [blogLoading, setBlogLoading] = useState(true);
  const [blogError, setBlogError] = useState(false);
  const [showAllBlogItems, setShowAllBlogItems] = useState(false);
  const [platformStats, setPlatformStats] = useState<PlatformStatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const platformPath = useMemo(() => normalizePath(routing.platformPath || '/plattform', '/plattform'), [routing.platformPath]);

  const activeSubPage = useMemo(() => resolveSubPage(location.pathname, platformPath), [location.pathname, platformPath]);

  const citizenPortalPath = useMemo(() => {
    if (routing.rootMode === 'tenant') return '/';
    const canonical = normalizePath(canonicalBasePath || '/', '/');
    if (canonical !== '/') return canonical;
    const fallbackSlug = String(routing.resolvedTenantSlug || '').trim() || 'default';
    return `/c/${fallbackSlug}`;
  }, [canonicalBasePath, routing.resolvedTenantSlug, routing.rootMode]);

  const navItems = useMemo(
    () => [
      { id: 'home' as PlatformSubPage, label: t('platform_v3_nav_home') },
      { id: 'opensource' as PlatformSubPage, label: t('platform_v3_nav_opensource') },
      { id: 'product' as PlatformSubPage, label: t('platform_v3_nav_product') },
      { id: 'news' as PlatformSubPage, label: t('platform_v3_nav_news') },
    ],
    [t]
  );

  const signals = useMemo(
    () => [
      t('platform_v3_signal_1'),
      t('platform_v3_signal_2'),
      t('platform_v3_signal_3'),
      t('platform_v3_signal_4'),
      t('platform_v3_signal_5'),
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
        const response = await fetch('/api/platform/blog?limit=24', {
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

  const renderBlogList = (compact: boolean) => {
    const source = compact ? blogItems.slice(0, 3) : visibleBlogItems;
    if (blogError) {
      return <p className="platform-v3-empty">{renderPlatformText(t('platform_blog_error'))}</p>;
    }
    if (blogLoading) {
      return <p className="platform-v3-empty">{renderPlatformText(t('platform_blog_loading'))}</p>;
    }
    if (source.length === 0) {
      return <p className="platform-v3-empty">{renderPlatformText(t('platform_blog_empty'))}</p>;
    }

    return (
      <>
        <div className={`platform-v3-blog-list${compact ? ' compact' : ''}`}>
          {source.map((post) => {
            const teaser = post.excerpt || summarizeMarkdown(post.contentMd) || t('platform_blog_teaser_fallback');
            const statusLabel = resolveBlogStatusLabel(post.status, t);
            return (
              <article key={post.id} className="platform-v3-blog-card">
                <div className="platform-v3-blog-meta">
                  <time dateTime={post.publishedAt || post.createdAt || undefined}>
                    {formatBlogDate(post.publishedAt || post.createdAt, locale, t('platform_blog_date_fallback'))}
                  </time>
                  <span className={`platform-v3-blog-status status-${post.status}`}>{renderPlatformText(statusLabel)}</span>
                </div>
                <h3>{renderPlatformText(post.title)}</h3>
                <p>{renderPlatformText(teaser)}</p>
              </article>
            );
          })}
        </div>
        {!compact && hiddenBlogItemsCount > 0 ? (
          <button
            type="button"
            className="platform-v3-blog-toggle"
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
    );
  };

  return (
    <section className="platform-v3" aria-label={t('platform_aria_overview')}>
      <div className="platform-v3-bg" aria-hidden="true" />
      <div className="platform-v3-gridfx" aria-hidden="true" />

      <header className="platform-v3-topbar">
        <Link to={citizenPortalPath} className="platform-v3-brand" aria-label={t('platform_cta_citizen')}>
          <img src="/logo.png" alt={t('platform_brand_product_alt')} />
          <PlatformWordmark className="platform-v3-brand-word" />
        </Link>
        <div className="platform-v3-topbar-right">
          <span className="platform-v3-badge">{renderPlatformText(t('platform_v3_badge'))}</span>
          <div className="platform-v3-lang">
            <LanguageSelector />
          </div>
        </div>
      </header>

      <nav className="platform-v3-nav" aria-label={t('platform_v3_nav_aria')}>
        {navItems.map((item) => {
          const isActive = activeSubPage === item.id;
          return (
            <Link
              key={item.id}
              to={buildSubPagePath(platformPath, item.id)}
              className={`platform-v3-nav-link${isActive ? ' active' : ''}`}
            >
              {renderPlatformText(item.label)}
            </Link>
          );
        })}
      </nav>

      <main className="platform-v3-main">
        {activeSubPage === 'home' ? (
          <>
            <section className="platform-v3-hero">
              <div className="platform-v3-hero-copy">
                <p className="platform-v3-kicker">{renderPlatformText(t('platform_v3_kicker'))}</p>
                <h1>{renderPlatformText(t('platform_v3_title'))}</h1>
                <p>{renderPlatformText(t('platform_v3_subtitle'))}</p>

                <div className="platform-v3-cta-row">
                  <Link to={citizenPortalPath} className="platform-v3-btn platform-v3-btn--primary">
                    {renderPlatformText(t('platform_v3_cta_citizen'))}
                  </Link>
                  <a href="/ops" className="platform-v3-btn platform-v3-btn--ops">
                    {renderPlatformText(t('platform_v3_cta_ops'))}
                  </a>
                  <a href="/api/docs" className="platform-v3-btn platform-v3-btn--swagger" target="_blank" rel="noreferrer">
                    {renderPlatformText(t('platform_v3_cta_swagger'))}
                  </a>
                  <a
                    href="https://github.com/derdigitalaffine/behebes-ai"
                    target="_blank"
                    rel="noreferrer"
                    className="platform-v3-btn platform-v3-btn--ghost"
                  >
                    {renderPlatformText(t('platform_v3_cta_github'))}
                  </a>
                </div>

                <ul className="platform-v3-signals" aria-label={t('platform_hero_keywords_aria')}>
                  {signals.map((signal) => (
                    <li key={signal}>{renderPlatformText(signal)}</li>
                  ))}
                </ul>
              </div>

              <aside className="platform-v3-hero-side" aria-label={t('platform_brand_stack_aria')}>
                <div className="platform-v3-metrics" role="list" aria-label={t('platform_stats_aria')}>
                  {heroStats.map((item) => (
                    <article key={item.label} className="platform-v3-metric" role="listitem">
                      <span>{renderPlatformText(item.label)}</span>
                      <strong>{renderPlatformText(item.value)}</strong>
                    </article>
                  ))}
                </div>
                <p className="platform-v3-metrics-meta">
                  {renderPlatformText(t('platform_stats_updated_label'))}:{' '}
                  {formatBlogDate(platformStats?.generatedAt || null, locale, t('platform_blog_date_fallback'))}
                </p>
              </aside>
            </section>

            <section className="platform-v3-grid">
              <article className="platform-v3-panel">
                <h2>{renderPlatformText(t('platform_v3_pitch_title'))}</h2>
                <p>{renderPlatformText(t('platform_v3_pitch_text'))}</p>
              </article>

              <article className="platform-v3-panel">
                <h2>{renderPlatformText(t('platform_v3_links_title'))}</h2>
                <ul className="platform-v3-link-list">
                  <li>
                    <strong>{renderPlatformText(t('platform_v3_link_vg_title'))}</strong>
                    <p>{renderPlatformText(t('platform_v3_link_vg_text'))}</p>
                    <a href="https://www.otterbach-otterberg.de" target="_blank" rel="noreferrer">
                      {renderPlatformText(t('platform_v3_link_vg_cta'))}
                    </a>
                  </li>
                  <li>
                    <strong>{renderPlatformText(t('platform_v3_link_maintainer_title'))}</strong>
                    <p>{renderPlatformText(t('platform_v3_link_maintainer_text'))}</p>
                    <a href="https://www.tromu.de" target="_blank" rel="noreferrer">
                      {renderPlatformText(t('platform_v3_link_tromu_cta'))}
                    </a>
                  </li>
                </ul>
              </article>

              <article className="platform-v3-panel">
                <h2>{renderPlatformText(t('platform_v3_logo_stack_title'))}</h2>
                <p>{renderPlatformText(t('platform_v3_logo_stack_text'))}</p>
                <div className="platform-v3-logo-stack">
                  <figure>
                    <img src="/logo.png" alt={t('platform_brand_product_alt')} />
                    <figcaption>{renderPlatformText(t('platform_v3_logo_citizen_label'))}</figcaption>
                  </figure>
                  <figure>
                    <img src="/logo-admin.png" alt={t('platform_v3_logo_admin_alt')} />
                    <figcaption>{renderPlatformText(t('platform_v3_logo_admin_label'))}</figcaption>
                  </figure>
                  <figure>
                    <img src="/logo-ops.png" alt={t('platform_v3_logo_ops_alt')} />
                    <figcaption>{renderPlatformText(t('platform_v3_logo_ops_label'))}</figcaption>
                  </figure>
                </div>
              </article>

              <article className="platform-v3-panel platform-v3-panel--wide">
                <div className="platform-v3-panel-head">
                  <h2>{renderPlatformText(t('platform_v3_news_teaser_title'))}</h2>
                  <Link to={buildSubPagePath(platformPath, 'news')} className="platform-v3-inline-link">
                    {renderPlatformText(t('platform_v3_news_teaser_cta'))}
                  </Link>
                </div>
                {renderBlogList(true)}
              </article>
            </section>
          </>
        ) : null}

        {activeSubPage === 'opensource' ? (
          <section className="platform-v3-section">
            <header className="platform-v3-section-head">
              <h2>{renderPlatformText(t('platform_v3_open_title'))}</h2>
              <p>{renderPlatformText(t('platform_v3_open_intro'))}</p>
            </header>
            <div className="platform-v3-card-grid">
              {[1, 2, 3, 4].map((index) => (
                <article key={`open-${index}`} className="platform-v3-card">
                  <span>{`0${index}`}</span>
                  <h3>{renderPlatformText(t(`platform_v3_open_point_${index}_title`))}</h3>
                  <p>{renderPlatformText(t(`platform_v3_open_point_${index}_text`))}</p>
                </article>
              ))}
            </div>
            <p className="platform-v3-section-footnote">{renderPlatformText(t('platform_v3_open_license'))}</p>
          </section>
        ) : null}

        {activeSubPage === 'product' ? (
          <section className="platform-v3-section">
            <header className="platform-v3-section-head">
              <h2>{renderPlatformText(t('platform_v3_product_title'))}</h2>
              <p>{renderPlatformText(t('platform_v3_product_intro'))}</p>
            </header>

            <div className="platform-v3-card-grid">
              {[1, 2, 3, 4].map((index) => (
                <article key={`product-${index}`} className="platform-v3-card">
                  <span>{`0${index}`}</span>
                  <h3>{renderPlatformText(t(`platform_v3_product_card_${index}_title`))}</h3>
                  <p>{renderPlatformText(t(`platform_v3_product_card_${index}_text`))}</p>
                </article>
              ))}
            </div>

            <article className="platform-v3-flow">
              <h3>{renderPlatformText(t('platform_v3_product_flow_title'))}</h3>
              <ol>
                <li>{renderPlatformText(t('platform_v3_product_flow_step_1'))}</li>
                <li>{renderPlatformText(t('platform_v3_product_flow_step_2'))}</li>
                <li>{renderPlatformText(t('platform_v3_product_flow_step_3'))}</li>
                <li>{renderPlatformText(t('platform_v3_product_flow_step_4'))}</li>
              </ol>
            </article>
          </section>
        ) : null}

        {activeSubPage === 'news' ? (
          <section className="platform-v3-section">
            <header className="platform-v3-section-head">
              <h2>{renderPlatformText(t('platform_v3_news_title'))}</h2>
              <p>{renderPlatformText(t('platform_v3_news_intro'))}</p>
            </header>
            {renderBlogList(false)}
          </section>
        ) : null}
      </main>
    </section>
  );
};

export default PlatformLanding;
