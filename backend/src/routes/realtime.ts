import { Request, Response, Router } from 'express';
import { authMiddleware, staffOnly } from '../middleware/auth.js';
import {
  AdminRealtimeTopic,
  subscribeAdminRealtimeUpdates,
} from '../services/realtime.js';

const router = Router();

function parseTopicSet(rawTopics: unknown): Set<AdminRealtimeTopic> {
  const allowed = new Set<AdminRealtimeTopic>(['tickets', 'workflows', 'ai_queue', 'email_queue']);
  if (typeof rawTopics !== 'string' || !rawTopics.trim()) {
    return allowed;
  }
  const parsed = rawTopics
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is AdminRealtimeTopic => allowed.has(entry as AdminRealtimeTopic));

  return parsed.length > 0 ? new Set(parsed) : allowed;
}

router.get('/stream', authMiddleware, staffOnly, (req: Request, res: Response) => {
  const topics = parseTopicSet(req.query.topics);
  let closed = false;

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof (res as any).flushHeaders === 'function') {
    (res as any).flushHeaders();
  }

  const writeEvent = (eventName: string, payload: Record<string, any>) => {
    if (closed || res.writableEnded || (res as any).destroyed) return false;
    try {
      res.write(`event: ${eventName}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
      return true;
    } catch {
      return false;
    }
  };

  writeEvent('ready', {
    connectedAt: new Date().toISOString(),
    topics: Array.from(topics),
  });

  const unsubscribe = subscribeAdminRealtimeUpdates((event) => {
    if (!topics.has(event.topic)) return;
    const ok = writeEvent('update', event);
    if (!ok) {
      cleanup();
    }
  });

  const heartbeat = setInterval(() => {
    const ok = writeEvent('ping', { at: new Date().toISOString() });
    if (!ok) {
      cleanup();
    }
  }, 25000);

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    if (!res.writableEnded) {
      try {
        res.end();
      } catch {
        // ignore socket close race
      }
    }
  };

  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
});

export default router;
