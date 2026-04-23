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
import type { PushProvider } from '../src/push';

const mockQuery = vi.mocked(db.query);
const mockProvider: PushProvider = { send: vi.fn() };

// Linha com notificação + token já joined
const row = (overrides: object = {}) => ({
  id: 42,
  name: 'Aniversário',
  description: 'Feliz aniversário!',
  group_id: 10,
  timezone: 'America/Sao_Paulo',
  push_token: 'tok-abc',
  ...overrides,
});

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

  it('registra sent quando token enviado com sucesso', async () => {
    const state = createState();
    // batch 1 → 1 row; batch 2 → vazio (fim); bulk INSERT
    mockQuery
      .mockResolvedValueOnce({ rows: [row()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    vi.mocked(mockProvider.send).mockResolvedValueOnce(undefined);

    await runJob(mockProvider, state);

    expect(state.totalSent).toBe(1);
    expect(state.totalFailed).toBe(0);
    expect(state.lastStats).toMatchObject({
      due: 1, sent: 1, failed: 0, tokensDelivered: 1, tokensFailed: 0,
    });
  });

  it('registra failed quando todos tokens falham', async () => {
    const state = createState();
    mockQuery
      .mockResolvedValueOnce({ rows: [row({ push_token: 'bad-token' })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    vi.mocked(mockProvider.send).mockRejectedValueOnce(new Error('NotRegistered'));

    await runJob(mockProvider, state);

    expect(state.totalSent).toBe(0);
    expect(state.totalFailed).toBe(1);
    expect(state.lastStats).toMatchObject({ sent: 0, failed: 1, tokensFailed: 1 });

    // bulk INSERT foi chamado com status=failed e JSON de erro
    const bulkCall = mockQuery.mock.calls.find((c) => (c[0] as string).includes('INSERT INTO'));
    expect(bulkCall).toBeDefined();
    const params = bulkCall![1] as unknown[];
    expect(params[2]).toBe('failed');
    expect(JSON.parse(params[3] as string).failed).toBe(1);
  });

  it('registra sent com error JSON parcial quando 1 de 2 tokens falha', async () => {
    const state = createState();
    // mesma notificação, dois tokens (duas linhas joined)
    mockQuery
      .mockResolvedValueOnce({ rows: [row({ push_token: 'ok-token' }), row({ push_token: 'bad-token' })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    vi.mocked(mockProvider.send)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('InvalidRegistration'));

    await runJob(mockProvider, state);

    expect(state.lastStats).toMatchObject({
      sent: 1, failed: 0, tokensDelivered: 1, tokensFailed: 1,
    });
    expect(state.totalSent).toBe(1);

    const bulkCall = mockQuery.mock.calls.find((c) => (c[0] as string).includes('INSERT INTO'));
    const params = bulkCall![1] as unknown[];
    expect(params[2]).toBe('sent');
    const errorJson = JSON.parse(params[3] as string);
    expect(errorJson.total).toBe(2);
    expect(errorJson.sent).toBe(1);
    expect(errorJson.failed).toBe(1);
    expect(errorJson.failures).toHaveLength(1);
  });

  it('processa múltiplas notificações de forma independente', async () => {
    const state = createState();
    mockQuery
      .mockResolvedValueOnce({ rows: [row({ id: 42, push_token: 'tok-1' }), row({ id: 43, push_token: 'tok-2' })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
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

  it('processa múltiplos batches até esgotar', async () => {
    const state = createState();
    const batch1 = Array.from({ length: 200 }, (_, i) => row({ id: i + 1, push_token: `tok-${i}` }));
    mockQuery
      .mockResolvedValueOnce({ rows: batch1 })    // batch 1
      .mockResolvedValueOnce({ rows: [] })         // bulk INSERT batch 1
      .mockResolvedValueOnce({ rows: [] });        // batch 2 → vazio, encerra
    vi.mocked(mockProvider.send).mockResolvedValue(undefined);

    await runJob(mockProvider, state);

    expect(state.lastStats?.due).toBe(200);
    expect(state.lastStats?.sent).toBe(200);
  });

  it('atualiza lastRun após execução', async () => {
    const state = createState();
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await runJob(mockProvider, state);

    expect(state.lastRun).toBeInstanceOf(Date);
  });
});
