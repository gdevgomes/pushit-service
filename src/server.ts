import express from 'express';
import type { JobState } from './job';

export function createServer(state: JobState): express.Express {
  const app = express();

  app.get('/status', (_req, res) => {
    res.json({
      status: 'ok',
      uptime: Math.floor((Date.now() - state.startedAt.getTime()) / 1000),
      lastJobRun: state.lastRun?.toISOString() ?? null,
      lastJobStats: state.lastStats,
      totalSent: state.totalSent,
      totalFailed: state.totalFailed,
    });
  });

  return app;
}
