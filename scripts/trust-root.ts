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
  assert.ok(value && typeof value === 'object', 'trust rootがobjectではありません。');
  const record = value as Partial<TrustRootRecord>;
  assert.equal(record.schema, 1, 'trust rootのschemaが不正です。');
  assert.equal(record.owner, '@refrain62', 'trust rootのownerが不正です。');
  assert.ok(
    record.status === 'manual-owner-bootstrap-required' ||
      record.status === 'bootstrapped',
    'trust rootのstatusが不正です。',
  );
  if (record.status === 'manual-owner-bootstrap-required')
    assert.equal(record.bootstrap_commit, null, 'bootstrap前のcommitは禁止です。');
  else
    assert.ok(
      typeof record.bootstrap_commit === 'string' &&
        /^[0-9a-f]{40}$/.test(record.bootstrap_commit),
      'bootstrapped rootにはowner確定commitが必要です。',
    );
  return record as TrustRootRecord;
}

export function assertTrustRootReady(record: TrustRootRecord): void {
  assert.equal(
    record.status,
    'bootstrapped',
    'trust root未導入です。ownerの先行bootstrap commitがbaseへ反映されるまで停止します。',
  );
}

export async function readTrustRoot(root: string): Promise<TrustRootRecord> {
  let content: string;
  try {
    content = await readFile(path.join(root, trustRootRelativePath), 'utf8');
  } catch {
    throw new Error(
      'trust root未導入です。PR自身の変更をbase版checkerとして実行しません。',
    );
  }
  try {
    return assertTrustRootRecord(JSON.parse(content) as unknown);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('trust rootのJSONが不正です。');
    throw error;
  }
}
