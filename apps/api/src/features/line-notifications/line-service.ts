import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  type LineNotificationInput,
  type LineWebhookBody,
  parseLineConnectInput,
  parseLineNotificationInput,
  parseLineWebhookBody,
} from '@cocolo/contracts/line';
import type {
  EnqueueLineNotificationInput,
  LineNotificationRepository,
} from '@cocolo/db/line';
import {
  buildLineDeepLink,
  buildLineLiffLink,
  canRetryLineNotification,
  type LineNotification,
  retryDelayMs,
} from '@cocolo/domain/line';
import type { LineMessagingAdapter } from './line-adapter.js';
import {
  canEnqueueLineNotification,
  canManageLineConnection,
} from './line-policy.js';

export type LineActor = {
  tenantId: string;
  userId: string;
  role: 'owner' | 'admin' | 'staff' | 'guardian';
};

export type LineNotificationService = {
  status: (actor: LineActor) => Promise<{
    status: 'connected' | 'disconnected';
    groupId: string | null;
  }>;
  connect: (
    actor: LineActor,
    input: unknown,
  ) => Promise<{
    status: 'connected';
    groupId: string;
  }>;
  disconnect: (actor: LineActor) => Promise<void>;
  enqueue: (
    actor: LineActor,
    input: unknown,
  ) => Promise<
    | { status: 'queued'; notification: LineNotification }
    | { status: 'not_connected'; notification: null }
  >;
  retry: (
    actor: LineActor,
    notificationId: string,
  ) => Promise<LineNotification>;
  deliverOne: (now?: Date) => Promise<LineNotification | null>;
  receiveWebhook: (input: {
    rawBody: string;
    signature: string | null;
  }) => Promise<{ accepted: number; duplicates: number; ignored: number }>;
};

export type CreateLineNotificationServiceOptions = {
  repository: LineNotificationRepository;
  adapter: LineMessagingAdapter;
  channelSecret: string;
  webhookDestination: string;
  publicAppUrl: string;
  liffId?: string;
  now?: () => Date;
  maxAttempts?: number;
};

const MAX_WEBHOOK_BYTES = 1024 * 1024;
const MAX_LINE_TEXT_LENGTH = 5000;

function isAllowedDeepLink(
  publicAppUrl: string,
  sourceType: LineNotificationInput['sourceType'],
  sourceId: string,
  deepLink: string,
  liffId?: string,
): boolean {
  try {
    const expected = liffId
      ? buildLineLiffLink(liffId, sourceType, sourceId)
      : buildLineDeepLink(publicAppUrl, sourceType, sourceId);
    return expected === deepLink;
  } catch {
    return false;
  }
}

