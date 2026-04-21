import express from 'express';
import { runJob, type JobState } from './job';
import type { PushProvider } from './push';
import { config } from './config';
import { db } from './db';
import { NOTIFICATIONS_UPCOMING, NOTIFICATIONS_RECENT_SENT, PUSH_TOKEN_FOR_USER } from './queries';

export function createServer(state: JobState, provider: PushProvider): express.Express {
  const app = express();
  app.use(express.json());

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

  app.post('/trigger/user', async (req, res) => {
    const secret = config.TRIGGER_SECRET;
    if (secret) {
      const auth = req.headers['authorization'];
      if (auth !== `Bearer ${secret}`) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
    }

    const { userId, title, body } = req.body ?? {};
    if (!userId || !title || !body) {
      res.status(400).json({ error: 'userId, title and body are required' });
      return;
    }

    try {
      const { rows } = await db.query<{ push_token: string }>(PUSH_TOKEN_FOR_USER, [userId]);
      if (rows.length === 0) {
        res.status(404).json({ error: 'No push token found for user' });
        return;
      }
      await provider.send(rows[0].push_token, title, body);
      res.json({ sent: true });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
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
