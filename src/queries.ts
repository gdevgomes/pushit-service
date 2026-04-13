// Sem condição de MINUTE: o NOT EXISTS (status='sent') garante idempotência para
// envios bem-sucedidos. A ausência do filtro de minuto permite retry automático
// para notificações com status 'failed' dentro do horário 6:xx.
export const NOTIFICATIONS_DUE_FORCED = `
  SELECT n.id, n.name, n.description, n.group_id, n.timezone
  FROM notifications n
  WHERE
    n.month = EXTRACT(MONTH FROM NOW() AT TIME ZONE n.timezone)
    AND n.day = EXTRACT(DAY FROM NOW() AT TIME ZONE n.timezone)
    AND NOT EXISTS (
      SELECT 1 FROM notification_logs nl
      WHERE nl.notification_id = n.id
        AND nl.status = 'sent'
        AND (nl.sent_at AT TIME ZONE n.timezone)::date
            = (NOW() AT TIME ZONE n.timezone)::date
    )
`;

export const NOTIFICATIONS_DUE = `
  SELECT n.id, n.name, n.description, n.group_id, n.timezone
  FROM notifications n
  WHERE
    EXTRACT(HOUR FROM NOW() AT TIME ZONE n.timezone) = 6
    AND n.month = EXTRACT(MONTH FROM NOW() AT TIME ZONE n.timezone)
    AND n.day   = EXTRACT(DAY   FROM NOW() AT TIME ZONE n.timezone)
    AND NOT EXISTS (
      SELECT 1 FROM notification_logs nl
      WHERE nl.notification_id = n.id
        AND nl.status = 'sent'
        AND (nl.sent_at AT TIME ZONE n.timezone)::date
            = (NOW() AT TIME ZONE n.timezone)::date
    )
`;

export const PUSH_TOKENS_FOR_GROUP = `
  SELECT up.push_token
  FROM users_groups ug
  JOIN user_profiles up ON up.user_id = ug.user_id
  WHERE ug.group_id = $1
    AND up.push_token IS NOT NULL
    AND up.push_token <> ''
`;

export const INSERT_NOTIFICATION_LOG = `
  INSERT INTO notification_logs (notification_id, group_id, sent_at, status, error)
  VALUES ($1, $2, NOW(), $3, $4)
`;
