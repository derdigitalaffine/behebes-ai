import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import LanguageSelector from '../components/LanguageSelector';
import { useI18n } from '../i18n/I18nProvider';
import './PlatformLanding.css';

const PLATFORM_BRAND_REGEX = /(behebes)/gi;

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

const summarizeMarkdown = (value: string, maxLength = 220): string => {
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

const renderBrandedText = (value: unknown): React.ReactNode => {
  const text = String(value || '');
  if (!text) return '';
  const parts = text.split(PLATFORM_BRAND_REGEX);
  return parts.map((part, index) => {
    if (part.toLowerCase() !== 'behebes') {
      return <React.Fragment key={`text-${index}`}>{part}</React.Fragment>;
    }
    return (
      <span key={`brand-${index}`} className="platform-brand-word" role="text" aria-label="behebes">
        <span className="platform-brand-word-base" aria-hidden="true">beheb</span>
        <span className="platform-brand-word-highlight" aria-hidden="true">es</span>
      </span>
    );
  });
};

const formatNumber = (value: unknown, locale: string): string => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return '0';
  return new Intl.NumberFormat(locale || 'de-DE').format(Math.floor(numeric));
};

const PlatformLanding: React.FC = () => {
  const { routing, canonicalBasePath, locale, t } = useI18n();
  const landingRef = useRef<HTMLElement | null>(null);
  const [blogItems, setBlogItems] = useState<PlatformBlogPost[]>([]);
  const [blogLoading, setBlogLoading] = useState(true);
  const [blogError, setBlogError] = useState(false);
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
      const nextOffset = Number((-normalized * 42).toFixed(2));
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

  return (
    <section ref={landingRef} className="platform-landing" style={landingStyle} aria-label={t('platform_aria_overview')}>
      <div className="platform-landing-mesh" aria-hidden="true" />
      <div className="platform-parallax-grid" aria-hidden="true" />
      <div className="platform-parallax-layers" aria-hidden="true">
        <span className="platform-parallax-orb platform-parallax-orb--one" />
        <span className="platform-parallax-orb platform-parallax-orb--two" />
        <span className="platform-parallax-orb platform-parallax-orb--three" />
      </div>

      <div className="platform-hero">
        <div className="platform-hero-content">
          <div className="platform-hero-tools">
            <p className="platform-kicker">{renderBrandedText(t('platform_kicker'))}</p>
            <div className="platform-language-wrap" aria-label={t('platform_language_selector_aria')}>
              <LanguageSelector />
            </div>
          </div>
          <h2>{renderBrandedText(t('platform_hero_title'))}</h2>
          <p className="platform-hero-copy">{renderBrandedText(t('platform_hero_copy'))}</p>

          <div className="platform-hero-cta">
            <Link to={citizenPortalPath} className="platform-btn">
              {renderBrandedText(t('platform_cta_citizen'))}
            </Link>
            <a href="/ops" className="platform-btn platform-btn--ops">
              {renderBrandedText(t('platform_cta_ops'))}
            </a>
            <a
              href="https://github.com/TODO/behebes-ai"
              target="_blank"
              rel="noreferrer"
              className="platform-btn platform-btn--ghost"
            >
              {renderBrandedText(t('platform_cta_github'))}
            </a>
            <span className="platform-cta-note">{renderBrandedText(t('platform_cta_note'))}</span>
          </div>

          <div className="platform-stats" role="list" aria-label={t('platform_stats_aria')}>
            {heroStats.map((item) => (
              <div key={item.label} className="platform-stat" role="listitem">
                <p>{renderBrandedText(item.label)}</p>
                <strong>{renderBrandedText(item.value)}</strong>
              </div>
            ))}
          </div>
          <p className="platform-meta-line">
            {renderBrandedText(t('platform_stats_updated_label'))}:{' '}
            {formatBlogDate(platformStats?.lastTicketUpdateAt || platformStats?.generatedAt || null, locale, t('platform_blog_date_fallback'))}
          </p>
        </div>

        <aside className="platform-brand-stack" aria-label={t('platform_brand_stack_aria')}>
          <article className="platform-brand-card">
            <p>{renderBrandedText(t('platform_brand_product_label'))}</p>
            <img src="/logo.png" alt={t('platform_brand_product_alt')} />
            <span>{renderBrandedText(t('platform_brand_product_caption'))}</span>
          </article>

          <article className="platform-brand-card platform-brand-card--partner">
            <p>{renderBrandedText(t('platform_brand_partner_label'))}</p>
            <img src="/verbandsgemeinde-otterbach-otterberg-logo.jpg" alt={t('platform_brand_partner_alt')} />
            <span>{renderBrandedText(t('platform_brand_partner_caption'))}</span>
          </article>
        </aside>
      </div>

      <section className="platform-section platform-section--history">
        <div className="platform-section-head">
          <p>{renderBrandedText(t('platform_history_kicker'))}</p>
          <h3>{renderBrandedText(t('platform_history_title'))}</h3>
        </div>
        <div className="platform-history-grid">
          <article className="platform-panel">
            <h4>{renderBrandedText(t('platform_history_phase_1_title'))}</h4>
            <p>{renderBrandedText(t('platform_history_phase_1_text'))}</p>
          </article>
          <article className="platform-panel">
            <h4>{renderBrandedText(t('platform_history_phase_2_title'))}</h4>
            <p>{renderBrandedText(t('platform_history_phase_2_text'))}</p>
          </article>
          <article className="platform-panel">
            <h4>{renderBrandedText(t('platform_history_phase_3_title'))}</h4>
            <p>{renderBrandedText(t('platform_history_phase_3_text'))}</p>
          </article>
        </div>
      </section>

      <section className="platform-section">
        <div className="platform-section-head">
          <p>{renderBrandedText(t('platform_features_kicker'))}</p>
          <h3>{renderBrandedText(t('platform_features_title'))}</h3>
        </div>
        <div className="platform-focus-grid">
          {featureCards.map((card, index) => (
            <article key={card.title} className="platform-focus-card">
              <span>{`0${index + 1}`}</span>
              <h4>{renderBrandedText(card.title)}</h4>
              <p>{renderBrandedText(card.text)}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="platform-section">
        <div className="platform-section-head">
          <p>{renderBrandedText(t('platform_privacy_kicker'))}</p>
          <h3>{renderBrandedText(t('platform_privacy_title'))}</h3>
        </div>
        <div className="platform-two-col">
          <article className="platform-panel">
            <p>{renderBrandedText(t('platform_privacy_intro'))}</p>
            <ul className="platform-list">
              {privacyFilterPoints.map((point) => (
                <li key={point}>{renderBrandedText(point)}</li>
              ))}
            </ul>
          </article>
          <article className="platform-panel">
            <p>{renderBrandedText(t('platform_privacy_why_intro'))}</p>
            <p>{renderBrandedText(t('platform_privacy_why_detail'))}</p>
          </article>
        </div>
      </section>

      <section className="platform-section platform-section--philosophy">
        <div className="platform-section-head">
          <p>{renderBrandedText(t('platform_multilingual_kicker'))}</p>
          <h3>{renderBrandedText(t('platform_multilingual_title'))}</h3>
        </div>
        <div className="platform-two-col">
          <article className="platform-panel">
            <p>{renderBrandedText(t('platform_multilingual_intro'))}</p>
            <ul className="platform-list">
              {multilingualPoints.map((point) => (
                <li key={point}>{renderBrandedText(point)}</li>
              ))}
            </ul>
          </article>
          <article className="platform-panel">
            <p>{renderBrandedText(t('platform_modularity_intro'))}</p>
            <ul className="platform-list">
              {modularityPoints.map((point) => (
                <li key={point}>{renderBrandedText(point)}</li>
              ))}
            </ul>
          </article>
        </div>
      </section>

      <section className="platform-section">
        <div className="platform-section-head">
          <p>{renderBrandedText(t('platform_architecture_kicker'))}</p>
          <h3>{renderBrandedText(t('platform_architecture_title'))}</h3>
        </div>
        <p className="platform-quote">{renderBrandedText(t('platform_architecture_quote'))}</p>
        <ul className="platform-list">
          {architecturePoints.map((point) => (
            <li key={point}>{renderBrandedText(point)}</li>
          ))}
        </ul>
      </section>

      <section className="platform-section platform-section--municipality" aria-label={t('platform_context_aria')}>
        <div className="platform-section-head">
          <p>{renderBrandedText(t('platform_context_kicker'))}</p>
          <h3>{renderBrandedText(t('platform_context_title'))}</h3>
        </div>
        <p>{renderBrandedText(t('platform_context_text'))}</p>
      </section>

      <section className="platform-section platform-section--blog" aria-label={t('platform_blog_aria')}>
        <div className="platform-section-head">
          <p>{renderBrandedText(t('platform_blog_kicker'))}</p>
          <h3>{renderBrandedText(t('platform_blog_title'))}</h3>
        </div>
        {blogError ? (
          <p className="platform-blog-empty">{renderBrandedText(t('platform_blog_error'))}</p>
        ) : blogLoading ? (
          <p className="platform-blog-empty">{renderBrandedText(t('platform_blog_loading'))}</p>
        ) : blogItems.length === 0 ? (
          <p className="platform-blog-empty">{renderBrandedText(t('platform_blog_empty'))}</p>
        ) : (
          <div className="platform-blog-grid">
            {blogItems.map((post) => (
              <article key={post.id} className="platform-blog-card">
                <p className="platform-blog-date">
                  {post.publishedAt ? renderBrandedText(t('platform_blog_published_label')) : renderBrandedText(t('platform_blog_created_label'))}:{' '}
                  {formatBlogDate(post.publishedAt || post.createdAt, locale, t('platform_blog_date_fallback'))}
                </p>
                <h4>{renderBrandedText(post.title)}</h4>
                {post.excerpt && <p className="platform-blog-excerpt">{renderBrandedText(post.excerpt)}</p>}
                <p className="platform-blog-text">{renderBrandedText(summarizeMarkdown(post.contentMd))}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
};

export default PlatformLanding;
