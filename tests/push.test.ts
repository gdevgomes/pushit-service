import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FCMProvider } from '../src/push';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeOkResponse(success = 1, failure = 0, errorCode?: string) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        success,
        failure,
        results: errorCode ? [{ error: errorCode }] : [{ message_id: 'ok' }],
      }),
  };
}

function makeHttpError(status: number) {
  return { ok: false, status, json: () => Promise.resolve({}) };
}

describe('FCMProvider', () => {
  let provider: FCMProvider;

  beforeEach(() => {
    vi.useFakeTimers();
    provider = new FCMProvider('test-server-key');
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('envia com sucesso na primeira tentativa', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse());

    await expect(provider.send('token-abc', 'Título', 'Corpo')).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('envia payload e headers corretos para o FCM', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse());

    await provider.send('device-token', 'Aniversário', 'Hoje é seu dia!');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://fcm.googleapis.com/fcm/send',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'key=test-server-key',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          to: 'device-token',
          notification: { title: 'Aniversário', body: 'Hoje é seu dia!' },
        }),
      }),
    );
  });

  it('retenta quando FCM retorna Unavailable e sucede na segunda tentativa', async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse(0, 1, 'Unavailable'))
      .mockResolvedValueOnce(makeOkResponse());

    const promise = provider.send('token', 'title', 'body');
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retenta em HTTP 5xx e falha após esgotar as 3 tentativas', async () => {
    mockFetch.mockResolvedValue(makeHttpError(503));

    const promise = provider.send('token', 'title', 'body');
    promise.catch(() => {}); // evita unhandled rejection enquanto timers avançam
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow('FCM HTTP 503');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('não retenta em InvalidRegistration', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(0, 1, 'InvalidRegistration'));

    await expect(provider.send('token', 'title', 'body')).rejects.toThrow('InvalidRegistration');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('não retenta em NotRegistered', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(0, 1, 'NotRegistered'));

    await expect(provider.send('token', 'title', 'body')).rejects.toThrow('NotRegistered');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('não retenta em MismatchSenderId', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse(0, 1, 'MismatchSenderId'));

    await expect(provider.send('token', 'title', 'body')).rejects.toThrow('MismatchSenderId');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('não retenta em HTTP 4xx', async () => {
    mockFetch.mockResolvedValueOnce(makeHttpError(400));

    await expect(provider.send('token', 'title', 'body')).rejects.toThrow('FCM HTTP 400');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
