import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { type ScannerName, scannerNames } from './security-scanner-config.ts';

export type ScannerException = {
  id: string;
  tool: ScannerName;
  ruleId: string;
  severity: string;
  owner: string;
  rationale: string;
  mitigation: string;
  issue: string;
  expires: string;
};

type ExceptionFile = {
  schemaVersion: number;
  policy: { criticalMaxDays: number; highMaxDays: number };
  exceptions: ScannerException[];
};

const exceptionIdPattern = /^SEC-[A-Z0-9-]+$/;
const ruleIdPattern = /^[A-Za-z0-9._-]+$/;
const issuePattern = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+$/;

function assertExceptionFile(value: unknown): ExceptionFile {
  assert.ok(
    value && typeof value === 'object',
    'scanner exceptionがobjectではありません。',
  );
  const exceptionFile = value as Partial<ExceptionFile>;
  assert.equal(exceptionFile.schemaVersion, 1);
  assert.deepEqual(exceptionFile.policy, {
    criticalMaxDays: 7,
    highMaxDays: 14,
  });
  assert.ok(Array.isArray(exceptionFile.exceptions));

  const today = new Date().toISOString().slice(0, 10);
  const todayStart = new Date(`${today}T00:00:00.000Z`);
  const ids = new Set<string>();
  for (const exception of exceptionFile.exceptions) {
    assert.ok(
      !ids.has(exception.id),
      `例外IDが重複しています: ${exception.id}`,
    );
    ids.add(exception.id);
    assert.match(exception.id, exceptionIdPattern);
    assert.ok(scannerNames.includes(exception.tool));
    assert.match(exception.ruleId, ruleIdPattern);
    assert.match(exception.severity, /^(CRITICAL|HIGH|MEDIUM|LOW)$/);
    for (const [field, value] of Object.entries(exception))
      if (field !== 'expires')
        assert.ok(typeof value === 'string' && value.trim());
    assert.match(exception.issue, issuePattern);
    assert.match(exception.expires, /^\d{4}-\d{2}-\d{2}$/);
    const expires = new Date(`${exception.expires}T23:59:59.999Z`);
    assert.ok(
      !Number.isNaN(expires.valueOf()),
      `${exception.id}: 失効日が不正です`,
    );
    assert.ok(
      exception.expires >= today,
      `${exception.id}: 期限切れの例外です`,
    );

    const maxDays =
      exception.severity === 'CRITICAL'
        ? exceptionFile.policy.criticalMaxDays
        : exception.severity === 'HIGH'
          ? exceptionFile.policy.highMaxDays
          : undefined;
    if (maxDays !== undefined) {
      const latest = new Date(todayStart);
      latest.setUTCDate(latest.getUTCDate() + maxDays);
      assert.ok(
        expires <=
          new Date(`${latest.toISOString().slice(0, 10)}T23:59:59.999Z`),
        `${exception.id}: ${exception.severity}例外の期限が長すぎます`,
      );
    }
  }
  return exceptionFile as ExceptionFile;
}

export async function readScannerExceptions(
  root: string,
): Promise<readonly ScannerException[]> {
  const content = await readFile(
    path.join(root, '.github/security/scanner-exceptions.json'),
    'utf8',
  );
  return assertExceptionFile(JSON.parse(content)).exceptions;
}

export function isScannerException(
  exceptions: readonly ScannerException[],
  tool: ScannerName,
  ruleId: string,
): boolean {
  return exceptions.some(
    (exception) => exception.tool === tool && exception.ruleId === ruleId,
  );
}
