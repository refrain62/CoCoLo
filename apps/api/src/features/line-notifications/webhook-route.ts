import { createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import {
  LineContractError,
  parseLineWebhookPayload,
} from '../../../../../packages/contracts/src/line-contract.mjs';

export type LineWebhookTargetType = 'group' | 'official_account';

type LineWebhookBinding = {
  tenantId: string;
  targetType: LineWebhookTargetType;
  targetId: string;
};

export type LineWebhookRepositoryPort = {
  findBindingByTarget: (input: {
    targetType: LineWebhookTargetType;
    targetId: string;
  }) => Promise<LineWebhookBinding | null>;
  claimWebhookEvent: (input: {
    webhookEventId: string;
    tenantId: string;
    targetType: LineWebhookTargetType;
    targetId: string;
    receivedAt?: Date;
  }) => Promise<{ duplicate: boolean; conflict: boolean }>;
};

export type LineWebhookEvent = {
  webhookEventId: string;
  type: string;
  tenantId: string;
  targetType: LineWebhookTargetType;
  targetId: string;
  timestamp: number | null;
};

type LineWebhookPayload = ReturnType<typeof parseLineWebhookPayload>;
type LineWebhookPayloadEvent = LineWebhookPayload['events'][number];

export type LineWebhookProcessor = (
  event: LineWebhookEvent,
) => Promise<void> | void;

export type LineWebhookRouteOptions = {
  channelSecret: string;
  repository: LineWebhookRepositoryPort;
  processEvent?: LineWebhookProcessor;
  path?: string;
  now?: () => Date;
};

function rejectResponse(status: 400 | 401) {
  return Response.json(
    { error: { code: 'LINE_WEBHOOK_REJECTED' } },
    { status },
  );
}

function okResponse() {
  return Response.json({ status: 'ok' });
}

function hmacSignature(channelSecret: string, body: Uint8Array) {
  return createHmac('sha256', channelSecret).update(body).digest();
}

export function verifyLineWebhookSignature(input: {
  channelSecret: string;
  body: Uint8Array;
  signature: string | null;
}): boolean {
  if (!input.channelSecret.trim()) return false;
  const expected = hmacSignature(input.channelSecret, input.body);
  const provided = Buffer.from(input.signature ?? '', 'base64');
  if (provided.length !== expected.length) {
    timingSafeEqual(expected, Buffer.alloc(expected.length));
    return false;
  }
  return timingSafeEqual(expected, provided);
}

async function resolveBinding(input: {
  repository: LineWebhookRepositoryPort;
  payload: LineWebhookPayload;
  event: LineWebhookPayloadEvent;
}): Promise<LineWebhookBinding | null> {
  const groupId =
    input.event.source?.type === 'group' ? input.event.source.groupId : null;
  const groupBinding = groupId
    ? await input.repository.findBindingByTarget({
        targetType: 'group',
        targetId: groupId,
      })
    : null;

  if (groupId && !groupBinding) return null;

  const destinationBinding = input.payload.destination
    ? await input.repository.findBindingByTarget({
        targetType: 'official_account',
        targetId: input.payload.destination,
      })
    : null;

  if (groupBinding && destinationBinding) {
    if (groupBinding.tenantId !== destinationBinding.tenantId) return null;
    return groupBinding;
  }

  return groupBinding ?? destinationBinding;
}

async function processWebhookEvent(input: {
  repository: LineWebhookRepositoryPort;
  payload: LineWebhookPayload;
  event: LineWebhookPayloadEvent;
  processEvent: LineWebhookProcessor;
  now: Date;
}) {
  const binding = await resolveBinding(input);
  if (!binding) return;

  const claim = await input.repository.claimWebhookEvent({
    webhookEventId: input.event.webhookEventId,
    tenantId: binding.tenantId,
    targetType: binding.targetType,
    targetId: binding.targetId,
    receivedAt: input.now,
  });
  if (claim.duplicate || claim.conflict) return;

  await input.processEvent({
    webhookEventId: input.event.webhookEventId,
    type: input.event.type,
    tenantId: binding.tenantId,
    targetType: binding.targetType,
    targetId: binding.targetId,
    timestamp: input.event.timestamp ?? null,
  });
}

// LINE Webhookは署名検証とtenant解決だけを担い、push送信用adapterとは責務を分ける。
export function createLineWebhookRoute(options: LineWebhookRouteOptions) {
  const app = new Hono();
  const path = options.path ?? '/api/v1/line/webhook';
  const getNow = options.now ?? (() => new Date());
  const processEvent = options.processEvent ?? (() => undefined);

  app.post(path, async (c) => {
    const rawBody = new Uint8Array(await c.req.arrayBuffer());
    if (
      !verifyLineWebhookSignature({
        channelSecret: options.channelSecret,
        body: rawBody,
        signature: c.req.header('x-line-signature') ?? null,
      })
    )
      return rejectResponse(401);

    let payload: LineWebhookPayload;
    try {
      payload = parseLineWebhookPayload(
        JSON.parse(Buffer.from(rawBody).toString('utf8')),
      );
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof LineContractError)
        return rejectResponse(400);
      return okResponse();
    }

    for (const event of payload.events) {
      try {
        await processWebhookEvent({
          repository: options.repository,
          payload,
          event,
          processEvent,
          now: getNow(),
        });
      } catch {
        return okResponse();
      }
    }

    return okResponse();
  });

  return app;
}
