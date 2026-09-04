import assert from 'node:assert/strict';
import test from 'node:test';
import { attendanceUpsertSchema } from '../src/event-contract.ts';
import { orderEntryCreateSchema } from '../src/orders-contract.ts';
import { rideRequestCreateSchema } from '../src/ride-contract.ts';

const subjectMemberId = '00000000-0000-7000-8000-000000000001';

test('対象memberはsubjectMemberIdを正本として3機能で受け付ける', () => {
  assert.equal(
    attendanceUpsertSchema.parse({
      subjectMemberId,
      response: 'attending',
    }).subjectMemberId,
    subjectMemberId,
  );
  assert.equal(
    orderEntryCreateSchema.parse({
      subjectMemberId,
      ordererName: '保護者',
      lines: [
        {
          productId: '00000000-0000-7000-8000-000000000002',
          quantity: 1,
          selectedOptions: {},
        },
      ],
    }).subjectMemberId,
    subjectMemberId,
  );
  assert.equal(
    rideRequestCreateSchema.parse({ subjectMemberId }).subjectMemberId,
    subjectMemberId,
  );
});

test('対象member IDの未指定・二重指定を拒否する', () => {
  assert.equal(
    attendanceUpsertSchema.safeParse({ response: 'pending' }).success,
    false,
  );
  assert.equal(
    attendanceUpsertSchema.safeParse({
      memberId: subjectMemberId,
      subjectMemberId,
      response: 'pending',
    }).success,
    false,
  );
  assert.equal(
    rideRequestCreateSchema.safeParse({
      memberId: subjectMemberId,
      subjectMemberId,
    }).success,
    false,
  );
});
