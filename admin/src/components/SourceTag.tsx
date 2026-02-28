import React from 'react';

type SourceType = 'db' | 'env' | 'file' | 'default' | string;

const SOURCE_LABELS: Record<string, string> = {
  db: 'DB',
  env: 'ENV',
  file: 'FILE',
  default: 'DEFAULT',
};

const SOURCE_CLASSES: Record<string, string> = {
  db: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  env: 'bg-sky-100 text-sky-800 border-sky-200',
  file: 'bg-amber-100 text-amber-800 border-amber-200',
  default: 'bg-slate-200 text-slate-700 border-slate-300',
};

const SourceTag: React.FC<{ source?: SourceType }> = ({ source }) => {
  if (!source) return null;
  const label = SOURCE_LABELS[source] || String(source).toUpperCase();
  const className = SOURCE_CLASSES[source] || SOURCE_CLASSES.default;

  return (
    <span className={`ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${className}`}>
      {label}
    </span>
  );
};

export default SourceTag;
