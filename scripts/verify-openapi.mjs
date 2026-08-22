import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openapiDocument } from '../packages/contracts/src/openapi-source.mjs';

// commit済みopenapi.yamlが契約の生成元と一致することを確認し、生成漏れをCIで止める。
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = path.join(root, 'packages', 'contracts', 'openapi.yaml');
const generated = JSON.parse(await readFile(output, 'utf8'));
assert.deepEqual(
  generated,
  openapiDocument,
  'openapi.yamlはZod契約から生成された最新状態である必要があります',
);
assert.equal(generated.openapi, '3.1.0');
console.log('OpenAPI契約の生成物を検証しました。');
