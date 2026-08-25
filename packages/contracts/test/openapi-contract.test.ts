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

test('RIDE-002の送迎全routeと状態変更契約をOpenAPIへ公開する', () => {
  const { paths, components } = openapiDocument;
  assert.ok(paths['/ride-plans']?.get);
  assert.ok(paths['/ride-plans']?.post);
  assert.ok(paths['/ride-plans/{planId}']?.get);
  assert.ok(paths['/ride-plans/{planId}']?.patch);
  assert.ok(paths['/ride-plans/{planId}/offers']?.post);
  assert.ok(paths['/ride-plans/{planId}/requests']?.post);
  assert.ok(paths['/ride-plans/{planId}/match']?.post);
  assert.ok(paths['/ride-plans/{planId}/assignments']?.post);
  assert.ok(paths['/ride-plans/{planId}/dispatch']?.get);
  assert.ok(paths['/ride-plans/{planId}/metrics']?.get);
  assert.ok(paths['/ride-plans/{planId}/status']?.post);
  const transition = components.schemas.RidePlanTransitionInput.oneOf[1];
  assert.ok(transition);
  const reasonCode = transition.properties.reasonCode;
  assert.ok(reasonCode);
  assert.deepEqual(reasonCode.enum, [
    'schedule_change',
    'member_change',
    'vehicle_change',
    'other',
  ]);
  assert.deepEqual(
    components.schemas.RideConflictError.properties.error.properties.code.enum,
    [
      'RIDE_STATE_CONFLICT',
      'RIDE_FINALIZE_BLOCKED',
      'RIDE_CAPACITY_EXCEEDED',
      'RIDE_RESULT_TOO_LARGE',
    ],
  );
  assert.equal(
    components.schemas.RideAssignmentInput.additionalProperties,
    false,
  );
  assert.deepEqual(components.schemas.RideAssignmentInput.required, [
    'requestId',
    'offerId',
    'expectedOfferId',
  ]);
});
