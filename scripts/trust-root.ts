import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const trustRootRelativePath = '.github/security/trust-root.json';

export type TrustRootRecord = Readonly<{
  schema: 1;
  status: 'manual-owner-bootstrap-required' | 'bootstrapped';
  owner: '@refrain62';
  bootstrap_commit: string | null;
}>;

export function assertTrustRootRecord(value: unknown): TrustRootRecord {
  assert.ok(
    value && typeof value === 'object',
    'trust rootがobjectではありません。',
  );
  const record = value as Partial<TrustRootRecord>;
  assert.equal(record.schema, 1, 'trust rootのschemaが不正です。');
  assert.equal(
    record.owner,
    '@refrain62',
    'trust rootのownerが固定値と一致しません。',
  );
  assert.ok(
    record.status === 'manual-owner-bootstrap-required' ||
      record.status === 'bootstrapped',
    'trust rootのstatusが不正です。',
  );
  if (record.status === 'manual-owner-bootstrap-required') {
    assert.equal(
      record.bootstrap_commit,
      null,
      'bootstrap前のtrust rootにcommitを設定できません。',
    );
  } else {
    assert.ok(
      typeof record.bootstrap_commit === 'string' &&
        /^[0-9a-f]{40}$/.test(record.bootstrap_commit),
      'bootstrapped trust rootにはownerが確定した40桁commitが必要です。',
    );
  }
  return record as TrustRootRecord;
}

export function assertTrustRootReady(record: TrustRootRecord): void {
  assert.equal(
    record.status,
    'bootstrapped',
    'trust root未導入です。ownerによる先行手動bootstrap commitを完了するまで、gate/promotion/deployを停止します。',
  );
}

export async function readTrustRoot(root: string): Promise<TrustRootRecord> {
  let content: string;
  try {
    content = await readFile(path.join(root, trustRootRelativePath), 'utf8');
  } catch {
    throw new Error(
      'trust root未導入です。developへownerの先行手動bootstrap commitを適用するまで、PR自身の変更を信頼しません。',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new Error('trust rootのJSONが不正です。');
  }
  return assertTrustRootRecord(parsed);
}
