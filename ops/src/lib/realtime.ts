export type AdminRealtimeTopic =
  | 'tickets'
  | 'workflows'
  | 'ai_queue'
  | 'email_queue'
  | 'chat_presence'
  | 'chat_calls';

export interface AdminRealtimeUpdate {
  id: number;
  topic: AdminRealtimeTopic;
  reason: string;
  at: string;
  ticketId?: string;
  workflowId?: string;
  aiQueueId?: string;
  emailQueueId?: string;
  chatUserId?: string;
  callId?: string;
}

interface SubscribeOptions {
  token: string;
  topics?: AdminRealtimeTopic[];
  onUpdate: (event: AdminRealtimeUpdate) => void;
  onError?: (message: string) => void;
}

function parseSseChunk(chunk: string): { event: string; data: string } | null {
  const trimmed = chunk.trim();
  if (!trimmed) return null;
  const lines = trimmed.split('\n');
  let event = 'message';
  const dataParts: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataParts.push(line.slice(5).trimStart());
    }
  }

  return {
    event,
    data: dataParts.join('\n'),
  };
}

export function subscribeAdminRealtime(options: SubscribeOptions): () => void {
  const { token, topics = ['tickets', 'workflows'], onUpdate, onError } = options;
  const query = new URLSearchParams({ topics: topics.join(',') });
  const url = `/api/admin/realtime/stream?${query.toString()}`;

  let stopped = false;
  let reconnectDelayMs = 1000;
  let reconnectTimer: number | null = null;
  let controller: AbortController | null = null;

  const scheduleReconnect = () => {
    if (stopped) return;
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer);
    }
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, reconnectDelayMs);
    reconnectDelayMs = Math.min(reconnectDelayMs * 1.5, 15000);
  };

  const connect = async () => {
    if (stopped) return;
    controller = new AbortController();
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'text/event-stream',
        },
        cache: 'no-store',
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          stopped = true;
          onError?.('Sitzung abgelaufen. Bitte erneut anmelden.');
          return;
        }
        throw new Error(`Realtime-Stream fehlgeschlagen (${response.status})`);
      }

      if (!response.body) {
        throw new Error(`Realtime-Stream fehlgeschlagen (${response.status})`);
      }

      reconnectDelayMs = 1000;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let splitIndex = buffer.indexOf('\n\n');
        while (splitIndex !== -1) {
          const raw = buffer.slice(0, splitIndex);
          buffer = buffer.slice(splitIndex + 2);
          const parsed = parseSseChunk(raw);
          if (parsed && parsed.event === 'update' && parsed.data) {
            try {
              const event = JSON.parse(parsed.data) as AdminRealtimeUpdate;
              onUpdate(event);
            } catch {
              // ignore malformed payloads
            }
          }
          splitIndex = buffer.indexOf('\n\n');
        }
      }
    } catch (error) {
      if (!stopped) {
        onError?.(error instanceof Error ? error.message : 'Realtime-Verbindung verloren');
      }
    } finally {
      if (!stopped) scheduleReconnect();
    }
  };

  void connect();

  return () => {
    stopped = true;
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    controller?.abort();
  };
}
