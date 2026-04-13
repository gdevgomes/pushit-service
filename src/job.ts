import { db } from './db';
import { logger } from './logger';
import { NOTIFICATIONS_DUE, NOTIFICATIONS_DUE_FORCED, PUSH_TOKENS_FOR_GROUP, INSERT_NOTIFICATION_LOG } from './queries';
import type { PushProvider } from './push';

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

interface NotificationRow {
  id: string;
  name: string;
  description: string;
  group_id: string;
  timezone: string;
}

interface TokenRow {
  push_token: string;
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

  const query = force ? NOTIFICATIONS_DUE_FORCED : NOTIFICATIONS_DUE;
  const { rows: notifications } = await db.query<NotificationRow>(query);
  logger.info({ due: notifications.length }, 'notifications due');

  const stats: JobStats = {
    due: notifications.length,
    sent: 0,
    failed: 0,
    tokensDelivered: 0,
    tokensFailed: 0,
  };

  for (const notification of notifications) {
    const childLog = logger.child({
      notificationId: notification.id,
      groupId: notification.group_id,
    });

    const { rows: tokenRows } = await db.query<TokenRow>(PUSH_TOKENS_FOR_GROUP, [
      notification.group_id,
    ]);

    if (tokenRows.length === 0) {
      childLog.info('no tokens for group, skipping');
      continue;
    }

    const results = await Promise.allSettled(
      tokenRows.map((row) =>
        provider.send(row.push_token, notification.name, notification.description),
      ),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    const sent = fulfilled.length;
    const failed = rejected.length;

    stats.tokensDelivered += sent;
    stats.tokensFailed += failed;

    const status = sent >= 1 ? 'sent' : 'failed';
    const errorPayload =
      failed === 0
        ? null
        : JSON.stringify({
            total: tokenRows.length,
            sent,
            failed,
            failures: rejected.map((r) => r.reason?.message ?? String(r.reason)),
          });

    if (status === 'sent') {
      stats.sent++;
      state.totalSent++;
    } else {
      stats.failed++;
      state.totalFailed++;
    }

    await db.query(INSERT_NOTIFICATION_LOG, [
      notification.id,
      notification.group_id,
      status,
      errorPayload,
    ]);

    childLog.info({ sent, failed, status }, 'notification processed');
  }

  state.lastRun = new Date();
  state.lastStats = stats;

  const durationMs = Date.now() - jobStart;
  logger.info({ ...stats, durationMs }, 'job completed');
}
