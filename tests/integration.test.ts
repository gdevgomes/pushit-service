import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.mock('../src/firebase', () => ({
  messaging: { send: vi.fn().mockResolvedValue('mock-message-id') },
}));

vi.mock('../src/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  },
}));

import { Pool } from 'pg';
import { runJob, createState } from '../src/job';
import { FCMProvider } from '../src/push';
import { messaging } from '../src/firebase';

const now = new Date();
const TODAY_MONTH = now.getUTCMonth() + 1;
const TODAY_DAY = now.getUTCDate();
const PUSH_TOKEN = 'integration-test-fcm-token-xyz';

let pool: Pool;
let userId: number;
let group1Id: number;
let group2Id: number;
let notif1Id: number;
let notif2Id: number;

async function cleanup() {
  await pool.query(
    `DELETE FROM notification_logs
     WHERE notification_id IN (
       SELECT n.id FROM notifications n
       JOIN groups g ON g.id = n.group_id
       JOIN users u ON u.id = g.owner_id
       WHERE u.email = 'integration-test@pushit.test'
     )`,
  );
  await pool.query(
    `DELETE FROM notifications
     WHERE group_id IN (
       SELECT g.id FROM groups g
       JOIN users u ON u.id = g.owner_id
       WHERE u.email = 'integration-test@pushit.test'
     )`,
  );
  await pool.query(
    `DELETE FROM users_groups
     WHERE user_id IN (SELECT id FROM users WHERE email = 'integration-test@pushit.test')`,
  );
  await pool.query(
    `DELETE FROM group_subscriptions
     WHERE group_id IN (
       SELECT g.id FROM groups g
       JOIN users u ON u.id = g.owner_id
       WHERE u.email = 'integration-test@pushit.test'
     )`,
  );
  await pool.query(
    `DELETE FROM groups
     WHERE owner_id IN (SELECT id FROM users WHERE email = 'integration-test@pushit.test')`,
  );
  await pool.query(
    `DELETE FROM user_profiles
     WHERE user_id IN (SELECT id FROM users WHERE email = 'integration-test@pushit.test')`,
  );
  await pool.query(`DELETE FROM users WHERE email = 'integration-test@pushit.test'`);
}

beforeAll(async () => {
  if (!process.env.RUN_INTEGRATION) return;

  const url = process.env.DATABASE_URL!;
  pool = new Pool({
    connectionString: url,
    ssl: url.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
  });

  await cleanup();

  const userRes = await pool.query(
    `INSERT INTO users (email, "passwordHash", username) VALUES ($1, $2, $3) RETURNING id`,
    ['integration-test@pushit.test', 'fakehash', 'integration-test-user'],
  );
  userId = userRes.rows[0].id;

  await pool.query(
    `INSERT INTO user_profiles (user_id, name, timezone, push_token) VALUES ($1, $2, $3, $4)`,
    [userId, 'Integration User', 'UTC', PUSH_TOKEN],
  );

  const g1 = await pool.query(
    `INSERT INTO groups (name, code, owner_id) VALUES ($1, $2, $3) RETURNING id`,
    ['Grupo Integração 1', 'TST001', userId],
  );
  group1Id = g1.rows[0].id;

  await pool.query(
    `INSERT INTO group_subscriptions (group_id, plan_id, status, trial_ends_at, monthly_amount)
     VALUES ($1, 1, 'active', NOW() + interval '1 year', 30)`,
    [group1Id],
  );
  await pool.query(
    `INSERT INTO users_groups (user_id, group_id) VALUES ($1, $2)`,
    [userId, group1Id],
  );

  const n1 = await pool.query(
    `INSERT INTO notifications (name, description, month, day, timezone, scheduled_at, group_id, created_by)
     VALUES ($1, $2, $3, $4, 'UTC', NOW(), $5, $6) RETURNING id`,
    ['Notif Grupo 1', 'Descrição 1', TODAY_MONTH, TODAY_DAY, group1Id, userId],
  );
  notif1Id = n1.rows[0].id;

  const g2 = await pool.query(
    `INSERT INTO groups (name, code, owner_id) VALUES ($1, $2, $3) RETURNING id`,
    ['Grupo Integração 2', 'TST002', userId],
  );
  group2Id = g2.rows[0].id;

  await pool.query(
    `INSERT INTO group_subscriptions (group_id, plan_id, status, trial_ends_at, monthly_amount)
     VALUES ($1, 1, 'active', NOW() + interval '1 year', 30)`,
    [group2Id],
  );
  await pool.query(
    `INSERT INTO users_groups (user_id, group_id) VALUES ($1, $2)`,
    [userId, group2Id],
  );

  const n2 = await pool.query(
    `INSERT INTO notifications (name, description, month, day, timezone, scheduled_at, group_id, created_by)
     VALUES ($1, $2, $3, $4, 'UTC', NOW(), $5, $6) RETURNING id`,
    ['Notif Grupo 2', 'Descrição 2', TODAY_MONTH, TODAY_DAY, group2Id, userId],
  );
  notif2Id = n2.rows[0].id;
});

afterAll(async () => {
  if (!pool) return;
  await cleanup();
  await pool.end();
});

describe.skipIf(!process.env.RUN_INTEGRATION)('job — integração', () => {
  it('envia notificações para ambos os grupos e registra logs', async () => {
    const state = createState();
    const provider = new FCMProvider();

    await runJob(provider, state, true);

    // pode haver notificações de seeds sem token; verificamos só as nossas
    const { rows: logs } = await pool.query(
      `SELECT notification_id, status FROM notification_logs
       WHERE notification_id = ANY($1) ORDER BY notification_id`,
      [[notif1Id, notif2Id]],
    );

    expect(logs).toHaveLength(2);
    expect(logs[0].status).toBe('sent');
    expect(logs[1].status).toBe('sent');

    // FCM chamado ao menos 2 vezes (1 token por grupo nosso)
    expect(vi.mocked(messaging.send)).toHaveBeenCalledWith(
      expect.objectContaining({ token: PUSH_TOKEN }),
    );
    expect(vi.mocked(messaging.send)).toHaveBeenCalledTimes(2);
  });

  it('idempotência: não reenvia notificação já enviada no mesmo dia', async () => {
    vi.mocked(messaging.send).mockClear();
    const state = createState();
    const provider = new FCMProvider();

    await runJob(provider, state, true);

    // nossas notificações não devem gerar novos logs
    const { rows: logs } = await pool.query(
      `SELECT id FROM notification_logs
       WHERE notification_id = ANY($1) AND status = 'sent'`,
      [[notif1Id, notif2Id]],
    );

    expect(logs).toHaveLength(2); // mesmo 2 de antes, sem duplicatas
    expect(vi.mocked(messaging.send)).not.toHaveBeenCalledWith(
      expect.objectContaining({ token: PUSH_TOKEN }),
    );
  });
});
