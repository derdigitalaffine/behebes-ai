import React from 'react';
import './AdminSurface.css';

type AdminSurfaceTone = 'default' | 'success' | 'warning' | 'danger' | 'info';

interface AdminPageHeroProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  badges?: Array<{
    id?: string;
    label: string;
    tone?: AdminSurfaceTone;
  }>;
  className?: string;
}

interface AdminSurfaceCardProps {
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}

interface AdminKpiStripItem {
  id?: string;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: AdminSurfaceTone;
}

interface AdminKpiStripProps {
  items: AdminKpiStripItem[];
  className?: string;
}

function toneClass(tone: AdminSurfaceTone = 'default'): string {
  if (tone === 'success') return 'is-success';
  if (tone === 'warning') return 'is-warning';
  if (tone === 'danger') return 'is-danger';
  if (tone === 'info') return 'is-info';
  return 'is-default';
}

const AdminPageHero: React.FC<AdminPageHeroProps> = ({
  title,
  subtitle,
  icon,
  actions,
  badges = [],
  className = '',
}) => (
  <header className={`admin-surface-hero ${className}`.trim()}>
    <div className="admin-surface-hero-main">
      <div className="admin-surface-hero-title-wrap">
        {icon ? <span className="admin-surface-hero-icon">{icon}</span> : null}
        <div>
          <h1 className="admin-surface-hero-title">{title}</h1>
          {subtitle ? <p className="admin-surface-hero-subtitle">{subtitle}</p> : null}
        </div>
      </div>
      {badges.length > 0 ? (
        <div className="admin-surface-hero-badges">
          {badges.map((badge, index) => (
            <span key={badge.id || `${badge.label}-${index}`} className={`admin-surface-badge ${toneClass(badge.tone)}`}>
              {badge.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
    {actions ? <div className="admin-surface-hero-actions">{actions}</div> : null}
  </header>
);

const AdminSurfaceCard: React.FC<AdminSurfaceCardProps> = ({
  title,
  subtitle,
  actions,
  children,
  className = '',
  bodyClassName = '',
}) => (
  <section className={`admin-surface-card ${className}`.trim()}>
    {(title || subtitle || actions) ? (
      <div className="admin-surface-card-head">
        <div className="admin-surface-card-head-copy">
          {title ? <h2 className="admin-surface-card-title">{title}</h2> : null}
          {subtitle ? <p className="admin-surface-card-subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="admin-surface-card-head-actions">{actions}</div> : null}
      </div>
    ) : null}
    <div className={`admin-surface-card-body ${bodyClassName}`.trim()}>{children}</div>
  </section>
);

const AdminKpiStrip: React.FC<AdminKpiStripProps> = ({ items, className = '' }) => (
  <section className={`admin-surface-kpi-strip ${className}`.trim()}>
    {items.map((item, index) => (
      <article key={item.id || `${item.label}-${index}`} className={`admin-surface-kpi ${toneClass(item.tone)}`}>
        <span className="admin-surface-kpi-label">{item.label}</span>
        <strong className="admin-surface-kpi-value">{item.value}</strong>
        {item.hint ? <small className="admin-surface-kpi-hint">{item.hint}</small> : null}
      </article>
    ))}
  </section>
);

export { AdminKpiStrip, AdminPageHero, AdminSurfaceCard };
export type { AdminKpiStripItem, AdminSurfaceTone };
