import React from 'react';
import { ADMIN_APP_BUILD_ID, ADMIN_APP_BUILD_TIME, ADMIN_APP_VERSION } from '../buildInfo';

interface AdminFooterProps {
  compact?: boolean;
  healthStatus?: 'loading' | 'ok' | 'error';
  healthTimestamp?: string;
}

const AdminFooter: React.FC<AdminFooterProps> = ({ compact = false, healthStatus, healthTimestamp }) => {
  const hasHealth = !compact && typeof healthStatus === 'string';
  const healthLabel =
    healthStatus === 'ok' ? 'Backend online' : healthStatus === 'loading' ? 'Backend wird geprüft' : 'Backend gestört';
  const buildTime = Number.isNaN(Date.parse(ADMIN_APP_BUILD_TIME))
    ? ADMIN_APP_BUILD_TIME
    : new Date(ADMIN_APP_BUILD_TIME).toLocaleString('de-DE');

  return (
    <footer className={`admin-footer ${compact ? 'admin-footer-compact' : ''}`}>
      {hasHealth && (
        <span className={`footer-health footer-health-${healthStatus}`}>
          <i className="fa-solid fa-circle" />
          <strong>{healthLabel}</strong>
          <span>
            {healthTimestamp
              ? new Date(healthTimestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
              : '–'}
          </span>
        </span>
      )}
      <span>Apache License 2.0</span>
      <span>Verbandsgemeinde Otterbach-Otterberg</span>
      <span>© D. Tröster, Verbandgemeinde Otterbach-Otterberg</span>
      {!compact && (
        <span title={`Version ${ADMIN_APP_VERSION} · ${buildTime}`}>Build {ADMIN_APP_BUILD_ID}</span>
      )}
    </footer>
  );
};

export default AdminFooter;
