import { pathToFileURL } from 'node:url';
import { verifyDatabaseSecurity } from './database-security.ts';

// DATABASE_URLの実アプリ接続と、別admin/DIRECT_URL接続の両方を検査し、接続先混同も拒否する。
export { verifyDatabaseSecurity } from './database-security.ts';

async function main(): Promise<void> {
  await verifyDatabaseSecurity();
  console.log(
    '実アプリDBのrole・owner・ACL・RLS・policy・functionを検証しました。',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
