import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db', () => ({
  db: { query: vi.fn() },
}));

vi.mock('../src/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { runJob, createState } from '../src/job';
import { db } from '../src/db';
import { logger } from '../src/logger';
import { INSERT_NOTIFICATION_LOG, PUSH_TOKENS_FOR_GROUP } from '../src/queries';
import type { PushProvider } from '../src/push';

const mockQuery = vi.mocked(db.query);
const mockProvider: PushProvider = { send: vi.fn() };

const NOTIFICATION = {
  id: '42',
  name: 'Aniversário',
  description: 'Feliz aniversário!',
  group_id: '10',
  timezone: 'America/Sao_Paulo',
};

const token = (t: string) => ({ push_token: t });

describe('createState', () => {
  it('retorna estado inicial correto', () => {
    const state = createState();

    expect(state.isRunning).toBe(false);
    expect(state.lastRun).toBeNull();
    expect(state.lastStats).toBeNull();
    expect(state.totalSent).toBe(0);
    expect(state.totalFailed).toBe(0);
    expect(state.startedAt).toBeInstanceOf(Date);
  });
});

describe('runJob', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    vi.mocked(mockProvider.send).mockReset();
  });

  it('pula tick quando isRunning = true', async () => {
    const state = createState();
    state.isRunning = true;

    await runJob(mockProvider, state);

    expect(mockQuery).not.toHaveBeenCalled();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('already running'),
    );
  });

  it('garante isRunning = false ao terminar mesmo em erro de banco', async () => {
    const state = createState();
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    await expect(runJob(mockProvider, state)).rejects.toThrow('connection refused');

    expect(state.isRunning).toBe(false);
  });

  it('não envia quando não há notificações', async () => {
    const state = createState();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await runJob(mockProvider, state);

    expect(mockProvider.send).not.toHaveBeenCalled();
    expect(state.lastStats).toMatchObject({ due: 0, sent: 0, failed: 0 });
  });

  it('pula notificação sem tokens — não grava notification_log', async () => {
    const state = createState();
    mockQuery
      .mockResolvedValueOnce({ rows: [NOTIFICATION] })  // NOTIFICATIONS_DUE
      .mockResolvedValueOnce({ rows: [] });              // PUSH_TOKENS_FOR_GROUP → vazio

    await runJob(mockProvider, state);

    expect(mockProvider.send).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery).not.toHaveBeenCalledWith(INSERT_NOTIFICATION_LOG, expect.anything());
  });

  it('registra sent quando token enviado com sucesso', async () => {
    const state = createState();
    mockQuery
      .mockResolvedValueOnce({ rows: [NOTIFICATION] })
      .mockResolvedValueOnce({ rows: [token('tok-abc')] })
      .mockResolvedValueOnce({ rows: [] }); // INSERT
    vi.mocked(mockProvider.send).mockResolvedValueOnce(undefined);

    await runJob(mockProvider, state);

    expect(state.totalSent).toBe(1);
    expect(state.totalFailed).toBe(0);
    expect(state.lastStats).toMatchObject({
      due: 1,
      sent: 1,
      failed: 0,
      tokensDelivered: 1,
      tokensFailed: 0,
    });
    expect(mockQuery).toHaveBeenNthCalledWith(3, INSERT_NOTIFICATION_LOG, [
      NOTIFICATION.id,
      NOTIFICATION.group_id,
      'sent',
      null,
    ]);
  });

  it('registra failed quando todos tokens falham', async () => {
    const state = createState();
    mockQuery
      .mockResolvedValueOnce({ rows: [NOTIFICATION] })
      .mockResolvedValueOnce({ rows: [token('bad-token')] })
      .mockResolvedValueOnce({ rows: [] });
    vi.mocked(mockProvider.send).mockRejectedValueOnce(new Error('NotRegistered'));

    await runJob(mockProvider, state);

    expect(state.totalSent).toBe(0);
    expect(state.totalFailed).toBe(1);
    expect(state.lastStats).toMatchObject({ sent: 0, failed: 1, tokensFailed: 1 });

    expect(mockQuery).toHaveBeenNthCalledWith(
      3,
      INSERT_NOTIFICATION_LOG,
      [NOTIFICATION.id, NOTIFICATION.group_id, 'failed', expect.stringContaining('"failed":1')],
    );
  });

  it('registra sent com error JSON parcial quando 1 de 2 tokens falha', async () => {
    const state = createState();
    mockQuery
      .mockResolvedValueOnce({ rows: [NOTIFICATION] })
      .mockResolvedValueOnce({ rows: [token('ok-token'), token('bad-token')] })
      .mockResolvedValueOnce({ rows: [] });
    vi.mocked(mockProvider.send)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('InvalidRegistration'));

    await runJob(mockProvider, state);

    expect(state.lastStats).toMatchObject({
      sent: 1,
      failed: 0,
      tokensDelivered: 1,
      tokensFailed: 1,
    });
    expect(state.totalSent).toBe(1);

    const insertArgs = (mockQuery.mock.calls[2] as [string, unknown[]])[1];
    expect(insertArgs[2]).toBe('sent');
    const errorJson = JSON.parse(insertArgs[3] as string);
    expect(errorJson.total).toBe(2);
    expect(errorJson.sent).toBe(1);
    expect(errorJson.failed).toBe(1);
    expect(errorJson.failures).toHaveLength(1);
  });

  it('processa múltiplas notificações de forma independente', async () => {
    const state = createState();
    const NOTIFICATION_2 = { ...NOTIFICATION, id: '43' };
    mockQuery
      .mockResolvedValueOnce({ rows: [NOTIFICATION, NOTIFICATION_2] })
      .mockResolvedValueOnce({ rows: [token('tok-1')] })   // tokens notif 1
      .mockResolvedValueOnce({ rows: [] })                  // INSERT notif 1
      .mockResolvedValueOnce({ rows: [token('tok-2')] })   // tokens notif 2
      .mockResolvedValueOnce({ rows: [] });                 // INSERT notif 2
    vi.mocked(mockProvider.send)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Unavailable'));

    await runJob(mockProvider, state);

    expect(state.lastStats?.due).toBe(2);
    expect(state.lastStats?.sent).toBe(1);
    expect(state.lastStats?.failed).toBe(1);
    expect(state.totalSent).toBe(1);
    expect(state.totalFailed).toBe(1);
  });

  it('busca tokens pelo group_id correto', async () => {
    const state = createState();
    mockQuery
      .mockResolvedValueOnce({ rows: [NOTIFICATION] })
      .mockResolvedValueOnce({ rows: [] });

    await runJob(mockProvider, state);

    expect(mockQuery).toHaveBeenNthCalledWith(2, PUSH_TOKENS_FOR_GROUP, [NOTIFICATION.group_id]);
  });

  it('atualiza lastRun após execução', async () => {
    const state = createState();
    expect(state.lastRun).toBeNull();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await runJob(mockProvider, state);

    expect(state.lastRun).toBeInstanceOf(Date);
  });
});
