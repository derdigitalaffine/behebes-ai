import React, { useMemo, useState } from 'react';

interface KeywordChipsInputProps {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  helperText?: string;
  disabled?: boolean;
  className?: string;
  maxItems?: number;
}

const DEFAULT_MAX_ITEMS = 120;
const KEYWORD_SPLIT_REGEX = /[\n,;|]+/g;

function normalizeKeyword(raw: unknown): string {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

function normalizeKeywordList(raw: unknown): string[] {
  const source = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
    ? raw.split(KEYWORD_SPLIT_REGEX)
    : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of source) {
    const keyword = normalizeKeyword(entry);
    if (!keyword) continue;
    const key = keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(keyword);
  }
  return out;
}

const KeywordChipsInput: React.FC<KeywordChipsInputProps> = ({
  label,
  value,
  onChange,
  placeholder = 'Schlagwort eingeben',
  helperText = 'Mit Enter, Komma oder Semikolon trennen.',
  disabled = false,
  className = '',
  maxItems = DEFAULT_MAX_ITEMS,
}) => {
  const [draft, setDraft] = useState('');

  const normalizedValue = useMemo(() => normalizeKeywordList(value), [value]);

  const commitDraft = (raw: string) => {
    if (disabled) return;
    const incoming = normalizeKeywordList(raw);
    if (incoming.length === 0) return;
    const merged = normalizeKeywordList([...normalizedValue, ...incoming]).slice(0, maxItems);
    onChange(merged);
    setDraft('');
  };

  const removeKeyword = (keyword: string) => {
    if (disabled) return;
    const key = normalizeKeyword(keyword).toLowerCase();
    onChange(normalizedValue.filter((entry) => entry.toLowerCase() !== key));
  };

  return (
    <div className={`space-y-2 ${className}`.trim()}>
      <label className="block text-sm font-semibold">{label}</label>
      <div className="min-h-[46px] rounded-lg border border-slate-200 bg-white px-2 py-2">
        {normalizedValue.length === 0 ? (
          <span className="text-xs text-slate-400">Noch keine Schlagworte gesetzt.</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {normalizedValue.map((keyword) => (
              <span key={keyword.toLowerCase()} className="badge bg-emerald-50 text-emerald-700 flex items-center gap-1">
                <span>{keyword}</span>
                {!disabled && (
                  <button
                    type="button"
                    className="text-emerald-700 hover:text-emerald-900"
                    onClick={() => removeKeyword(keyword)}
                    aria-label={`Schlagwort ${keyword} entfernen`}
                  >
                    <i className="fa-solid fa-xmark" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input flex-1 min-w-[240px]"
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => commitDraft(draft)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
              event.preventDefault();
              commitDraft(draft);
            }
          }}
        />
        <button
          type="button"
          className="btn btn-secondary"
          disabled={disabled || normalizeKeyword(draft).length === 0}
          onClick={() => commitDraft(draft)}
        >
          Hinzufügen
        </button>
      </div>
      <small className="text-slate-500">
        {helperText} {normalizedValue.length}/{maxItems}
      </small>
    </div>
  );
};

export default KeywordChipsInput;
