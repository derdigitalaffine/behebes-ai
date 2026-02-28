import React, { useEffect, useRef } from 'react';
import { useI18n } from '../i18n/I18nProvider';

interface FormFieldProps {
  label: string;
  name: string;
  type?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  required?: boolean;
  placeholder?: string;
  error?: string;
  hint?: string;
  rows?: number;
  disabled?: boolean;
  tooltip?: string;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  name,
  type = 'text',
  value,
  onChange,
  required = false,
  placeholder = '',
  error = '',
  hint = '',
  rows = 1,
  disabled = false,
  tooltip = '',
}) => {
  const { t } = useI18n();
  const isTextarea = type === 'textarea';
  const isFilled = value.trim().length > 0;
  const emailValue = value.trim();
  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue);
  const showEmailValidHint = type === 'email' && isFilled && isEmailValid && !error;

  return (
    <div className="mb-4">
      <label htmlFor={name} className="block text-sm font-semibold text-slate-900 mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
        {tooltip && (
          <span
            className="ml-2 text-slate-400"
            title={tooltip}
            aria-label={tooltip}
          >
            <i className="fa-solid fa-circle-info" aria-hidden="true" />
          </span>
        )}
      </label>
      {isTextarea ? (
        <textarea
          id={name}
          name={name}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          className={`w-full px-3 py-2.5 border rounded-lg bg-white/95 shadow-sm focus:outline-none focus:ring-2 focus:border-transparent resize-vertical transition ${
            error
              ? 'border-rose-300 focus:ring-rose-500'
              : isFilled
              ? 'border-slate-400 focus:ring-slate-800'
              : 'border-slate-300 focus:ring-slate-800'
          } ${disabled ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : ''}`}
        />
      ) : (
        <input
          id={name}
          name={name}
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          className={`w-full px-3 py-2.5 border rounded-lg bg-white/95 shadow-sm focus:outline-none focus:ring-2 focus:border-transparent transition ${
            error
              ? 'border-rose-300 focus:ring-rose-500'
              : isFilled
              ? 'border-slate-400 focus:ring-slate-800'
              : 'border-slate-300 focus:ring-slate-800'
          } ${disabled ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : ''}`}
        />
      )}
      {error && (
        <p className="text-sm text-red-600 mt-1.5 flex items-center gap-2">
          <i className="fa-solid fa-circle-xmark" aria-hidden="true" />
          {error}
        </p>
      )}
      {hint && !error && (
        <p className="text-xs text-slate-500 mt-1.5 flex items-center gap-2">
          <i className="fa-solid fa-lightbulb" aria-hidden="true" />
          {hint}
        </p>
      )}
      {showEmailValidHint && (
        <p className="text-xs text-slate-700 mt-1 flex items-center gap-2">
          <i className="fa-solid fa-check" aria-hidden="true" />
          {t('form_hint_email_ok')}
        </p>
      )}
    </div>
  );
};

interface LoadingSpinnerProps {
  text?: string;
  size?: 'small' | 'medium' | 'large';
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  text,
  size = 'medium',
}) => {
  const { t } = useI18n();
  const sizeClass = {
    small: 'w-4 h-4',
    medium: 'w-8 h-8',
    large: 'w-12 h-12',
  }[size];
  const displayText = text ?? t('loading_default');

  return (
    <div className="flex flex-col items-center justify-center py-8 gap-4">
      <div className={`${sizeClass} border-4 border-slate-200 border-t-slate-900 rounded-full animate-spin`} />
      {displayText && <p className="text-slate-700 font-medium">{displayText}</p>}
    </div>
  );
};

