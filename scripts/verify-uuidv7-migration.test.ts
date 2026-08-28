import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildInvalidUuidV7Query,
  isUuidV7Column,
} from './verify-uuidv7-migration.ts';

test('業務IDのUUID列をUUIDv7検査対象にする', () => {
  assert.equal(
    isUuidV7Column({ tableName: 'members', columnName: 'id' }),
    true,
  );
  assert.equal(
    isUuidV7Column({
      tableName: 'line_delivery_outbox',
      columnName: 'provider_retry_key',
    }),
    false,
  );
  assert.equal(
    isUuidV7Column({
      tableName: 'line_delivery_outbox',
      columnName: 'attempt_token',
    }),
    false,
  );
});

test('UUIDv7検査SQLはversion nibble以外を許可しない', () => {
  const query = buildInvalidUuidV7Query({
    tableName: 'audit_logs',
    columnName: 'id',
  });
  assert.match(query, /FROM "audit_logs"/);
  assert.match(query, /"id"::text/);
  assert.match(query, /substring\("id"::text, 15, 1\) <> '7'/);
  assert.match(query, /\(get_byte\(uuid_send\("id"\), 8\) & 192\) <> 128/);
  assert.match(query, /count\(\*\)::integer/);
});

test('識別子へ任意SQLを混入できない', () => {
  assert.throws(
    () =>
      buildInvalidUuidV7Query({
        tableName: 'members; DROP TABLE audit_logs;--',
        columnName: 'id',
      }),
    /PostgreSQL識別子が不正です/,
  );
});
