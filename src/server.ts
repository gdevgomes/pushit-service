import express from 'express';
import { runJob, type JobState } from './job';
import type { PushProvider } from './push';
import { config } from './config';
import { db } from './db';
import { NOTIFICATIONS_UPCOMING, NOTIFICATIONS_RECENT_SENT } from './queries';

export function createServer(state: JobState, provider: PushProvider): express.Express {
  const app = express();

  app.get('/status', async (_req, res) => {
    const [upcoming, recentSent] = await Promise.all([
      db.query(NOTIFICATIONS_UPCOMING).then((r) => r.rows),
      db.query(NOTIFICATIONS_RECENT_SENT).then((r) => r.rows),
    ]);

    res.json({
      status: 'ok',
      uptime: Math.floor((Date.now() - state.startedAt.getTime()) / 1000),
      lastJobRun: state.lastRun?.toISOString() ?? null,
      lastJobStats: state.lastStats,
      totalSent: state.totalSent,
      totalFailed: state.totalFailed,
      upcoming,
      recentSent,
    });
  });

  app.post('/trigger', (req, res) => {
    const secret = config.TRIGGER_SECRET;
    if (secret) {
      const auth = req.headers['authorization'];
      if (auth !== `Bearer ${secret}`) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
    }
    runJob(provider, state, true)
      .then(() => res.json({ triggered: true, stats: state.lastStats }))
      .catch((err: unknown) => res.status(500).json({ error: String(err) }));
  });

  return app;
}
