import assert from 'node:assert/strict';
import test from 'node:test';
import {
  rideOfferCreateSchema,
  ridePlanCreateSchema,
  ridePlanTransitionSchema,
  rideRequestCreateSchema,
} from '../src/ride-contract.ts';

test('送迎入力は容量、日時、Google Maps URLの基本形式を検証する', () => {
  const plan = ridePlanCreateSchema.parse({
    title: '練習試合',
    departureAt: '2026-08-23T08:00:00+09:00',
    destinationMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Tokyo',
  });
  assert.equal(plan.title, '練習試合');
  assert.deepEqual(
    rideOfferCreateSchema.parse({
      capacity: 4,
      driverDisplayName: ' 山田 太郎 ',
    }),
    { capacity: 4, driverDisplayName: '山田 太郎' },
  );
  assert.deepEqual(
    rideRequestCreateSchema.parse({
      memberId: '00000000-0000-7000-8000-000000000001',
    }),
    {
      memberId: '00000000-0000-7000-8000-000000000001',
      passengerCount: 1,
    },
  );
});

test('送迎入力は定員超過、未知フィールド、非URLを拒否する', () => {
  assert.throws(() => rideOfferCreateSchema.parse({ capacity: 21 }));
  assert.throws(() =>
    rideOfferCreateSchema.parse({ capacity: 4, driverDisplayName: ' ' }),
  );
  assert.throws(() =>
    ridePlanCreateSchema.parse({
      title: '練習試合',
      departureAt: '2026-08-23T08:00:00+09:00',
      unknown: true,
    }),
  );
  assert.throws(() =>
    ridePlanCreateSchema.parse({
      title: '練習試合',
      departureAt: '2026-08-23T08:00:00+09:00',
      pickupMapsUrl: 'javascript:alert(1)',
    }),
  );
});

test('送迎予定の状態変更は再編集時だけ理由を必須にする', () => {
  assert.deepEqual(ridePlanTransitionSchema.parse({ action: 'close' }), {
    action: 'close',
  });
  assert.deepEqual(
    ridePlanTransitionSchema.parse({
      action: 'reopen',
      reasonCode: 'member_change',
    }),
    { action: 'reopen', reasonCode: 'member_change' },
  );
  assert.throws(() => ridePlanTransitionSchema.parse({ action: 'reopen' }));
  assert.throws(() =>
    ridePlanTransitionSchema.parse({ action: 'close', reasonCode: 'other' }),
  );
});
