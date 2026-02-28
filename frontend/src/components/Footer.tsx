import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import './Footer.css';
import { APP_BUILD_ID, APP_BUILD_TIME } from '../buildInfo';
import { reloadAppWithServiceWorkerRefresh } from '../service-worker';
import { useI18n } from '../i18n/I18nProvider';

interface FooterProps {
  compact?: boolean;
}

const Footer: React.FC<FooterProps> = ({ compact = false }) => {
  const { t } = useI18n();
  const healthStatus: 'ok' = 'ok';
  const [reloadPending, setReloadPending] = useState(false);
  const buildStamp = APP_BUILD_ID;
  const buildTime = new Date(APP_BUILD_TIME).toLocaleString('de-DE');
  const buildLabel = `Build: ${buildStamp}`;
  const buildWithTimeLabel = `Build: ${buildStamp} · erstellt: ${buildTime}`;
  const healthLabel = t('footer_status_online');

  const handleAppReload = async () => {
    if (reloadPending) return;
    setReloadPending(true);
    await reloadAppWithServiceWorkerRefresh();
  };

  if (compact) {
    return (
      <footer className="footer footer-compact">
        <div className="footer-compact-content">
          <div className="footer-compact-brand-block">
            <strong className="footer-compact-brand">behebes.AI</strong>
            <span className="footer-build-tag" title={buildWithTimeLabel}>
              {buildLabel}
            </span>
            <div
              className={`health-status health-${healthStatus}`}
              title="Systemstatus"
            >
              <span className="health-dot" />
              <span>{healthLabel}</span>
            </div>
          </div>
          <nav className="footer-compact-links" aria-label="Links">
            <a
              href="https://www.otterbach-otterberg.de/service/impressum"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('footer_impressum')}
            </a>
            <Link to="/privacy">{t('footer_privacy')}</Link>
            <Link to="/guide">{t('footer_guide')}</Link>
            <button type="button" className="footer-link-button" onClick={handleAppReload} disabled={reloadPending}>
              {reloadPending ? t('footer_reloading') : t('footer_reload_app')}
            </button>
          </nav>
        </div>
      </footer>
    );
  }

  return (
    <footer className="footer">
      <div className="footer-content">
        <div className="footer-section">
          <h4>behebes.AI</h4>
          <p className="footer-description">
            Intelligentes Bürgermeldungs-System für die Verbandsgemeinde Otterbach-Otterberg
          </p>
        </div>
        
        <div className="footer-section">
          <h4>Links</h4>
          <ul className="footer-links">
            <li>
              <a 
                href="https://www.otterbach-otterberg.de/service/impressum" 
                target="_blank" 
                rel="noopener noreferrer"
              >
                {t('footer_impressum')}
              </a>
            </li>
            <li>
              <Link to="/privacy">{t('footer_privacy')}</Link>
            </li>
            <li>
              <Link to="/guide">{t('footer_guide')}</Link>
            </li>
          </ul>
        </div>

        <div className="footer-section">
          <h4>Über</h4>
          <p className="footer-credit">
            © {new Date().getFullYear()} D. Tröster, Verbandgemeinde Otterbach-Otterberg<br/>
            Verbandsgemeinde Otterbach-Otterberg
          </p>
        </div>

        <div className="footer-section">
          <h4>Systemstatus</h4>
          <div className={`health-status health-${healthStatus}`}>
            <span className="health-dot" />
            <span>{healthLabel}</span>
          </div>
          <p className="health-meta" title={buildWithTimeLabel}>
            {buildLabel}
          </p>
          <button type="button" className="footer-link-button footer-link-button--inline" onClick={handleAppReload} disabled={reloadPending}>
            {reloadPending ? t('footer_reloading') : t('footer_reload_app')}
          </button>
        </div>
      </div>

      <div className="footer-bottom">
        <p>Powered by behebes.AI</p>
      </div>
    </footer>
  );
};

export default Footer;
