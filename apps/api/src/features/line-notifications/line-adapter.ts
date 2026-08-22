import type { LineNotification } from '@cocolo/domain/line';

export type LineMessage = {
  groupId: string;
  notification: Pick<LineNotification, 'id' | 'title' | 'body' | 'deepLink'>;
};

export type LineMessagingAdapter = {
  send: (message: LineMessage) => Promise<{ providerMessageId: string }>;
};
