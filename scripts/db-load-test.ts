import assert from 'node:assert/strict';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import {
  type PrismaClientLike,
  withPostgresClient,
} from './postgres-client.ts';
import { assertTestDatabaseTarget } from './test-database-guard.ts';

export const loadTestDefaults = {
  workers: 50,
  iterationsPerWorker: 20,
  scaleTeams: 1_000,
  maxP95Ms: 1_000,
} as const;

export type LoadTestOptions = {
  workers: number;
  iterationsPerWorker: number;
  scaleTeams: number;
  maxP95Ms: number;
};

export type LoadRequest = {
  sequence: number;
  tenantId: string;
  userId: string;
  role: 'owner';
  eventId: string;
  resource:
    | 'members'
    | 'events'
    | 'attendance-responses'
    | 'announcements'
    | 'memberships';
  offset: number;
};

export type LoadResult = {
  elapsedMs: number;
  rows: number;
  error?: string;
};

const tenantIdForTeam = (team: number) =>
  `00000000-0000-7000-8000-${String(10000 + team).padStart(12, '0')}`;
const eventIdForTeam = (team: number) =>
  `00000000-0000-7000-8000-${String(7000 + team).padStart(12, '0')}`;
const eventIdForScaleTenant = (event: number) =>
  `00000000-0000-7000-8000-${String(7100000 + event).padStart(12, '0')}`;

const quoteLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

function parsePositiveInt(
  name: string,
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  assert(
    Number.isInteger(parsed) && parsed > 0,
    `${name}は正の整数で指定してください。`,
  );
  return parsed;
}

export function loadTestOptions(
  env: NodeJS.ProcessEnv = process.env,
): LoadTestOptions {
  const options = {
    workers: parsePositiveInt(
      'LOAD_TEST_WORKERS',
      env.LOAD_TEST_WORKERS,
      loadTestDefaults.workers,
    ),
    iterationsPerWorker: parsePositiveInt(
      'LOAD_TEST_ITERATIONS',
      env.LOAD_TEST_ITERATIONS,
      loadTestDefaults.iterationsPerWorker,
    ),
    scaleTeams: parsePositiveInt(
      'LOAD_TEST_TEAMS',
      env.LOAD_TEST_TEAMS,
      loadTestDefaults.scaleTeams,
    ),
    maxP95Ms: parsePositiveInt(
      'LOAD_TEST_MAX_P95_MS',
      env.LOAD_TEST_MAX_P95_MS,
      loadTestDefaults.maxP95Ms,
    ),
  };
  assert(
    options.scaleTeams <= 1_000,
    'LOAD_TEST_TEAMSはfixture内の1,000チーム以下で指定してください。',
  );
  return options;
}

export function buildLoadPlan(options: LoadTestOptions): LoadRequest[] {
  const requests: LoadRequest[] = [];
  const total = options.workers * options.iterationsPerWorker;
  for (let sequence = 0; sequence < total; sequence += 1) {
    const usePagerTenant = sequence % 10 === 0;
    const team = usePagerTenant ? 0 : (sequence % options.scaleTeams) + 1;
    const tenantId = usePagerTenant
      ? '00000000-0000-7000-8000-000000000003'
      : tenantIdForTeam(team);
    const userId = usePagerTenant
      ? 'owner-c'
      : `club-${String(team).padStart(3, '0')}-owner`;
    const eventId = usePagerTenant
      ? eventIdForScaleTenant((Math.floor(sequence / 10) % 1001) + 1)
      : eventIdForTeam(team);
    const resources: LoadRequest['resource'][] = [
      'members',
      'events',
      'attendance-responses',
      'announcements',
      'memberships',
    ];
    const resourceIndex = usePagerTenant
      ? Math.floor(sequence / 10) % resources.length
      : sequence % resources.length;
    requests.push({
      sequence,
      tenantId,
      userId,
      role: 'owner',
      eventId,
      resource: resources[resourceIndex] ?? 'members',
      offset: usePagerTenant ? ((sequence / 10) % 20) * 50 : sequence % 3,
    });
  }
  return requests;
}

