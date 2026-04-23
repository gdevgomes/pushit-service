import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createServer } from '../src/server';
import type { JobState } from '../src/job';
import type { PushProvider } from '../src/push';

vi.mock('../src/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  },
}));

vi.mock('../src/config', () => ({
  config: {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    FCM_SERVER_KEY: 'test-key',
    PORT: 3000,
    NODE_ENV: 'development',
    LOG_LEVEL: 'error',
  },
}));

vi.mock('../src/db', () => ({
  db: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

const mockProvider: PushProvider = { send: vi.fn() };

function makeState(overrides: Partial<JobState> = {}): JobState {
  return {
    startedAt: new Date('2026-04-12T05:00:00.000Z'),
    lastRun: null,
    lastStats: null,
    totalSent: 0,
    totalFailed: 0,
    isRunning: false,
    ...overrides,
  };
}

describe('GET /status', () => {
  it('retorna status ok com estado inicial', async () => {
    const app = createServer(makeState(), mockProvider);

    const res = await request(app).get('/status');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.lastJobRun).toBeNull();
    expect(res.body.lastJobStats).toBeNull();
    expect(res.body.totalSent).toBe(0);
    expect(res.body.totalFailed).toBe(0);
  });

  it('retorna uptime em segundos', async () => {
    const startedAt = new Date(Date.now() - 3600_000);
    const app = createServer(makeState({ startedAt }), mockProvider);

    const res = await request(app).get('/status');

    expect(res.body.uptime).toBeGreaterThanOrEqual(3600);
    expect(res.body.uptime).toBeLessThan(3602);
  });

  it('retorna lastJobRun como ISO string quando definido', async () => {
    const lastRun = new Date('2026-04-12T06:00:00.000Z');
    const app = createServer(makeState({ lastRun }), mockProvider);

    const res = await request(app).get('/status');

    expect(res.body.lastJobRun).toBe('2026-04-12T06:00:00.000Z');
  });

  it('retorna lastJobStats quando definido', async () => {
    const lastStats = { due: 3, sent: 2, failed: 1, tokensDelivered: 10, tokensFailed: 2 };
    const app = createServer(makeState({ lastStats }), mockProvider);

    const res = await request(app).get('/status');

    expect(res.body.lastJobStats).toEqual(lastStats);
  });

  it('retorna totalSent e totalFailed acumulados', async () => {
    const app = createServer(makeState({ totalSent: 142, totalFailed: 3 }), mockProvider);

    const res = await request(app).get('/status');

    expect(res.body.totalSent).toBe(142);
    expect(res.body.totalFailed).toBe(3);
  });
});
