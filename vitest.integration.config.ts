import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration.test.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    env: {
      DATABASE_URL: 'postgresql://postgres:pushittest@localhost:5433/pushit_test?sslmode=disable',
      RUN_INTEGRATION: 'true',
      FIREBASE_SERVICE_ACCOUNT_PATH: './serviceAccountKey.json',
      NODE_ENV: 'development',
      LOG_LEVEL: 'error',
    },
  },
});
