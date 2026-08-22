import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openapiDocument } from '../packages/contracts/src/openapi-source.ts';

// 契約の生成元からopenapi.yamlを再生成し、手編集によるAPI仕様のドリフトを防ぐ。
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = path.join(root, 'packages', 'contracts', 'openapi.yaml');
await writeFile(
  output,
  `${JSON.stringify(openapiDocument, null, 2)}\n`,
  'utf8',
);
