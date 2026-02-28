import { useCallback, useEffect, useState } from 'react';
import type { SmartTableDataSource } from '../types';

interface RefreshOptions {
  silent?: boolean;
}

export function useSmartTableDataSource<Row, Query>(
  dataSource: SmartTableDataSource<Row, Query>
) {
  const [query, setQuery] = useState<Query>(dataSource.defaultQuery);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  const refresh = useCallback(
    async (options?: RefreshOptions) => {
      const silent = options?.silent === true;
      if (!silent) {
        setLoading(true);
      }
      try {
        const result = await dataSource.fetchRows(query);
        setRows(Array.isArray(result?.rows) ? result.rows : []);
        setTotal(Number.isFinite(Number(result?.total)) ? Number(result.total) : Array.isArray(result?.rows) ? result.rows.length : 0);
        setError('');
        setLastSyncAt(new Date().toISOString());
      } catch (err: any) {
        setError(String(err?.response?.data?.message || err?.message || 'Daten konnten nicht geladen werden.'));
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [dataSource, query]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    query,
    setQuery,
    rows,
    total,
    loading,
    error,
    lastSyncAt,
    refresh,
  };
}
