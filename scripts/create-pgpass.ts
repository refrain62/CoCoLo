import assert from 'node:assert/strict';
import { chmod, writeFile } from 'node:fs/promises';

type Entry = Readonly<{
  url: string;
  password: string;
}>;

function parseUrl(value: string, label: string): URL {
  const url = new URL(value);
  assert.ok(
    url.protocol === 'postgresql:' || url.protocol === 'postgres:',
    `${label}はPostgreSQL URLで指定してください。`,
  );
  assert.ok(url.hostname && url.username, `${label}のhost/roleが必要です。`);
  assert.ok(url.pathname.length > 1, `${label}のDB名が必要です。`);
  return url;
}

function escapePgpass(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll(':', '\\:');
}

function entryLine(entry: Entry): string {
  const url = parseUrl(entry.url, '接続URL');
  assert.ok(entry.password, 'pgpass passwordが空です。');
  return [
    escapePgpass(url.hostname),
    url.port || '5432',
    escapePgpass(decodeURIComponent(url.pathname.slice(1))),
    escapePgpass(decodeURIComponent(url.username)),
    escapePgpass(entry.password),
  ].join(':');
}

function required(name: string): string {
  const value = process.env[name];
  assert.ok(value, `${name}が必要です。`);
  return value;
}

const output = required('PGPASSFILE');
const entries: Entry[] = [
  { url: required('DATABASE_URL'), password: required('DATABASE_PASSWORD') },
  {
    url: required('DIRECT_URL'),
    password: required('DIRECT_DATABASE_PASSWORD'),
  },
  {
    url: required('SHADOW_DATABASE_URL'),
    password: required('SHADOW_DATABASE_PASSWORD'),
  },
];
if (
  process.env.SHADOW_DATABASE_ADMIN_URL &&
  process.env.SHADOW_DATABASE_ADMIN_PASSWORD
) {
  entries.push({
    url: process.env.SHADOW_DATABASE_ADMIN_URL,
    password: process.env.SHADOW_DATABASE_ADMIN_PASSWORD,
  });
}
if (
  process.env.LINE_WEBHOOK_RECEIVER_DATABASE_URL &&
  process.env.LINE_WEBHOOK_RECEIVER_PASSWORD
) {
  entries.push({
    url: process.env.LINE_WEBHOOK_RECEIVER_DATABASE_URL,
    password: process.env.LINE_WEBHOOK_RECEIVER_PASSWORD,
  });
}
const uniqueLines = [...new Set(entries.map(entryLine))];
await writeFile(output, `${uniqueLines.join('\n')}\n`, {
  encoding: 'utf8',
  mode: 0o600,
});
await chmod(output, 0o600);
console.log('PostgreSQL credential fileを0600で作成しました。');
