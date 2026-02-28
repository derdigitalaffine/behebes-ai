import Dexie, { type Table } from 'dexie';
import axios from 'axios';
import type { AdminScopeSelection } from '../../lib/scope';
import { buildAuthHeaders } from '../../lib/api';

export interface OpsOfflineMutation {
  id?: number;
  createdAt: string;
  method: 'PATCH' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  body: Record<string, any> | null;
  status: 'pending' | 'failed';
  attempts: number;
  lastError: string | null;
}

export interface OpsOfflineQueueState {
  items: OpsOfflineMutation[];
  pendingCount: number;
  failedCount: number;
}

class OpsOfflineDb extends Dexie {
  mutations!: Table<OpsOfflineMutation, number>;

  constructor() {
    super('ops_offline_v1');
    this.version(1).stores({
      mutations: '++id, createdAt, status, attempts',
    });
  }
}

const db = new OpsOfflineDb();

export async function enqueueOfflineMutation(input: Omit<OpsOfflineMutation, 'id' | 'createdAt' | 'status' | 'attempts' | 'lastError'>): Promise<void> {
  await db.mutations.add({
    createdAt: new Date().toISOString(),
    method: input.method,
    url: input.url,
    body: input.body || null,
    status: 'pending',
    attempts: 0,
    lastError: null,
  });
}

export async function listOfflineMutations(): Promise<OpsOfflineMutation[]> {
  return db.mutations.orderBy('createdAt').toArray();
}

export async function getOfflineQueueState(): Promise<OpsOfflineQueueState> {
  const items = await listOfflineMutations();
  return {
    items,
    pendingCount: items.filter((entry) => entry.status === 'pending').length,
    failedCount: items.filter((entry) => entry.status === 'failed').length,
  };
}

export async function clearOfflineMutation(id: number): Promise<void> {
  await db.mutations.delete(id);
}

export async function replayOfflineMutations(token: string, scope: AdminScopeSelection): Promise<{ replayed: number; failed: number }> {
  const queue = await db.mutations.orderBy('createdAt').toArray();
  let replayed = 0;
  let failed = 0;

  for (const item of queue) {
    if (!item.id) continue;
    try {
      await axios.request({
        url: item.url,
        method: item.method,
        data: item.body || undefined,
        headers: buildAuthHeaders(token, scope),
      });
      await db.mutations.delete(item.id);
      replayed += 1;
    } catch (error: any) {
      const attempts = Number(item.attempts || 0) + 1;
      const status = attempts >= 10 ? 'failed' : 'pending';
      await db.mutations.update(item.id, {
        attempts,
        status,
        lastError: String(error?.response?.data?.message || error?.message || 'replay_failed').slice(0, 500),
      });
      failed += 1;
    }
  }

  return { replayed, failed };
}
