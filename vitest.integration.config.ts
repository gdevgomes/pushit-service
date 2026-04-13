import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration.test.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    env: {
      DATABASE_URL: 'postgresql://postgres:3aCrs0mLuo4GqQHN@db.leiiimdzblaqxghehigm.supabase.co:5432/postgres',
      FIREBASE_SERVICE_ACCOUNT_PATH: './serviceAccountKey.json',
      NODE_ENV: 'development',
      LOG_LEVEL: 'error',
    },
  },
});