export function buildLoadQuery(request: LoadRequest): string {
  const session = `
WITH fixture_session AS (
  SELECT set_config('app.tenant_id', ${quoteLiteral(request.tenantId)}, true),
         set_config('app.user_id', ${quoteLiteral(request.userId)}, true),
         set_config('app.role', ${quoteLiteral(request.role)}, true)
)
`;
  const tenant = `${quoteLiteral(request.tenantId)}::uuid`;
  const limit = 50;
  if (request.resource === 'members')
    return `${session}
SELECT id, name, status, count(*) OVER () AS total_count
FROM members, fixture_session
WHERE tenant_id = ${tenant}
ORDER BY name, id
LIMIT ${limit} OFFSET ${request.offset};`;
  if (request.resource === 'events')
    return `${session}
SELECT id, title, event_type, starts_at, count(*) OVER () AS total_count
FROM events, fixture_session
WHERE tenant_id = ${tenant}
ORDER BY starts_at, id
LIMIT ${limit} OFFSET ${request.offset};`;
  if (request.resource === 'attendance-responses')
    return `${session}
SELECT id, event_id, user_id, member_id, response, count(*) OVER () AS total_count
FROM attendance_responses, fixture_session
WHERE tenant_id = ${tenant} AND event_id = ${quoteLiteral(request.eventId)}::uuid
ORDER BY event_id, member_id, id
LIMIT ${limit} OFFSET ${request.offset};`;
  if (request.resource === 'announcements')
    return `${session}
SELECT id, title, status, published_at, count(*) OVER () AS total_count
FROM announcements, fixture_session
WHERE tenant_id = ${tenant}
ORDER BY published_at DESC, id DESC
LIMIT ${limit} OFFSET ${request.offset};`;
  return `${session}
SELECT id, user_id, role, status, count(*) OVER () AS total_count
FROM tenant_memberships, fixture_session
WHERE tenant_id = ${tenant}
ORDER BY user_id, id
LIMIT ${limit} OFFSET ${request.offset};`;
}

export function percentile(
  values: readonly number[],
  percentileValue: number,
): number {
  assert(values.length > 0, 'レイテンシー結果が空です。');
  assert(
    percentileValue >= 0 && percentileValue <= 100,
    'percentileは0から100の範囲です。',
  );
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((percentileValue / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, index)] ?? 0;
}

export function summarizeLoadResults(results: readonly LoadResult[]) {
  const successful = results.filter((result) => !result.error);
  const latencies = successful.map((result) => result.elapsedMs);
  return {
    total: results.length,
    succeeded: successful.length,
    failed: results.length - successful.length,
    rows: results.reduce((sum, result) => sum + result.rows, 0),
    p50Ms: latencies.length ? percentile(latencies, 50) : null,
    p95Ms: latencies.length ? percentile(latencies, 95) : null,
    maxMs: latencies.length ? Math.max(...latencies) : null,
  };
}

export function assertLoadResults(
  results: readonly LoadResult[],
  options: LoadTestOptions,
): ReturnType<typeof summarizeLoadResults> {
  const summary = summarizeLoadResults(results);
  assert.equal(
    summary.failed,
    0,
    `負荷試験で${summary.failed}件のクエリエラーが発生しました。`,
  );
  assert.ok(summary.rows > 0, '負荷試験で1件も行を取得できませんでした。');
  assert.ok(
    summary.p95Ms !== null && summary.p95Ms <= options.maxP95Ms,
    `p95が閾値を超えました: ${summary.p95Ms}ms > ${options.maxP95Ms}ms`,
  );
  return summary;
}

async function executeLoadRequest(
  client: PrismaClientLike,
  request: LoadRequest,
): Promise<LoadResult> {
  const startedAt = performance.now();
  try {
    const rows = await client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(`
SELECT set_config('app.tenant_id', ${quoteLiteral(request.tenantId)}, true),
       set_config('app.user_id', ${quoteLiteral(request.userId)}, true),
       set_config('app.role', ${quoteLiteral(request.role)}, true);
`);
      return transaction.$queryRawUnsafe<unknown[]>(buildLoadQuery(request));
    });
    return { elapsedMs: performance.now() - startedAt, rows: rows.length };
  } catch (error) {
    return {
      elapsedMs: performance.now() - startedAt,
      rows: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runLoadTest(
  client: PrismaClientLike,
  options: LoadTestOptions,
): Promise<ReturnType<typeof summarizeLoadResults>> {
  const plan = buildLoadPlan(options);
  const results = await Promise.all(
    plan.map((request) => executeLoadRequest(client, request)),
  );
  return assertLoadResults(results, options);
}

async function main(): Promise<void> {
  assertTestDatabaseTarget();
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, 'DATABASE_URLが必要です。');
  const options = loadTestOptions();
  const startedAt = performance.now();
  const summary = await withPostgresClient(databaseUrl, (client) =>
    runLoadTest(client, options),
  );
  console.log(
    `DB負荷試験完了: ${JSON.stringify({ ...summary, elapsedMs: performance.now() - startedAt, options })}`,
  );
}

const invokedScript = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';
if (import.meta.url === invokedScript) await main();