interface ProgressBarProps {
  current: number;
  total: number;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ current, total }) => {
  const { t } = useI18n();
  const percentage = (current / total) * 100;

  return (
    <div className="mb-5">
      <div className="flex justify-between items-center mb-2">
        <p className="text-sm font-medium text-slate-700">
          {t('progress_step', { current, total })}
        </p>
        <p className="text-sm text-slate-500">{Math.round(percentage)}%</p>
      </div>
      <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-slate-700 to-slate-900 transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};

interface AlertProps {
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  onDismiss?: () => void;
  dismissible?: boolean;
}

export const Alert: React.FC<AlertProps> = ({
  type,
  message,
  onDismiss,
  dismissible = true,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!message) return;
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [message]);

  const styles = {
    success: 'bg-blue-50 border-blue-200 text-blue-900',
    error: 'bg-rose-50 border-rose-200 text-rose-900',
    warning: 'bg-slate-100 border-slate-200 text-slate-900',
    info: 'bg-slate-50 border-slate-200 text-slate-900',
  };

  const icons = {
    success: 'fa-solid fa-check',
    error: 'fa-solid fa-xmark',
    warning: 'fa-solid fa-triangle-exclamation',
    info: 'fa-solid fa-circle-info',
  };

  return (
    <div
      ref={containerRef}
      className={`message-banner mb-6 p-4 border rounded-lg flex items-start justify-between ${styles[type]}`}
    >
      <div className="flex items-start gap-3">
        <i className={`text-lg ${icons[type]}`} aria-hidden="true" />
        <p>{message}</p>
      </div>
      {dismissible && onDismiss && (
        <button
          onClick={onDismiss}
          className="text-lg cursor-pointer opacity-60 hover:opacity-100 transition"
        >
          <i className="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      )}
    </div>
  );
};

interface CategoryBadgeProps {
  category: string;
  urgency?: 'critical' | 'high' | 'medium' | 'low';
}

export const CategoryBadge: React.FC<CategoryBadgeProps> = ({ category, urgency }) => {
  const urgencyStyles = {
    critical: 'bg-rose-600',
    high: 'bg-slate-800',
    medium: 'bg-slate-700',
    low: 'bg-slate-500',
  };

  return (
    <div className="flex items-center gap-3">
      <div className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm font-semibold text-white">
        {category}
      </div>
      {urgency && (
        <span className={`px-3 py-1 rounded-full text-white font-semibold text-sm ${urgencyStyles[urgency]}`}>
          {urgency.toUpperCase()}
        </span>
      )}
    </div>
  );
};

interface SummaryItemProps {
  label: string;
  value: string | React.ReactNode;
  iconClass?: string;
}

export const SummaryItem: React.FC<SummaryItemProps> = ({ label, value, iconClass = 'fa-regular fa-file-lines' }) => {
  return (
    <div className="flex items-start gap-3 p-3 bg-slate-100 rounded border border-slate-200">
      <i className={`text-lg flex-shrink-0 ${iconClass}`} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-slate-600 uppercase">{label}</p>
        <p className="text-slate-900 mt-1 break-words">{value}</p>
      </div>
    </div>
  );
};

interface ActionButtonProps {
  variant?: 'primary' | 'secondary' | 'danger' | 'success';
  size?: 'small' | 'medium' | 'large';
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  fullWidth?: boolean;
  type?: 'button' | 'submit';
}

export const ActionButton: React.FC<ActionButtonProps> = ({
  variant = 'primary',
  size = 'medium',
  loading = false,
  disabled = false,
  onClick,
  children,
  fullWidth = false,
  type = 'button',
}) => {
  const variantStyles = {
    primary: 'bg-slate-900 hover:bg-slate-800 text-white shadow-lg',
    secondary: 'bg-slate-200 hover:bg-slate-300 text-slate-900',
    danger: 'bg-rose-600 hover:bg-rose-700 text-white',
    success: 'bg-slate-900 hover:bg-slate-800 text-white',
  };

  const sizeStyles = {
    small: 'px-4 py-2 text-sm',
    medium: 'px-6 py-3 text-base',
    large: 'px-8 py-4 text-lg',
  };

  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      className={`
        font-semibold rounded-lg transition duration-200 flex items-center justify-center gap-2
        ${variantStyles[variant]}
        ${sizeStyles[size]}
        ${isDisabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}
        ${fullWidth ? 'w-full' : ''}
      `}
    >
      {loading && <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />}
      {children}
    </button>
  );
};
