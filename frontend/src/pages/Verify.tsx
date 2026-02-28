import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import axios from 'axios';
import { useI18n } from '../i18n/I18nProvider';

const normalizePath = (input: unknown): string => {
  const raw = String(input || '').trim();
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeadingSlash.replace(/\/+$/g, '') || '/';
};

const resolveTenantBasePath = (pathname: string): string => {
  const normalizedPathname = normalizePath(pathname);
  const prefix = '/c/';
  if (!normalizedPathname.startsWith(prefix)) return '/';
  const rest = normalizedPathname.slice(prefix.length);
  const slug = rest.split('/')[0] || '';
  return slug ? `/c/${slug}` : '/';
};

const withTenantBasePath = (pathname: string): string => {
  const base = resolveTenantBasePath(window.location.pathname);
  const target = normalizePath(pathname);
  if (base === '/') return target;
  if (target === '/') return base;
  return `${base}${target}`.replace(/\/{2,}/g, '/');
};

const Verify: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const callbackType = searchParams.get('cb');
  const workflowMode = searchParams.get('mode');
  const statusTokenParam = searchParams.get('statusToken');
  const decisionParam = searchParams.get('decision');
  const adminBaseParam = searchParams.get('adminBase');
  const decision = decisionParam === 'approve' || decisionParam === 'reject' ? decisionParam : null;
  const { t, frontendToken } = useI18n();

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [ticketId, setTicketId] = useState('');
  const lastRequestKeyRef = useRef<string>('');
  const isUnsubscribeCallback = callbackType === 'ticket_unsubscribe';

  useEffect(() => {
    const needsFrontendToken = callbackType === 'citizen_login';
    const requestKey = [
      token || '',
      callbackType || '',
      workflowMode || '',
      decision || '',
      adminBaseParam || '',
      needsFrontendToken ? frontendToken || '' : '',
    ].join('|');
    if (lastRequestKeyRef.current === requestKey) {
      return;
    }
    lastRequestKeyRef.current = requestKey;

    let cancelled = false;

    const run = async () => {
      if (!token) {
        if (cancelled) return;
        setStatus('error');
        setMessage(t('verify_token_missing'));
        return;
      }

      if (!cancelled) {
        setStatus('loading');
        setMessage('');
      }

      try {
        if (callbackType === 'admin_password_reset') {
          const configuredAdminBase = String((import.meta as any).env?.VITE_ADMIN_URL || '').trim();
          const queryAdminBase = String(adminBaseParam || '').trim();
          const localhostFallbackBase =
            window.location.hostname === 'localhost' && window.location.port === '5173'
              ? `${window.location.protocol}//${window.location.hostname}:5174`
              : `${window.location.origin}/admin`;
          const preferredAdminBase = queryAdminBase || configuredAdminBase || localhostFallbackBase;
          let normalizedAdminBase = localhostFallbackBase.replace(/\/+$/, '');
          try {
            normalizedAdminBase = new URL(preferredAdminBase).toString().replace(/\/+$/, '');
          } catch {
            // keep localhost/environment fallback
          }
          window.location.replace(`${normalizedAdminBase}/?resetToken=${encodeURIComponent(token)}`);
          return;
        }

        if (callbackType === 'workflow_confirmation') {
          if (workflowMode === 'doi' && decision) {
            if (!cancelled) {
              setStatus('success');
              setMessage(
                decision === 'approve'
                  ? t('verify_email_confirmed')
                  : t('verify_confirmation_rejected')
              );
            }
            const response = await axios.post(
              `/api/workflows/confirm/${token}/decision`,
              {
                decision,
                defer: 1,
              },
              {
                params: { defer: 1 },
              }
            );
            if (cancelled) return;
            setTicketId(response.data?.ticketId || '');
            setMessage(
              response.data?.message ||
                (decision === 'approve'
                  ? t('verify_email_confirmed')
                  : t('verify_confirmation_rejected'))
            );
            return;
          }

          const decisionPart = decision ? `&decision=${encodeURIComponent(decision)}` : '';
          window.location.replace(
            `${withTenantBasePath('/workflow/confirm')}?token=${encodeURIComponent(token)}${decisionPart}`
          );
          return;
        }

        if (callbackType === 'workflow_data_request') {
          window.location.replace(
            `${withTenantBasePath('/workflow/data-request')}?token=${encodeURIComponent(token)}`
          );
          return;
        }

        if (callbackType === 'ticket_status') {
          window.location.replace(`${withTenantBasePath('/status')}?token=${encodeURIComponent(token)}`);
          return;
        }

        if (callbackType === 'citizen_login') {
          const params = new URLSearchParams();
          params.set('token', token);
          if (frontendToken) {
            params.set('frontendToken', frontendToken);
          }
          window.location.replace(`/api/citizen/auth/verify?${params.toString()}`);
          return;
        }

        if (callbackType === 'ticket_unsubscribe') {
          const response = await axios.get('/api/submissions/unsubscribe', {
            params: { token },
          });
          if (cancelled) return;
          setTicketId(response.data?.ticketId || '');
          setStatus('success');
          setMessage(response.data?.message || t('verify_unsubscribe_disabled_default'));
          return;
        }

        const response = await axios.get(`/api/validations/verify/${token}`, {
          params: {
            autoLogin: 0,
          },
        });
        if (cancelled) return;
        setTicketId(response.data.ticketId || '');
        setStatus('success');
        setMessage(response.data.message || t('verify_success_default'));
      } catch (error: any) {
        if (cancelled) return;
        setStatus('error');
        setMessage(error.response?.data?.message || t('verify_failed_default'));
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [token, callbackType, workflowMode, decision, adminBaseParam, frontendToken, t]);

  const statusLinkToken =
    callbackType === 'workflow_confirmation' && workflowMode === 'doi'
      ? statusTokenParam || token
      : token;

  return (
    <main className="page-shell">
      <header className="page-head">
        <p className="page-kicker">{t('verify_kicker')}</p>
        <h1 className="page-title">{t('verify_title')}</h1>
        <p className="page-subtitle">
          {t('verify_subtitle')}
        </p>
      </header>
      <section className="form-card">
        {status === 'loading' && (
          <div className="p-5 rounded-xl bg-slate-900 text-slate-100">
            <p>{t('verify_loading')}</p>
          </div>
        )}

        {status === 'success' && (
          <div className="space-y-4">
            <div className="success-card p-6">
              <h2 className="text-xl font-semibold text-slate-900">
                {isUnsubscribeCallback ? t('verify_unsubscribe_disabled_title') : t('verify_confirmed')}
              </h2>
              <p className="text-slate-700 mt-2">{message}</p>
              {!isUnsubscribeCallback && (
                <p className="text-slate-700 mt-2">{t('verify_processing_notice')}</p>
              )}
              {ticketId && (
                <p className="text-slate-900 font-semibold text-lg mt-3">
                  {t('success_ticket_label')}: {ticketId}
                </p>
              )}
            </div>

            {statusLinkToken && !isUnsubscribeCallback && (
              <div className="flex flex-col sm:flex-row gap-3">
                <Link to={`${withTenantBasePath('/status')}?token=${encodeURIComponent(statusLinkToken)}`} className="btn btn-primary">
                  {t('verify_view_status')}
                </Link>
                <Link to={withTenantBasePath('/me')} className="btn btn-secondary">
                  Meine Meldungen
                </Link>
              </div>
            )}
          </div>
        )}

        {status === 'error' && (
          <div className="p-6 rounded-xl bg-slate-100 border border-slate-300 border-l-4 border-l-rose-500">
            <h2 className="text-xl font-semibold text-slate-900">{t('verify_error_title')}</h2>
            <p className="text-slate-700 mt-2">{message}</p>
          </div>
        )}

        <div className="mt-6">
          <Link to="/" className="btn btn-primary">
            {t('verify_back')}
          </Link>
        </div>
      </section>
    </main>
  );
};

export default Verify;
