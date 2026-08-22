import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openapiDocument } from '../packages/contracts/src/openapi-source.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = path.join(root, 'packages', 'contracts', 'openapi.yaml');
await writeFile(
  output,
  `${JSON.stringify(openapiDocument, null, 2)}\n`,
  'utf8',
);
