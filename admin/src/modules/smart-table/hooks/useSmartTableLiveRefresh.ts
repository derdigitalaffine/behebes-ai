import { useCallback, useEffect, useRef, useState } from 'react';
import { subscribeAdminRealtime } from '../../../lib/realtime';
import type { SmartTableLiveConfig, SmartTableLiveState } from '../types';

interface RefreshOptions {
  silent?: boolean;
}

interface UseSmartTableLiveRefreshOptions<Query = unknown> {
  token: string;
  config: SmartTableLiveConfig<Query>;
  refresh: (options?: RefreshOptions) => Promise<void> | void;
}

const DEFAULT_DEBOUNCE_MS = 150;
const DEFAULT_VISIBLE_POLL_MS = 30000;
const DEFAULT_HIDDEN_POLL_MS = 120000;
const DEFAULT_STALE_MS = 180000;

export function useSmartTableLiveRefresh<Query = unknown>(
  options: UseSmartTableLiveRefreshOptions<Query>
) {
  const { token, config, refresh } = options;
  const [liveState, setLiveState] = useState<SmartTableLiveState>(
    config.mode === 'poll' ? 'polling' : 'live'
  );
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const inFlightRef = useRef(false);
  const queuedRef = useRef(false);
  const debounceTimerRef = useRef<number | null>(null);

  const runRefresh = useCallback(
    async (reason: 'manual' | 'event' | 'poll' | 'focus' = 'manual') => {
      if (!config.enabled) return;
      if (inFlightRef.current) {
        queuedRef.current = true;
        return;
      }

      inFlightRef.current = true;
      setIsRefreshing(true);
      try {
        await refresh({ silent: reason !== 'manual' });
        setLastSyncAt(new Date().toISOString());
        setLiveState((current) => {
          if (config.mode === 'poll') return 'polling';
          if (current === 'reconnecting' && config.mode === 'hybrid') return 'live';
          return current;
        });
      } finally {
        inFlightRef.current = false;
        setIsRefreshing(false);
        if (queuedRef.current) {
          queuedRef.current = false;
          void runRefresh('event');
        }
      }
    },
    [config.enabled, config.mode, refresh]
  );

  const queueDebouncedRefresh = useCallback(() => {
    const debounceMs = Math.max(40, Number(config.debounceMs || DEFAULT_DEBOUNCE_MS));
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      void runRefresh('event');
    }, debounceMs);
  }, [config.debounceMs, runRefresh]);

  useEffect(() => {
    if (!config.enabled) return undefined;
    if (config.mode === 'poll') {
      setLiveState('polling');
      return undefined;
    }

    const unsubscribe = subscribeAdminRealtime({
      token,
      topics: config.topics,
      onUpdate: (event) => {
        setLiveState('live');
        setLastEventAt(
          typeof event?.at === 'string' && event.at.trim() ? event.at.trim() : new Date().toISOString()
        );
        queueDebouncedRefresh();
      },
      onError: () => {
        setLiveState(config.mode === 'hybrid' ? 'reconnecting' : 'reconnecting');
      },
    });

    return () => {
      unsubscribe();
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [config.enabled, config.mode, config.topics, queueDebouncedRefresh, token]);

  useEffect(() => {
    if (!config.enabled) return undefined;
    if (config.mode !== 'poll' && config.mode !== 'hybrid') return undefined;

    let stopped = false;
    let timer: number | null = null;

    const schedule = () => {
      if (stopped) return;
      const visible = document.visibilityState === 'visible';
      const intervalMs = visible
        ? Math.max(3000, Number(config.pollIntervalMsVisible || DEFAULT_VISIBLE_POLL_MS))
        : Math.max(5000, Number(config.pollIntervalMsHidden || DEFAULT_HIDDEN_POLL_MS));
      timer = window.setTimeout(() => {
        timer = null;
        const staleAfterMs = Math.max(5000, Number(config.staleAfterMs || DEFAULT_STALE_MS));
        const stale = !lastSyncAt || Date.now() - Date.parse(lastSyncAt) > staleAfterMs;
        if (visible || stale) {
          void runRefresh('poll');
        }
        schedule();
      }, intervalMs);
    };

    schedule();
    return () => {
      stopped = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [
    config.enabled,
    config.mode,
    config.pollIntervalMsHidden,
    config.pollIntervalMsVisible,
    config.staleAfterMs,
    lastSyncAt,
    runRefresh,
  ]);

  useEffect(() => {
    if (!config.enabled || !config.refetchOnFocus) return undefined;

    const onFocus = () => {
      if (document.visibilityState === 'visible') {
        void runRefresh('focus');
      }
    };
    const onOnline = () => {
      void runRefresh('focus');
    };

    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [config.enabled, config.refetchOnFocus, runRefresh]);

  return {
    liveState,
    lastEventAt,
    lastSyncAt,
    isRefreshing,
    refreshNow: () => runRefresh('manual'),
  };
}
