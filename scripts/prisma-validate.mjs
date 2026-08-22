import { spawnSync } from 'node:child_process';

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
  },
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
