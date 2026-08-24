import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLineWebhookReceiverDatabaseUrl } from '../dist/line-webhook-environment.js';

const base = {
  appEnv: 'staging' as const,
  databaseUrl: 'postgresql://cocolo_app:secret@db.example.test:5432/cocolo',
  lineFeatureConfigured: true,
};

test('stagingのWebhook receiver URLは専用roleと同一DB・TLSだけを許可する', () => {
  const value = resolveLineWebhookReceiverDatabaseUrl({
    ...base,
    configuredUrl:
      'postgresql://line_webhook_receiver:secret@db.example.test:5432/cocolo?sslmode=require',
  });
  assert.match(value ?? '', /line_webhook_receiver/);
});

test('Webhook receiverのrole・接続先・TLS不一致を拒否する', () => {
  for (const configuredUrl of [
    'postgresql://cocolo_app:secret@db.example.test:5432/cocolo?sslmode=require',
    'postgresql://line_webhook_receiver:secret@other.example.test:5432/cocolo?sslmode=require',
    'postgresql://line_webhook_receiver:secret@db.example.test:5432/cocolo',
  ])
    assert.throws(() =>
      resolveLineWebhookReceiverDatabaseUrl({ ...base, configuredUrl }),
    );
});

test('localではWebhook未設定を許可し、非localでは必須にする', () => {
  assert.equal(
    resolveLineWebhookReceiverDatabaseUrl({
      ...base,
      appEnv: 'local',
      configuredUrl: undefined,
    }),
    undefined,
  );
  assert.throws(() =>
    resolveLineWebhookReceiverDatabaseUrl({
      ...base,
      configuredUrl: undefined,
    }),
  );
});
