import { Pool } from 'pg';
import { config } from './config';

const ssl = config.DATABASE_URL.includes('sslmode=disable') ? false : { rejectUnauthorized: false };

export const db = new Pool({
  connectionString: config.DATABASE_URL,
  ssl,
  max: 5,
  idleTimeoutMillis: 30_000,
});
