import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import LanguageSelector from '../components/LanguageSelector';
import { useI18n } from '../i18n/I18nProvider';
import './PlatformLanding.css';

const PLATFORM_WORDMARK_REGEX = /(behebes)/gi;
const BLOG_VISIBLE_DEFAULT = 4;

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
    citizens?: number;
    activeInternalTasks?: number;
    publishedBlogPosts?: number;
  };
  lastTicketUpdateAt?: string | null;
  generatedAt?: string;
}

const summarizeMarkdown = (value: string, maxLength = 150): string => {
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
    month: 'long',
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
  const landingRef = useRef<HTMLElement | null>(null);
  const [blogItems, setBlogItems] = useState<PlatformBlogPost[]>([]);
  const [blogLoading, setBlogLoading] = useState(true);
  const [blogError, setBlogError] = useState(false);
  const [showAllBlogItems, setShowAllBlogItems] = useState(false);
  const [platformStats, setPlatformStats] = useState<PlatformStatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [parallaxOffset, setParallaxOffset] = useState(0);

  const citizenPortalPath = useMemo(() => {
    if (routing.rootMode === 'tenant') return '/';
    const canonical = normalizePath(canonicalBasePath || '/', '/');
    if (canonical !== '/') return canonical;
    const fallbackSlug = String(routing.resolvedTenantSlug || '').trim() || 'default';
    return `/c/${fallbackSlug}`;
  }, [canonicalBasePath, routing.resolvedTenantSlug, routing.rootMode]);

  const heroKeywords = useMemo(
    () => [
      t('platform_hero_keyword_1'),
      t('platform_hero_keyword_2'),
      t('platform_hero_keyword_3'),
      t('platform_hero_keyword_4'),
      t('platform_hero_keyword_5'),
      t('platform_hero_keyword_6'),
    ],
    [t]
  );

  const featureCards = [
    {
      title: t('platform_feature_privacy_title'),
      text: t('platform_feature_privacy_text'),
    },
    {
      title: t('platform_feature_multilingual_title'),
      text: t('platform_feature_multilingual_text'),
    },
    {
      title: t('platform_feature_modularity_title'),
      text: t('platform_feature_modularity_text'),
    },
    {
      title: t('platform_feature_interfaces_title'),
      text: t('platform_feature_interfaces_text'),
    },
  ];

  const privacyFilterPoints = [
    t('platform_privacy_filter_point_1'),
    t('platform_privacy_filter_point_2'),
    t('platform_privacy_filter_point_3'),
    t('platform_privacy_filter_point_4'),
  ];

  const multilingualPoints = [
    t('platform_multilingual_point_1'),
    t('platform_multilingual_point_2'),
    t('platform_multilingual_point_3'),
  ];

  const modularityPoints = [
    t('platform_modularity_point_1'),
    t('platform_modularity_point_2'),
    t('platform_modularity_point_3'),
    t('platform_modularity_point_4'),
  ];

  const architecturePoints = [
    t('platform_architecture_point_1'),
    t('platform_architecture_point_2'),
    t('platform_architecture_point_3'),
  ];

  const heroStats = useMemo(
    () => [
      {
        label: t('platform_stat_1_label'),
        value: statsLoading
          ? t('platform_stat_loading')
          : formatNumber(platformStats?.totals?.tickets, locale),
      },
      {
        label: t('platform_stat_2_label'),
        value: statsLoading
          ? t('platform_stat_loading')
          : formatNumber(platformStats?.totals?.openTickets, locale),
      },
      {
        label: t('platform_stat_3_label'),
        value: statsLoading
          ? t('platform_stat_loading')
          : formatNumber(platformStats?.totals?.adminUsers, locale),
      },
      {
        label: t('platform_stat_4_label'),
        value: statsLoading
          ? t('platform_stat_loading')
          : formatNumber(platformStats?.totals?.tenants, locale),
      },
    ],
    [
      locale,
      platformStats?.totals?.adminUsers,
      platformStats?.totals?.openTickets,
      platformStats?.totals?.tenants,
      platformStats?.totals?.tickets,
      statsLoading,
      t,
    ]
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
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
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
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let rafId = 0;

    const updateParallax = () => {
      const node = landingRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const viewportHeight = Math.max(window.innerHeight || 0, 1);
      const distanceFromCenter = rect.top + rect.height / 2 - viewportHeight / 2;
      const normalized = Math.max(-1, Math.min(1, distanceFromCenter / (viewportHeight * 0.85)));
      const nextOffset = Number((-normalized * 38).toFixed(2));
      setParallaxOffset((current) => (Math.abs(current - nextOffset) < 0.2 ? current : nextOffset));
    };

    const scheduleUpdate = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        updateParallax();
      });
    };

    scheduleUpdate();
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, []);

  const landingStyle = useMemo(
    () =>
      ({
        '--platform-parallax-y': `${parallaxOffset}px`,
      }) as React.CSSProperties,
    [parallaxOffset]
  );

  const visibleBlogItems = useMemo(() => {
    if (showAllBlogItems) return blogItems;
    return blogItems.slice(0, BLOG_VISIBLE_DEFAULT);
  }, [blogItems, showAllBlogItems]);

  const hiddenBlogItemsCount = Math.max(0, blogItems.length - BLOG_VISIBLE_DEFAULT);

  useEffect(() => {
    if (blogItems.length <= BLOG_VISIBLE_DEFAULT && showAllBlogItems) {
      setShowAllBlogItems(false);
    }
  }, [blogItems.length, showAllBlogItems]);

  return (
    <section ref={landingRef} className="platform-landing" style={landingStyle} aria-label={t('platform_aria_overview')}>
      <div className="platform-landing-mesh" aria-hidden="true" />
      <div className="platform-parallax-grid" aria-hidden="true" />
      <div className="platform-parallax-layers" aria-hidden="true">
        <span className="platform-parallax-orb platform-parallax-orb--one" />
        <span className="platform-parallax-orb platform-parallax-orb--two" />
        <span className="platform-parallax-orb platform-parallax-orb--three" />
      </div>

      <header className="platform-hero">
        <div className="platform-hero-main">
          <div className="platform-hero-tools">
            <p className="platform-kicker">{renderPlatformText(t('platform_kicker'))}</p>
            <div className="platform-language-wrap" aria-label={t('platform_language_selector_aria')}>
              <LanguageSelector />
            </div>
          </div>

          <h2>{renderPlatformText(t('platform_hero_title'))}</h2>
          <p className="platform-hero-copy">{renderPlatformText(t('platform_hero_copy'))}</p>

          <ul className="platform-hero-keywords" aria-label={t('platform_hero_keywords_aria')}>
            {heroKeywords.map((keyword) => (
              <li key={keyword}>{renderPlatformText(keyword)}</li>
            ))}
          </ul>

          <div className="platform-hero-cta">
            <Link to={citizenPortalPath} className="platform-btn">
              {renderPlatformText(t('platform_cta_citizen'))}
            </Link>
            <a href="/ops" className="platform-btn platform-btn--ops">
              {renderPlatformText(t('platform_cta_ops'))}
            </a>
            <a
              href="https://github.com/derdigitalaffine/behebes-ai"
              target="_blank"
              rel="noreferrer"
              className="platform-btn platform-btn--ghost"
            >
              {renderPlatformText(t('platform_cta_github'))}
            </a>
          </div>

          <span className="platform-cta-note">{renderPlatformText(t('platform_cta_note'))}</span>

          <div className="platform-stats" role="list" aria-label={t('platform_stats_aria')}>
            {heroStats.map((item) => (
              <div key={item.label} className="platform-stat" role="listitem">
                <p>{renderPlatformText(item.label)}</p>
                <strong>{renderPlatformText(item.value)}</strong>
              </div>
            ))}
          </div>
          <p className="platform-meta-line">
            {renderPlatformText(t('platform_stats_updated_label'))}:{' '}
            {formatBlogDate(
              platformStats?.lastTicketUpdateAt || platformStats?.generatedAt || null,
              locale,
              t('platform_blog_date_fallback')
            )}
          </p>
        </div>

        <aside className="platform-hero-aside" aria-label={t('platform_brand_stack_aria')}>
          <article className="platform-brand-card">
            <p>{renderPlatformText(t('platform_brand_product_label'))}</p>
            <img src="/logo.png" alt={t('platform_brand_product_alt')} />
            <span>{renderPlatformText(t('platform_brand_product_caption'))}</span>
          </article>

          <article className="platform-brand-card platform-brand-card--partner">
            <p>{renderPlatformText(t('platform_brand_partner_label'))}</p>
            <img src="/verbandsgemeinde-otterbach-otterberg-logo.jpg" alt={t('platform_brand_partner_alt')} />
            <span>{renderPlatformText(t('platform_brand_partner_caption'))}</span>
          </article>
        </aside>
      </header>

      <div className="platform-main-layout">
        <aside className="platform-blog-column" aria-label={t('platform_blog_aria')}>
          <div className="platform-blog-sticky">
            <div className="platform-section-head platform-section-head--compact">
              <p>{renderPlatformText(t('platform_blog_kicker'))}</p>
              <h3>{renderPlatformText(t('platform_blog_title'))}</h3>
            </div>

            {blogError ? (
              <p className="platform-blog-empty">{renderPlatformText(t('platform_blog_error'))}</p>
            ) : blogLoading ? (
              <p className="platform-blog-empty">{renderPlatformText(t('platform_blog_loading'))}</p>
            ) : blogItems.length === 0 ? (
              <p className="platform-blog-empty">{renderPlatformText(t('platform_blog_empty'))}</p>
            ) : (
              <div className="platform-blog-stack">
                {visibleBlogItems.map((post) => {
                  const teaser = post.excerpt || summarizeMarkdown(post.contentMd) || t('platform_blog_teaser_fallback');
                  const statusLabel = resolveBlogStatusLabel(post.status, t);
                  const statusClass = `status-${post.status}`;
                  const hasPublishedAt = !!post.publishedAt;
                  const datePrefix = hasPublishedAt
                    ? t('platform_blog_published_label')
                    : t('platform_blog_created_label');
                  return (
                    <article key={post.id} className="platform-blog-card-compact">
                      <div className="platform-blog-card-meta">
                        <time dateTime={post.publishedAt || post.createdAt || undefined}>
                          {renderPlatformText(datePrefix)} ·{' '}
                          {formatBlogDate(post.publishedAt || post.createdAt, locale, t('platform_blog_date_fallback'))}
                        </time>
                        <span className={`platform-blog-status ${statusClass}`}>{renderPlatformText(statusLabel)}</span>
                      </div>
                      <h4>{renderPlatformText(post.title)}</h4>
                      <p>{renderPlatformText(teaser)}</p>
                    </article>
                  );
                })}
                {hiddenBlogItemsCount > 0 ? (
                  <button
                    type="button"
                    className="platform-blog-toggle"
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
              </div>
            )}
          </div>
        </aside>

        <main className="platform-detail-column">
          <section className="platform-detail-panel">
            <div className="platform-section-head platform-section-head--compact">
              <p>{renderPlatformText(t('platform_features_kicker'))}</p>
              <h3>{renderPlatformText(t('platform_features_title'))}</h3>
            </div>
            <div className="platform-focus-grid">
              {featureCards.map((card, index) => (
                <article key={card.title} className="platform-focus-card">
                  <span>{`0${index + 1}`}</span>
                  <h4>{renderPlatformText(card.title)}</h4>
                  <p>{renderPlatformText(card.text)}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="platform-detail-panel platform-detail-panel--split">
            <article className="platform-panel">
              <div className="platform-section-head platform-section-head--compact">
                <p>{renderPlatformText(t('platform_privacy_kicker'))}</p>
                <h3>{renderPlatformText(t('platform_privacy_title'))}</h3>
              </div>
              <p>{renderPlatformText(t('platform_privacy_intro'))}</p>
              <ul className="platform-list">
                {privacyFilterPoints.map((point) => (
                  <li key={point}>{renderPlatformText(point)}</li>
                ))}
              </ul>
              <p>{renderPlatformText(t('platform_privacy_why_intro'))}</p>
              <p>{renderPlatformText(t('platform_privacy_why_detail'))}</p>
            </article>

            <article className="platform-panel">
              <div className="platform-section-head platform-section-head--compact">
                <p>{renderPlatformText(t('platform_architecture_kicker'))}</p>
                <h3>{renderPlatformText(t('platform_architecture_title'))}</h3>
              </div>
              <p className="platform-quote">{renderPlatformText(t('platform_architecture_quote'))}</p>
              <ul className="platform-list">
                {architecturePoints.map((point) => (
                  <li key={point}>{renderPlatformText(point)}</li>
                ))}
              </ul>
            </article>
          </section>

          <section className="platform-detail-panel platform-detail-panel--split">
            <article className="platform-panel">
              <div className="platform-section-head platform-section-head--compact">
                <p>{renderPlatformText(t('platform_multilingual_kicker'))}</p>
                <h3>{renderPlatformText(t('platform_multilingual_title'))}</h3>
              </div>
              <p>{renderPlatformText(t('platform_multilingual_intro'))}</p>
              <ul className="platform-list">
                {multilingualPoints.map((point) => (
                  <li key={point}>{renderPlatformText(point)}</li>
                ))}
              </ul>
            </article>

            <article className="platform-panel">
              <div className="platform-section-head platform-section-head--compact">
                <p>{renderPlatformText(t('platform_detail_modularity_kicker'))}</p>
                <h3>{renderPlatformText(t('platform_detail_modularity_title'))}</h3>
              </div>
              <p>{renderPlatformText(t('platform_modularity_intro'))}</p>
              <ul className="platform-list">
                {modularityPoints.map((point) => (
                  <li key={point}>{renderPlatformText(point)}</li>
                ))}
              </ul>
            </article>
          </section>

          <section className="platform-detail-panel">
            <div className="platform-section-head platform-section-head--compact">
              <p>{renderPlatformText(t('platform_history_kicker'))}</p>
              <h3>{renderPlatformText(t('platform_history_title'))}</h3>
            </div>
            <div className="platform-history-grid">
              <article className="platform-panel">
                <h4>{renderPlatformText(t('platform_history_phase_1_title'))}</h4>
                <p>{renderPlatformText(t('platform_history_phase_1_text'))}</p>
              </article>
              <article className="platform-panel">
                <h4>{renderPlatformText(t('platform_history_phase_2_title'))}</h4>
                <p>{renderPlatformText(t('platform_history_phase_2_text'))}</p>
              </article>
              <article className="platform-panel">
                <h4>{renderPlatformText(t('platform_history_phase_3_title'))}</h4>
                <p>{renderPlatformText(t('platform_history_phase_3_text'))}</p>
              </article>
            </div>
          </section>

          <section className="platform-detail-panel" aria-label={t('platform_context_aria')}>
            <div className="platform-section-head platform-section-head--compact">
              <p>{renderPlatformText(t('platform_context_kicker'))}</p>
              <h3>{renderPlatformText(t('platform_context_title'))}</h3>
            </div>
            <p className="platform-context-text">{renderPlatformText(t('platform_context_text'))}</p>
          </section>
        </main>
      </div>
    </section>
  );
};

export default PlatformLanding;