function verifyLineSignature(
  rawBody: string,
  signature: string | null,
  channelSecret: string,
): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', channelSecret)
    .update(rawBody, 'utf8')
    .digest('base64');
  const actualBytes = Buffer.from(signature, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

function toEnqueueInput(
  actor: LineActor,
  groupId: string,
  input: LineNotificationInput,
): EnqueueLineNotificationInput {
  return {
    tenantId: actor.tenantId,
    groupId,
    createdByUserId: actor.userId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    title: input.title,
    body: input.body,
    deepLink: input.deepLink,
  };
}

function parseWebhook(rawBody: string): LineWebhookBody {
  return parseLineWebhookBody(JSON.parse(rawBody) as unknown);
}

// LINE APIを直接画面へ公開せず、接続状態・キュー・署名検証・再試行を一つの状態境界に集約する。
export function createLineNotificationService({
  repository,
  adapter,
  channelSecret,
  webhookDestination,
  publicAppUrl,
  liffId,
  now = () => new Date(),
  maxAttempts = 5,
}: CreateLineNotificationServiceOptions): LineNotificationService {
  return {
    async status(actor) {
      const connection = await repository.getConnection(actor.tenantId);
      return {
        status: connection?.status ?? 'disconnected',
        groupId: connection?.groupId ?? null,
      };
    },
    async connect(actor, input) {
      if (!canManageLineConnection(actor.role))
        throw new Error('LINE接続を管理する権限がありません。');
      const parsed = parseLineConnectInput(input);
      const connection = await repository.connect({
        tenantId: actor.tenantId,
        groupId: parsed.groupId,
        now: now(),
      });
      return { status: 'connected', groupId: connection.groupId as string };
    },
    async disconnect(actor) {
      if (!canManageLineConnection(actor.role))
        throw new Error('LINE接続を管理する権限がありません。');
      await repository.disconnect({ tenantId: actor.tenantId, now: now() });
    },
    async enqueue(actor, input) {
      if (!canEnqueueLineNotification(actor.role))
        throw new Error('LINE通知を送信する権限がありません。');
      const parsed = parseLineNotificationInput(input);
      if (
        !isAllowedDeepLink(
          publicAppUrl,
          parsed.sourceType,
          parsed.sourceId,
          parsed.deepLink,
          liffId,
        )
      )
        throw new Error('通知リンクはCoCoLoの同一環境だけを指定できます。');
      if (
        `${parsed.title}\n${parsed.body}\n${parsed.deepLink}`.length >
        MAX_LINE_TEXT_LENGTH
      )
        throw new Error('LINE通知本文が長すぎます。');
      const connection = await repository.getConnection(actor.tenantId);
      if (connection?.status !== 'connected' || !connection?.groupId)
        return { status: 'not_connected', notification: null };
      const notification = await repository.enqueue(
        toEnqueueInput(actor, connection.groupId, parsed),
        now(),
      );
      if (!notification) return { status: 'not_connected', notification: null };
      return { status: 'queued', notification };
    },
    async retry(actor, notificationId) {
      if (!canManageLineConnection(actor.role))
        throw new Error('LINE通知を再試行する権限がありません。');
      const notification = await repository.getNotification({
        tenantId: actor.tenantId,
        userId: actor.userId,
        notificationId,
      });
      if (!notification || !canRetryLineNotification(notification, maxAttempts))
        throw new Error('再試行できるLINE通知がありません。');
      return repository.requeue({
        tenantId: actor.tenantId,
        notificationId,
        now: now(),
      });
    },
    async deliverOne(currentTime = now()) {
      const claim = await repository.claimDue({
        now: currentTime,
        maxAttempts,
      });
      if (!claim) return null;
      try {
        const sent = await adapter.send({
          groupId: claim.groupId,
          notification: {
            id: claim.notification.id,
            title: claim.notification.title,
            body: claim.notification.body,
            deepLink: claim.notification.deepLink,
          },
        });
        return repository.markSent({
          tenantId: claim.notification.tenantId,
          notificationId: claim.notification.id,
          providerMessageId: sent.providerMessageId,
          now: currentTime,
        });
      } catch (error) {
        const attempts = claim.notification.attempts;
        const retryAt =
          attempts < maxAttempts
            ? new Date(currentTime.getTime() + retryDelayMs(attempts))
            : null;
        return repository.markFailed({
          tenantId: claim.notification.tenantId,
          notificationId: claim.notification.id,
          error:
            error instanceof Error ? error.message : 'LINE送信に失敗しました。',
          nextRetryAt: retryAt,
          now: currentTime,
        });
      }
    },
    async receiveWebhook({ rawBody, signature }) {
      if (Buffer.byteLength(rawBody, 'utf8') > MAX_WEBHOOK_BYTES)
        throw new Error('LINE webhookの本文が大きすぎます。');
      if (!verifyLineSignature(rawBody, signature, channelSecret))
        throw new Error('LINE webhookの署名が不正です。');
      const body = parseWebhook(rawBody);
      if (body.destination !== webhookDestination)
        throw new Error('LINE webhookの送信先が不正です。');
      let accepted = 0;
      let duplicates = 0;
      let ignored = 0;
      for (const event of body.events) {
        const groupId = event.source.groupId;
        if (!groupId) {
          ignored += 1;
          continue;
        }
        const binding = await repository.findTenantByConnectedGroupId(groupId);
        if (!binding) {
          ignored += 1;
          continue;
        }
        const recorded = await repository.recordWebhookReceipt({
          tenantId: binding.tenantId,
          groupId: binding.groupId,
          webhookEventId: event.webhookEventId,
          receivedAt: now(),
        });
        if (recorded) accepted += 1;
        else duplicates += 1;
      }
      return { accepted, duplicates, ignored };
    },
  };
}

// イベント・締切・回覧の各機能はこの境界へ通知元と同一環境のdeep linkを渡す。
export function buildLineNotificationInput(input: {
  sourceType: 'event' | 'deadline' | 'bulletin';
  sourceId: string;
  title: string;
  body: string;
  publicAppUrl: string;
  liffId?: string;
}) {
  const deepLink = input.liffId
    ? buildLineLiffLink(input.liffId, input.sourceType, input.sourceId)
    : buildLineDeepLink(input.publicAppUrl, input.sourceType, input.sourceId);
  return {
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    title: input.title,
    body: input.body,
    deepLink,
  };
}
