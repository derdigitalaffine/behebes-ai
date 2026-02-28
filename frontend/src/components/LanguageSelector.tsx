import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { STRINGS } from '../i18n/strings';

const FLAG_OVERRIDES: Record<string, string> = {
  de: '🇩🇪',
  en: '🇬🇧',
  fr: '🇫🇷',
  es: '🇪🇸',
  it: '🇮🇹',
  pt: '🇵🇹',
  nl: '🇳🇱',
  ru: '🇷🇺',
  zh: '🇨🇳',
  ar: '🇸🇦',
  hi: '🇮🇳',
  bn: '🇧🇩',
  ur: '🇵🇰',
  ja: '🇯🇵',
  ko: '🇰🇷',
  tr: '🇹🇷',
  vi: '🇻🇳',
  pl: '🇵🇱',
  th: '🇹🇭',
  uk: '🇺🇦',
  cs: '🇨🇿',
  sv: '🇸🇪',
  no: '🇳🇴',
  da: '🇩🇰',
  fi: '🇫🇮',
  hu: '🇭🇺',
  he: '🇮🇱',
  fa: '🇮🇷',
  ms: '🇲🇾',
  ta: '🇮🇳',
  te: '🇮🇳',
  mr: '🇮🇳',
  gu: '🇮🇳',
  kn: '🇮🇳',
  ml: '🇮🇳',
  pa: '🇮🇳',
  si: '🇱🇰',
  ne: '🇳🇵',
  af: '🇿🇦',
  sk: '🇸🇰',
  emoji: '😀',
};

const codeToRegionalFlag = (code: string): string => {
  const normalized = String(code || '').trim().toLowerCase();
  if (!normalized) return '🌐';
  if (FLAG_OVERRIDES[normalized]) return FLAG_OVERRIDES[normalized];
  if (/^[a-z]{2}$/.test(normalized)) {
    return normalized
      .toUpperCase()
      .split('')
      .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
      .join('');
  }
  return '🌐';
};

const LanguageSelector: React.FC = () => {
  const { language, languages, setLanguage, isTranslating, defaultLanguage, t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const sortedLanguages = useMemo(
    () => [...languages].sort((a, b) => (a.label || a.code).localeCompare(b.label || b.code, 'de', { sensitivity: 'base' })),
    [languages]
  );
  const translationStateByLanguage = useMemo(() => {
    const requiredKeys = Object.keys(STRINGS);
    const hasCompleteCache = (code: string) => {
      try {
        const raw = localStorage.getItem(`citizenTranslations_${code}`);
        if (!raw) return false;
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        return requiredKeys.every((key) => typeof parsed?.[key] === 'string' && String(parsed[key]).trim().length > 0);
      } catch {
        return false;
      }
    };

    const stateMap = new Map<string, 'saved' | 'translating' | 'missing'>();
    sortedLanguages.forEach((lang) => {
      if (lang.code === defaultLanguage) {
        stateMap.set(lang.code, 'saved');
        return;
      }
      if (isTranslating && lang.code === language) {
        stateMap.set(lang.code, 'translating');
        return;
      }
      stateMap.set(lang.code, hasCompleteCache(lang.code) ? 'saved' : 'missing');
    });
    return stateMap;
  }, [sortedLanguages, defaultLanguage, isTranslating, language]);

  const getLed = (code: string) => {
    const state = translationStateByLanguage.get(code) || 'missing';
    if (state === 'saved') return '🟢';
    if (state === 'translating') return '🟡';
    return '🔴';
  };

  const activeLanguage = sortedLanguages.find((lang) => lang.code === language) || sortedLanguages[0];

  useEffect(() => {
    if (!isOpen) return undefined;

    const onOutsideClick = (event: MouseEvent) => {
      if (!dropdownRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', onOutsideClick);
    window.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onOutsideClick);
      window.removeEventListener('keydown', onEscape);
    };
  }, [isOpen]);

  return (
    <div className="language-selector">
      <label className="language-label" htmlFor="language-select">
        <i className="fa-solid fa-language language-label-icon" aria-hidden="true" />
        {t('language_label')}
      </label>
      <div className="language-control">
        <div className="language-dropdown" ref={dropdownRef}>
          <button
            id="language-select"
            type="button"
            className="language-trigger"
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-label={t('language_label')}
            onClick={() => setIsOpen((prev) => !prev)}
          >
            <span className="language-trigger-flag">
              {(activeLanguage?.flag || codeToRegionalFlag(activeLanguage?.code || '')).trim()}
            </span>
            <span className="language-trigger-name">{activeLanguage?.label || language}</span>
            <span className="language-trigger-led">{getLed(activeLanguage?.code || '')}</span>
            <i className={`fa-solid ${isOpen ? 'fa-chevron-up' : 'fa-chevron-down'} language-trigger-chevron`} />
          </button>

          {isOpen && (
            <div className="language-menu" role="listbox" aria-label={t('language_label')}>
              {sortedLanguages.map((lang) => (
                <button
                  key={lang.code}
                  type="button"
                  role="option"
                  aria-selected={lang.code === language}
                  className={`language-option ${lang.code === language ? 'is-selected' : ''}`}
                  onClick={() => {
                    setLanguage(lang.code);
                    setIsOpen(false);
                  }}
                >
                  <span className="language-option-flag">{(lang.flag || codeToRegionalFlag(lang.code)).trim()}</span>
                  <span className="language-option-name">{lang.label}</span>
                  <span className="language-option-led">{getLed(lang.code)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {isTranslating && <span className="language-status">{t('language_translating')}</span>}
      </div>
    </div>
  );
};

export default LanguageSelector;
