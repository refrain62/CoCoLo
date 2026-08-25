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

test('BRD-001の役員・連絡先5 routeと公開項目をOpenAPIへ公開する', () => {
  const { paths, components } = openapiDocument;
  assert.ok(paths['/board-members']?.get);
  assert.ok(paths['/board-members']?.post);
  assert.ok(paths['/board-members/copy-year']?.post);
  const boardContactPath = paths['/board-members/{boardMemberId}'];
  assert.ok(boardContactPath?.patch);
  assert.ok(boardContactPath?.delete);
  const boardContactPatchParameter = boardContactPath.patch.parameters[0];
  assert.ok(boardContactPatchParameter);
  assert.match(boardContactPatchParameter.schema.pattern, /-7/);

  const createSchema = components.schemas.BoardContactCreateInput;
  assert.deepEqual(createSchema.required, [
    'fiscalYear',
    'roleName',
    'roleType',
  ]);
  assert.equal(createSchema.additionalProperties, false);
  assert.equal('tenantId' in createSchema.properties, false);

  const publicItemSchema = components.schemas.BoardContactPublicItem;
  assert.match(publicItemSchema.properties.id.pattern, /-7/);
  assert.equal('phone' in publicItemSchema.properties, false);
  assert.equal(publicItemSchema.properties.fiscalYear.minimum, 2000);
  assert.equal(publicItemSchema.properties.fiscalYear.maximum, 2100);
  const managerItemSchema = components.schemas.BoardContactManagerItem;
  assert.equal(managerItemSchema.properties.phone.type, 'string');
  assert.equal(managerItemSchema.properties.phone.minLength, 7);
  assert.equal('phone' in managerItemSchema.properties, true);
  assert.equal(components.schemas.BoardContactListResponse.anyOf.length, 2);
  assert.equal(
    components.schemas.BoardContactPublicListResponse.properties.fiscalYear
      .type[1],
    'null',
  );
});
