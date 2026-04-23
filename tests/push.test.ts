import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/firebase', () => ({
  messaging: { send: vi.fn() },
}));

import { FCMProvider } from '../src/push';
import { messaging } from '../src/firebase';

const mockSend = vi.mocked(messaging.send);

function makeFirebaseError(code: string): Error & { code: string } {
  const err = new Error(code) as Error & { code: string };
  err.code = code;
  return err;
}

describe('FCMProvider', () => {
  let provider: FCMProvider;

  beforeEach(() => {
    vi.useFakeTimers();
    provider = new FCMProvider();
    mockSend.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('envia com sucesso na primeira tentativa', async () => {
    mockSend.mockResolvedValueOnce('msg-id');

    await expect(provider.send('token-abc', 'Título', 'Corpo')).resolves.toBeUndefined();
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('envia payload correto para o firebase-admin', async () => {
    mockSend.mockResolvedValueOnce('msg-id');

    await provider.send('device-token', 'Aniversário', 'Hoje é seu dia!');

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'device-token',
        notification: { title: 'Aniversário', body: 'Hoje é seu dia!' },
      }),
    );
  });

  it('retenta em erro retryável e sucede na segunda tentativa', async () => {
    mockSend
      .mockRejectedValueOnce(new Error('messaging/internal-error'))
      .mockResolvedValueOnce('msg-id');

    const promise = provider.send('token', 'title', 'body');
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBeUndefined();
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('falha após esgotar as 3 tentativas em erro retryável', async () => {
    mockSend.mockRejectedValue(new Error('messaging/internal-error'));

    const promise = provider.send('token', 'title', 'body');
    promise.catch(() => {});
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow();
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it('não retenta em InvalidRegistration', async () => {
    mockSend.mockRejectedValueOnce(
      makeFirebaseError('messaging/invalid-registration-token'),
    );

    await expect(provider.send('token', 'title', 'body')).rejects.toThrow();
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('não retenta em NotRegistered', async () => {
    mockSend.mockRejectedValueOnce(
      makeFirebaseError('messaging/registration-token-not-registered'),
    );

    await expect(provider.send('token', 'title', 'body')).rejects.toThrow();
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('não retenta em MismatchSenderId', async () => {
    mockSend.mockRejectedValueOnce(
      makeFirebaseError('messaging/mismatched-credential'),
    );

    await expect(provider.send('token', 'title', 'body')).rejects.toThrow();
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('não retenta em invalid-argument', async () => {
    mockSend.mockRejectedValueOnce(
      makeFirebaseError('messaging/invalid-argument'),
    );

    await expect(provider.send('token', 'title', 'body')).rejects.toThrow();
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
