import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertSchemaDriftClean } from './verify-schema-drift.ts';

test('schema driftなしの固定fixtureを受け入れる', () => {
  assert.doesNotThrow(() =>
    assertSchemaDriftClean({
      status: 0,
      signal: null,
      stdout: '-- This is an empty migration.\n',
      stderr: '',
    }),
  );
});

test('schema driftの悪性fixtureをfail-closedで拒否する', () => {
  assert.throws(() =>
    assertSchemaDriftClean({
      status: 2,
      signal: null,
      stdout: 'ALTER TABLE members ADD COLUMN leaked text;',
      stderr: '',
    }),
  );
  assert.throws(() =>
    assertSchemaDriftClean({
      status: 0,
      signal: null,
      stdout: '',
      stderr: 'warning: ignored drift',
    }),
  );
});
