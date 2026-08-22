import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertCapacity,
  matchRideRequests,
  validateGoogleMapsUrl,
} from '@cocolo/domain/ride';
import { Hono } from 'hono';
import { registerRideRoutes } from '../dist/features/ride-operations/ride-routes.js';
import { createRideService } from '../dist/features/ride-operations/ride-service.js';

const tenantId = '00000000-0000-7000-8000-000000000001';
const memberId = '00000000-0000-7000-8000-000000000002';
const manager = {
  tenantId,
  userId: 'manager-1',
  role: 'admin',
};
const guardian = {
  tenantId,
  userId: 'guardian-1',
  role: 'guardian',
};

function createFakeRepository() {
  const plans = [];
  const offers = [];
  const requests = [];
  const assignments = [];
  const audit = [];
  let sequence = 0;
  const id = () =>
    `00000000-0000-7000-8000-${String(++sequence).padStart(12, '0')}`;
  const now = () => new Date().toISOString();
  function getPlan(actor, planId) {
    const plan = plans.find(
      (candidate) =>
        candidate.id === planId && candidate.tenantId === actor.tenantId,
    );
    if (!plan) {
      const error = new Error('送迎対象が見つかりません。');
      Object.assign(error, { status: 404 });
      throw error;
    }
    return plan;
  }
  function append(actor, action, resourceId, metadata) {
    audit.push({ actorUserId: actor.userId, action, resourceId, metadata });
  }
  function snapshot(actor, planId) {
    const plan = getPlan(actor, planId);
    const managerRole = ['owner', 'admin', 'staff'].includes(actor.role);
    const visibleOffers = offers.filter(
      (offer) =>
        offer.planId === plan.id &&
        (managerRole || offer.driverUserId === actor.userId),
    );
    const visibleRequests = requests.filter(
      (request) =>
        request.planId === plan.id &&
        (managerRole ||
          request.requesterUserId === actor.userId ||
          (actor.role === 'guardian' && request.memberId === memberId)),
    );
    const visibleAssignments = assignments.filter(
      (assignment) =>
        assignment.planId === plan.id &&
        (managerRole ||
          visibleRequests.some(
            (request) => request.id === assignment.requestId,
          ) ||
          visibleOffers.some((offer) => offer.id === assignment.offerId)),
    );
    return {
      plan,
      offers: visibleOffers,
      requests: visibleRequests,
      assignments: visibleAssignments,
    };
  }
  return {
    audit,
    async createPlan(actor, input) {
      const plan = {
        id: id(),
        tenantId: actor.tenantId,
        title: input.title,
        departureAt: new Date(input.departureAt).toISOString(),
        pickupMapsUrl: validateGoogleMapsUrl(input.pickupMapsUrl),
        destinationMapsUrl: validateGoogleMapsUrl(input.destinationMapsUrl),
        status: 'open',
        createdAt: now(),
      };
      plans.push(plan);
      append(actor, 'ride.plan.create', plan.id, { status: plan.status });
      return plan;
    },
    async createOffer(actor, planId, input) {
      const plan = getPlan(actor, planId);
      const offer = {
        id: id(),
        planId: plan.id,
        driverUserId: actor.userId,
        capacity: input.capacity,
        status: 'open',
        createdAt: now(),
      };
      offers.push(offer);
      append(actor, 'ride.offer.create', plan.id, {
        offerId: offer.id,
        capacity: offer.capacity,
      });
      return offer;
    },
    async createRequest(actor, planId, input) {
      const plan = getPlan(actor, planId);
      if (actor.role === 'guardian' && input.memberId !== memberId) {
        const error = new Error('送迎操作の権限がありません。');
        Object.assign(error, { status: 403 });
        throw error;
      }
      const request = {
        id: id(),
        planId: plan.id,
        memberId: input.memberId,
        requesterUserId: actor.userId,
        passengerCount: input.passengerCount,
        status: 'pending',
        createdAt: now(),
      };
      requests.push(request);
      append(actor, 'ride.request.create', plan.id, {
        requestId: request.id,
        passengerCount: request.passengerCount,
      });
      return request;
    },
    async getSnapshot(actor, planId) {
      return snapshot(actor, planId);
    },
    async autoMatch(actor, planId) {
      const current = snapshot(actor, planId);
      const decisions = matchRideRequests(current);
      const assignedRequestIds = new Set();
      for (const decision of decisions) {
        const request = requests.find((item) => item.id === decision.requestId);
        const assignment = {
          id: id(),
          planId,
          requestId: decision.requestId,
          offerId: decision.offerId,
          passengerCount: decision.passengerCount,
          createdAt: now(),
        };
        assignments.push(assignment);
        request.status = 'assigned';
        assignedRequestIds.add(request.id);
      }
      const unassignedRequestIds = current.requests
        .filter(
          (request) =>
            (request.status === 'pending' || request.status === 'unassigned') &&
            !assignedRequestIds.has(request.id),
        )
        .map((request) => request.id);
      for (const requestId of unassignedRequestIds)
        requests.find((request) => request.id === requestId).status =
          'unassigned';
      append(actor, 'ride.match.execute', planId, {
        assignedRequestCount: decisions.length,
        unassignedRequestCount: unassignedRequestIds.length,
      });
      return {
        assignments: assignments.filter((item) =>
          decisions.some((decision) => decision.requestId === item.requestId),
        ),
        unassignedRequestIds,
      };
    },
    async assign(actor, planId, input) {
      const plan = getPlan(actor, planId);
      const request = requests.find((item) => item.id === input.requestId);
      const offer = offers.find((item) => item.id === input.offerId);
      const assignedSeats = assignments
        .filter(
          (item) =>
            item.offerId === input.offerId &&
            item.requestId !== input.requestId,
        )
        .reduce((sum, item) => sum + item.passengerCount, 0);
      assertCapacity({
        capacity: offer.capacity,
        assignedSeats,
        requestedSeats: request.passengerCount,
      });
      const assignment = {
        id: id(),
        planId: plan.id,
        requestId: request.id,
        offerId: offer.id,
        passengerCount: request.passengerCount,
        createdAt: now(),
      };
      assignments.push(assignment);
      request.status = 'assigned';
      append(actor, 'ride.assignment.update', plan.id, {
        requestId: request.id,
        offerId: offer.id,
      });
      return assignment;
    },
  };
}

