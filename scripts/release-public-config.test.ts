import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertPublicBuildConfigMatches,
  createPublicBuildConfig,
} from './release-public-config.ts';

const stagingUrl = 'https://staging-ref.supabase.co';
const productionUrl = 'https://production-ref.supabase.co';
const stagingAnonKey = 'staging-anon-key.jwt';
const productionAnonKey = 'production-anon-key.jwt';

test('公開build設定manifestはSupabase URLとanon keyの生値を記録しない', () => {
  const config = createPublicBuildConfig({
    viteSupabaseUrl: stagingUrl,
    viteSupabaseAnonKey: stagingAnonKey,
  });
  const serialized = JSON.stringify(config);

  assert.equal(config.schemaVersion, 1);
  assert.equal(config.supabaseUrl.identifier, 'staging-ref');
  assert.ok(!serialized.includes(stagingUrl));
  assert.ok(!serialized.includes(stagingAnonKey));
});

test('production許可値がbuild時の公開設定と一致する場合だけ受理する', () => {
  const config = createPublicBuildConfig({
    viteSupabaseUrl: productionUrl,
    viteSupabaseAnonKey: productionAnonKey,
  });

  assert.doesNotThrow(() =>
    assertPublicBuildConfigMatches(config, {
      viteSupabaseUrl: productionUrl,
      viteSupabaseAnonKey: productionAnonKey,
    }),
  );
});

test('staging用Supabase URLを含むartifactはproduction昇格前に拒否する', () => {
  const config = createPublicBuildConfig({
    viteSupabaseUrl: stagingUrl,
    viteSupabaseAnonKey: stagingAnonKey,
  });

  assert.throws(
    () =>
      assertPublicBuildConfigMatches(config, {
        viteSupabaseUrl: productionUrl,
        viteSupabaseAnonKey: stagingAnonKey,
      }),
    /Supabase URL/,
  );
});

test('staging用anon keyを含むartifactはproduction昇格前に拒否する', () => {
  const config = createPublicBuildConfig({
    viteSupabaseUrl: productionUrl,
    viteSupabaseAnonKey: stagingAnonKey,
  });

  assert.throws(
    () =>
      assertPublicBuildConfigMatches(config, {
        viteSupabaseUrl: productionUrl,
        viteSupabaseAnonKey: productionAnonKey,
      }),
    /Supabase anon key/,
  );
});
