import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output =
  process.argv[process.argv.indexOf('--release-dir') + 1] ??
  path.join(root, '.release');
const expectedSha =
  process.argv[process.argv.indexOf('--artifact-sha') + 1] ??
  process.env.ARTIFACT_SHA;
assert.ok(
  expectedSha && /^[0-9a-f]{40}$/.test(expectedSha),
  'artifact SHAは40桁の小文字SHA-1で指定してください',
);
const manifest = JSON.parse(
  await readFile(path.join(output, 'release-manifest.json'), 'utf8'),
);
assert.equal(
  manifest.artifactSha,
  expectedSha,
  'manifestのcommit SHAが一致しません',
);
const archive = await readFile(path.join(output, 'release.tar.gz'));
const actualDigest = createHash('sha256').update(archive).digest('hex');
const checksum = (await readFile(path.join(output, 'artifact.sha256'), 'utf8'))
  .trim()
  .split(/\s+/)[0];
assert.equal(actualDigest, checksum, 'release artifactのSHA-256が一致しません');
console.log('release artifactのSHA-256とcommit SHAを検証しました。');
