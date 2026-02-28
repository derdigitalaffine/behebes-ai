import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useI18n } from '../i18n/I18nProvider';
import { getCitizenSession, requestCitizenMagicLink } from '../lib/citizenAuth';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CitizenLogin: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { frontendToken, citizenAuthEnabled, t } = useI18n();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const invalidLink = searchParams.get('state') === 'invalid_link';

  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const session = await getCitizenSession(frontendToken);
        if (!alive) return;
        if (session.authenticated) {
          navigate('/me', { replace: true });
        }
      } catch {
        // ignore
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [frontendToken, navigate]);

  const helperText = useMemo(() => {
    if (!citizenAuthEnabled) {
      return t('citizen_login_subtitle_disabled');
    }
    return t('citizen_login_subtitle_enabled');
  }, [citizenAuthEnabled, t]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setMessage('');

    const normalizedEmail = email.trim();
    if (!normalizedEmail || !EMAIL_PATTERN.test(normalizedEmail)) {
      setError(t('citizen_login_error_invalid_email'));
      return;
    }

    setLoading(true);
    try {
      const response = await requestCitizenMagicLink({
        email: normalizedEmail,
        frontendToken,
        purpose: 'login',
        redirectPath: '/me',
      });
      setMessage(
        response.message ||
          t('citizen_login_success_default')
      );
    } catch (requestError: any) {
      setError(requestError?.message || t('citizen_login_error_request_failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="page-shell">
      <header className="page-head">
        <p className="page-kicker">{t('citizen_login_kicker')}</p>
        <h1 className="page-title">{t('citizen_login_title')}</h1>
        <p className="page-subtitle">{helperText}</p>
      </header>

      <section className="form-card space-y-4">
        {invalidLink && (
          <div className="p-4 rounded-lg border border-rose-300 bg-rose-50 text-rose-900">
            {t('citizen_login_invalid_link')}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block">
            <span className="block text-sm font-medium mb-1">{t('citizen_login_email_label')}</span>
            <input
              type="email"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t('citizen_login_email_placeholder')}
              autoComplete="email"
              required
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={loading || !citizenAuthEnabled}>
            {loading ? t('citizen_login_submit_loading') : t('citizen_login_submit')}
          </button>
        </form>

        {message && (
          <div className="p-4 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-900">{message}</div>
        )}

        {error && (
          <div className="p-4 rounded-lg border border-rose-300 bg-rose-50 text-rose-900">{error}</div>
        )}

        <div>
          <Link to="/" className="btn btn-secondary">
            {t('citizen_login_back')}
          </Link>
        </div>
      </section>
    </main>
  );
};

export default CitizenLogin;
