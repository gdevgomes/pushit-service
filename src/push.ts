import { messaging } from './firebase';

const NON_RETRYABLE_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
  'messaging/mismatched-credential',
  'messaging/invalid-argument',
]);

const RETRY_DELAYS_MS = [0, 1_000, 3_000];

export interface PushProvider {
  send(token: string, title: string, body: string, data?: Record<string, string>): Promise<void>;
}

export class FCMProvider implements PushProvider {
  async send(token: string, title: string, body: string, data?: Record<string, string>): Promise<void> {
    let lastError: Error = new Error('Unknown error');

    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) {
        await sleep(RETRY_DELAYS_MS[attempt]);
      }

      try {
        await messaging.send({
          token,
          notification: { title, body },
          data: data ?? {},
        });
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (isNonRetryable(lastError)) {
          throw lastError;
        }
      }
    }

    throw lastError;
  }
}

function isNonRetryable(err: Error & { code?: string }): boolean {
  return err.code !== undefined && NON_RETRYABLE_CODES.has(err.code);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
