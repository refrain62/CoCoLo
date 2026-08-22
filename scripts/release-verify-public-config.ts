import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPublicBuildConfigMatches } from './release-public-config.ts';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const releaseIndex = process.argv.indexOf('--release-dir');
const releaseDir =
  (releaseIndex === -1 ? undefined : process.argv[releaseIndex + 1]) ??
  path.join(root, '.release');
const manifest = JSON.parse(
  await readFile(path.join(releaseDir, 'release-manifest.json'), 'utf8'),
);

assertPublicBuildConfigMatches(manifest.publicBuildConfig, {
  viteSupabaseUrl: process.env.VITE_SUPABASE_URL,
  viteSupabaseAnonKey: process.env.VITE_SUPABASE_ANON_KEY,
});

console.log('artifact の公開build設定が昇格先環境の許可値と一致しました。');
