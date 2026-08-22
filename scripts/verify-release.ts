import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// productionでは再ビルドせず、stagingで検証したmanifest・artifact SHA・checksumだけを受け入れる。
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output =
  process.argv[process.argv.indexOf('--release-dir') + 1] ??
  path.join(root, '.release');
const expectedSha =
  process.argv[process.argv.indexOf('--artifact-sha') + 1] ??
  process.env.ARTIFACT_SHA;
assert.ok(
  expectedSha && /^[0-9a-f]{40}$/.test(expectedSha),
  '成果物の SHA は40桁の小文字 SHA-1 で指定してください。',
);
const manifest = JSON.parse(
  await readFile(path.join(output, 'release-manifest.json'), 'utf8'),
);
assert.ok(
  Array.isArray(manifest.files) &&
    manifest.files.includes('packages/db/prisma/migrations.sha256'),
  '成果物へmigration checksum manifestを同梱してください。',
);
assert.equal(
  manifest.artifactSha,
  expectedSha,
  'マニフェストの commit SHA が一致しません。',
);
const archive = await readFile(path.join(output, 'release.tar.gz'));
const actualDigest = createHash('sha256').update(archive).digest('hex');
const checksum = (await readFile(path.join(output, 'artifact.sha256'), 'utf8'))
  .trim()
  .split(/\s+/)[0];
assert.equal(
  actualDigest,
  checksum,
  'リリース成果物の SHA-256 が一致しません。',
);
console.log('リリース成果物の SHA-256 と commit SHA を検証しました。');
