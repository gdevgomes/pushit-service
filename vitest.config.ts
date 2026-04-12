import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    env: {
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      FCM_SERVER_KEY: 'test-fcm-server-key',
      NODE_ENV: 'development',
      LOG_LEVEL: 'error',
    },
  },
});
