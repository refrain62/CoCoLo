import { spawnSync } from 'node:child_process';

// 環境変数未設定のlocalでも既定接続先を使ってschemaを検証し、migration URL不備を早期検出する。
const command = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
const result = spawnSync(command, ['validate'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    DATABASE_URL:
      process.env.DATABASE_URL ??
      'postgresql://cocolo_app:cocolo_app@localhost:5432/cocolo_local',
    DIRECT_URL:
      process.env.DIRECT_URL ??
      'postgresql://cocolo_migration:cocolo_migration@localhost:5432/cocolo_local',
    SHADOW_DATABASE_URL:
      process.env.SHADOW_DATABASE_URL ??
      'postgresql://cocolo_shadow:cocolo_shadow@localhost:5432/cocolo_shadow',
  },
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
