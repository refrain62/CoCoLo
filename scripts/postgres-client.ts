import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type PrismaClientLike = Readonly<{
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>;
  $queryRawUnsafe: <T>(query: string, ...values: unknown[]) => Promise<T>;
  $disconnect: () => Promise<void>;
}>;

type PrismaClientConstructor = new (options: {
  datasources: { db: { url: string } };
}) => PrismaClientLike;

export function sanitizePostgresErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(?:postgres(?:ql)?):\/\/[^\s"']+/gi, '[REDACTED_POSTGRES_URL]')
    .replace(/(?:password|passwd|secret)\s*[=:]\s*[^\s,;]+/gi, '$1=[REDACTED]');
}

// DB接続はこの層に集約し、psqlのargvへ接続URL・passwordを渡さない。
export function createPostgresClient(
  databaseUrl: string | undefined,
): PrismaClientLike {
  if (!databaseUrl) throw new Error('PostgreSQL接続URLが必要です。');
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const require = createRequire(
    path.join(root, 'packages', 'db', 'package.json'),
  );
  let PrismaClient: PrismaClientConstructor;
  try {
    ({ PrismaClient } = require('@prisma/client') as {
      PrismaClient: PrismaClientConstructor;
    });
  } catch (error) {
    throw new Error('PostgreSQL接続用のPrisma Clientを読み込めません。', {
      cause: error,
    });
  }
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

export async function withPostgresClient<T>(
  databaseUrl: string | undefined,
  callback: (client: PrismaClientLike) => Promise<T>,
): Promise<T> {
  const client = createPostgresClient(databaseUrl);
  try {
    return await callback(client);
  } catch (error) {
    throw new Error(
      `PostgreSQL処理に失敗しました: ${sanitizePostgresErrorMessage(error)}`,
    );
  } finally {
    await client.$disconnect();
  }
}
