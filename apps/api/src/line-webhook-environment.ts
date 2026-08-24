import assert from 'node:assert/strict';
import type { AppEnvironment } from './environment-url-policy.js';

type LineWebhookEnvironmentInput = Readonly<{
  appEnv: AppEnvironment;
  databaseUrl: string;
  configuredUrl?: string;
  lineFeatureConfigured: boolean;
}>;

function parsePostgresUrl(value: string, label: string): URL {
  const url = new URL(value);
  assert.ok(
    url.protocol === 'postgresql:' || url.protocol === 'postgres:',
    `${label}はPostgreSQL URLで指定してください。`,
  );
  assert.ok(url.hostname && url.pathname.length > 1, `${label}が不正です。`);
  return url;
}

function targetKey(url: URL): string {
  return `${url.hostname.toLowerCase()}:${url.port || '5432'}${url.pathname}`;
}

// Webhook受信専用接続が通常APIの接続先・role・TLS境界を越えないことを起動時に検証する。
export function resolveLineWebhookReceiverDatabaseUrl(
  input: LineWebhookEnvironmentInput,
): string | undefined {
  const configuredUrl = input.configuredUrl?.trim();
  if (!configuredUrl) {
    if (input.lineFeatureConfigured && input.appEnv !== 'local')
      throw new Error(
        'LINE_WEBHOOK_RECEIVER_DATABASE_URL はstaging / productionで必要です。',
      );
    return undefined;
  }

  const appUrl = parsePostgresUrl(input.databaseUrl, 'DATABASE_URL');
  const receiverUrl = parsePostgresUrl(
    configuredUrl,
    'LINE_WEBHOOK_RECEIVER_DATABASE_URL',
  );
  assert.equal(
    decodeURIComponent(receiverUrl.username),
    'line_webhook_receiver',
    'LINE_WEBHOOK_RECEIVER_DATABASE_URLのroleはline_webhook_receiverに固定してください。',
  );
  assert.equal(
    targetKey(receiverUrl),
    targetKey(appUrl),
    'LINE_WEBHOOK_RECEIVER_DATABASE_URLのhost・port・DB名はDATABASE_URLと一致させてください。',
  );
  if (input.appEnv !== 'local')
    assert.ok(
      ['require', 'verify-ca', 'verify-full'].includes(
        receiverUrl.searchParams.get('sslmode') ?? '',
      ),
      'LINE_WEBHOOK_RECEIVER_DATABASE_URLはTLS接続を必須にしてください。',
    );
  return configuredUrl;
}