function createTestApp(auth, repository = createFakeRepository()) {
  const app = new Hono();
  registerRideRoutes(app, {
    service: createRideService(repository),
    getAuth: () => auth,
  });
  return { app, repository };
}

async function request(app, path, init) {
  return app.request(path, init);
}

test('未認証の送迎APIは401を返す', async () => {
  const app = new Hono();
  registerRideRoutes(app, {
    service: createRideService(createFakeRepository()),
    getAuth: () => null,
  });
  const response = await request(app, `/api/v1/ride-plans/${memberId}`);
  assert.equal(response.status, 401);
});

test('guardianは予定作成を拒否され、Maps以外のURLも保存できない', async () => {
  const guardianApp = createTestApp(guardian).app;
  const forbidden = await request(guardianApp, '/api/v1/ride-plans', {
    method: 'POST',
    body: JSON.stringify({
      title: '練習試合',
      departureAt: '2026-08-23T08:00:00+09:00',
    }),
  });
  assert.equal(forbidden.status, 403);

  const managerApp = createTestApp(manager).app;
  const invalidUrl = await request(managerApp, '/api/v1/ride-plans', {
    method: 'POST',
    body: JSON.stringify({
      title: '練習試合',
      departureAt: '2026-08-23T08:00:00+09:00',
      destinationMapsUrl: 'https://example.com/maps',
    }),
  });
  assert.equal(invalidUrl.status, 400);
});

test('guardianは担当部員の希望だけ登録でき、snapshotに他人のuserIdを含めない', async () => {
  const repository = createFakeRepository();
  const { app } = createTestApp(manager, repository);
  const planResponse = await request(app, '/api/v1/ride-plans', {
    method: 'POST',
    body: JSON.stringify({
      title: '練習試合',
      departureAt: '2026-08-23T08:00:00+09:00',
      destinationMapsUrl:
        'https://www.google.com/maps/search/?api=1&query=Tokyo',
    }),
  });
  const plan = (await planResponse.json()).data;
  const guardianApp = createTestApp(guardian, repository).app;
  const requestResponse = await request(
    guardianApp,
    `/api/v1/ride-plans/${plan.id}/requests`,
    {
      method: 'POST',
      body: JSON.stringify({ memberId, passengerCount: 1 }),
    },
  );
  assert.equal(requestResponse.status, 201);
  const snapshotResponse = await request(
    guardianApp,
    `/api/v1/ride-plans/${plan.id}`,
  );
  assert.equal(snapshotResponse.status, 200);
  const body = await snapshotResponse.text();
  assert.equal(body.includes('requesterUserId'), false);
  assert.equal(body.includes('driverUserId'), false);
});

test('管理者は定員超過を未割当として確認し、メトリクスと監査件数を得られる', async () => {
  const { app, repository } = createTestApp(manager);
  const planResponse = await request(app, '/api/v1/ride-plans', {
    method: 'POST',
    body: JSON.stringify({
      title: '練習試合',
      departureAt: '2026-08-23T08:00:00+09:00',
    }),
  });
  const plan = (await planResponse.json()).data;
  await request(app, `/api/v1/ride-plans/${plan.id}/offers`, {
    method: 'POST',
    body: JSON.stringify({ capacity: 1 }),
  });
  const firstRequest = await request(
    app,
    `/api/v1/ride-plans/${plan.id}/requests`,
    {
      method: 'POST',
      body: JSON.stringify({ memberId, passengerCount: 1 }),
    },
  );
  const secondRequest = await request(
    app,
    `/api/v1/ride-plans/${plan.id}/requests`,
    {
      method: 'POST',
      body: JSON.stringify({
        memberId: '00000000-0000-7000-8000-000000000003',
        passengerCount: 1,
      }),
    },
  );
  assert.equal(firstRequest.status, 201);
  assert.equal(secondRequest.status, 201);
  const matchResponse = await request(
    app,
    `/api/v1/ride-plans/${plan.id}/match`,
    { method: 'POST', body: '{}' },
  );
  assert.equal(matchResponse.status, 200);
  assert.deepEqual(
    (await matchResponse.json()).data.unassignedRequestIds.length,
    1,
  );
  const metricsResponse = await request(
    app,
    `/api/v1/ride-plans/${plan.id}/metrics`,
  );
  assert.deepEqual(await metricsResponse.json(), {
    data: {
      offerCount: 1,
      totalCapacity: 1,
      requestCount: 2,
      requestedSeats: 2,
      assignedSeats: 1,
      unassignedSeats: 1,
      assignmentRate: 0.5,
    },
  });
  assert.equal(repository.audit.length >= 5, true);
  assert.equal(JSON.stringify(repository.audit).includes('member-'), false);
});
