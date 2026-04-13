import 'dotenv/config';
import { z } from 'zod';

const Schema = z.object({
  DATABASE_URL: z.string().min(1),
  // Em prod: forneça FIREBASE_SERVICE_ACCOUNT_JSON (base64 do serviceAccountKey.json)
  // Em dev:  forneça FIREBASE_SERVICE_ACCOUNT_PATH apontando para o arquivo
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().default('./serviceAccountKey.json'),
  TRIGGER_SECRET: z.string().optional(),
  PORT: z.coerce.number().default(3003),
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});

const result = Schema.safeParse(process.env);

if (!result.success) {
  console.error('Invalid environment configuration:');
  for (const issue of result.error.issues) {
    console.error(` - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = result.data;
export type Config = typeof config;
