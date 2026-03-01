import { EventEmitter } from 'events';

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

type TopicPayload = Partial<Omit<AdminRealtimeUpdate, 'id' | 'topic' | 'at'>> & {
  reason?: string;
};

const emitter = new EventEmitter();
emitter.setMaxListeners(500);

let nextEventId = 1;
let flushTimer: NodeJS.Timeout | null = null;
const pendingByTopic = new Map<AdminRealtimeTopic, TopicPayload>();

function flushPending() {
  flushTimer = null;
  if (pendingByTopic.size === 0) return;

  const now = new Date().toISOString();
  for (const [topic, payload] of pendingByTopic.entries()) {
    const event: AdminRealtimeUpdate = {
      id: nextEventId++,
      topic,
      reason: payload.reason || `${topic}.changed`,
      at: now,
      ...(payload.ticketId ? { ticketId: payload.ticketId } : {}),
      ...(payload.workflowId ? { workflowId: payload.workflowId } : {}),
      ...(payload.aiQueueId ? { aiQueueId: payload.aiQueueId } : {}),
      ...(payload.emailQueueId ? { emailQueueId: payload.emailQueueId } : {}),
      ...(payload.chatUserId ? { chatUserId: payload.chatUserId } : {}),
      ...(payload.callId ? { callId: payload.callId } : {}),
    };
    emitter.emit('update', event);
  }
  pendingByTopic.clear();
}

function queueTopicUpdate(topic: AdminRealtimeTopic, payload?: TopicPayload) {
  const current = pendingByTopic.get(topic) || {};
  pendingByTopic.set(topic, {
    ...current,
    ...(payload || {}),
  });

  if (!flushTimer) {
    // Bundle bursts of updates into one event per topic.
    flushTimer = setTimeout(flushPending, 160);
  }
}

export function publishTicketUpdate(payload?: TopicPayload) {
  queueTopicUpdate('tickets', payload);
}

export function publishWorkflowUpdate(payload?: TopicPayload) {
  queueTopicUpdate('workflows', payload);
}

export function publishAiQueueUpdate(payload?: TopicPayload) {
  queueTopicUpdate('ai_queue', payload);
}

export function publishEmailQueueUpdate(payload?: TopicPayload) {
  queueTopicUpdate('email_queue', payload);
}

export function publishChatPresenceUpdate(payload?: TopicPayload) {
  queueTopicUpdate('chat_presence', payload);
}

export function publishChatCallUpdate(payload?: TopicPayload) {
  queueTopicUpdate('chat_calls', payload);
}

export function subscribeAdminRealtimeUpdates(
  listener: (event: AdminRealtimeUpdate) => void
): () => void {
  emitter.on('update', listener);
  return () => {
    emitter.off('update', listener);
  };
}
