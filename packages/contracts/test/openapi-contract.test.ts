import assert from 'node:assert/strict';
import test from 'node:test';
import { openapiDocument } from '../src/openapi-source.ts';

test('OpenAPIはZod契約のupload上限とREST pathを公開する', () => {
  assert.equal(openapiDocument.openapi, '3.1.0');
  assert.ok(openapiDocument.paths['/uploads']);
  assert.ok(openapiDocument.paths['/uploads/{id}/complete']);
  assert.ok(openapiDocument.paths['/members/promote']);
  const promotionPath = openapiDocument.paths['/members/promote'];
  assert.ok(promotionPath);
  const idempotencyParameter = promotionPath.post.parameters[0];
  assert.ok(idempotencyParameter);
  assert.equal(idempotencyParameter.name, 'Idempotency-Key');
  assert.deepEqual(
    openapiDocument.components.schemas.PromotionRequest.properties.mode.enum,
    ['preview', 'execute'],
  );
  assert.equal(
    openapiDocument.components.schemas.UploadSessionInput.properties.byteSize
      .maximum,
    20 * 1024 * 1024,
  );
});
