import pLimit from 'p-limit';
import { db } from './db';
import { logger } from './logger';
import {
  NOTIFICATIONS_DUE_WITH_TOKENS,
  BULK_INSERT_NOTIFICATION_LOGS,
} from './queries';
import type { PushProvider } from './push';

const BATCH_SIZE = 200;
const FCM_CONCURRENCY = 50;

export interface JobStats {
  due: number;
  sent: number;
  failed: number;
  tokensDelivered: number;
  tokensFailed: number;
}

export interface JobState {
  startedAt: Date;
  lastRun: Date | null;
  lastStats: JobStats | null;
  totalSent: number;
  totalFailed: number;
  isRunning: boolean;
}

export function createState(): JobState {
  return {
    startedAt: new Date(),
    lastRun: null,
    lastStats: null,
    totalSent: 0,
    totalFailed: 0,
    isRunning: false,
  };
}

interface NotificationTokenRow {
  id: number;
  name: string;
  description: string;
  group_id: number;
  timezone: string;
  push_token: string;
}

interface NotificationWork {
  id: number;
  name: string;
  description: string;
  group_id: number;
  timezone: string;
  tokens: string[];
}

export async function runJob(provider: PushProvider, state: JobState, force = false): Promise<void> {
  if (state.isRunning) {
    logger.warn('job already running, skipping tick');
    return;
  }

  state.isRunning = true;
  try {
    await _runJob(provider, state, force);
  } finally {
    state.isRunning = false;
  }
}

async function _runJob(provider: PushProvider, state: JobState, force: boolean): Promise<void> {
  const jobStart = Date.now();
  logger.info({ force }, 'job started');

  const stats: JobStats = { due: 0, sent: 0, failed: 0, tokensDelivered: 0, tokensFailed: 0 };
  const limit = pLimit(FCM_CONCURRENCY);
  const query = NOTIFICATIONS_DUE_WITH_TOKENS(force);

  let offset = 0;
  while (true) {
    const { rows } = await db.query<NotificationTokenRow>(query, [BATCH_SIZE, offset]);
    if (rows.length === 0) break;

    const byNotification = groupByNotification(rows);
    logger.info({ batch: offset / BATCH_SIZE + 1, notifications: byNotification.length }, 'processing batch');

    const logs = await processBatch(byNotification, provider, limit, stats);

    if (logs.length > 0) {
      const params = logs.flatMap((l) => [l.notification_id, l.group_id, l.status, l.error]);
      await db.query(BULK_INSERT_NOTIFICATION_LOGS(logs.length), params);
    }

    offset += BATCH_SIZE;
  }

  state.totalSent += stats.sent;
  state.totalFailed += stats.failed;
  state.lastRun = new Date();
  state.lastStats = stats;

  logger.info({ ...stats, durationMs: Date.now() - jobStart }, 'job completed');
}

function groupByNotification(rows: NotificationTokenRow[]): NotificationWork[] {
  const map = new Map<number, NotificationWork>();
  for (const row of rows) {
    if (!map.has(row.id)) {
      map.set(row.id, {
        id: row.id,
        name: row.name,
        description: row.description,
        group_id: row.group_id,
        timezone: row.timezone,
        tokens: [],
      });
    }
    map.get(row.id)!.tokens.push(row.push_token);
  }
  return Array.from(map.values());
}

interface LogEntry {
  notification_id: number;
  group_id: number;
  status: 'sent' | 'failed';
  error: string | null;
}

async function processBatch(
  notifications: NotificationWork[],
  provider: PushProvider,
  limit: ReturnType<typeof pLimit>,
  stats: JobStats,
): Promise<LogEntry[]> {
  stats.due += notifications.length;

  const results = await Promise.allSettled(
    notifications.map((n) =>
      limit(async () => {
        const tokenResults = await Promise.allSettled(
          n.tokens.map((token) =>
            provider.send(token, n.name, n.description, {
              notificationId: String(n.id),
              groupId: String(n.group_id),
              name: n.name,
              description: n.description ?? '',
            }),
          ),
        );

        const sent = tokenResults.filter((r) => r.status === 'fulfilled').length;
        const failed = tokenResults.filter((r) => r.status === 'rejected').length;

        stats.tokensDelivered += sent;
        stats.tokensFailed += failed;

        const status: 'sent' | 'failed' = sent >= 1 ? 'sent' : 'failed';
        if (status === 'sent') { stats.sent++; } else { stats.failed++; }

        const error =
          failed === 0
            ? null
            : JSON.stringify({
                total: n.tokens.length,
                sent,
                failed,
                failures: tokenResults
                  .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
                  .map((r) => r.reason?.message ?? String(r.reason)),
              });

        return { notification_id: n.id, group_id: n.group_id, status, error } satisfies LogEntry;
      }),
    ),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<LogEntry> => r.status === 'fulfilled')
    .map((r) => r.value);
}
