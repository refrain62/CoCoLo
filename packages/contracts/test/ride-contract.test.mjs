import assert from 'node:assert/strict';
import test from 'node:test';
import {
  rideOfferCreateSchema,
  ridePlanCreateSchema,
  rideRequestCreateSchema,
} from '../src/ride-contract.mjs';

test('送迎入力は容量、日時、Google Maps URLの基本形式を検証する', () => {
  const plan = ridePlanCreateSchema.parse({
    title: '練習試合',
    departureAt: '2026-08-23T08:00:00+09:00',
    destinationMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Tokyo',
  });
  assert.equal(plan.title, '練習試合');
  assert.equal(rideOfferCreateSchema.parse({ capacity: 4 }).capacity, 4);
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
