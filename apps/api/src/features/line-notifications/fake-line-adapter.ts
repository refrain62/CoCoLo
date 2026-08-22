import type { LineMessage, LineMessagingAdapter } from './line-adapter.js';

export type FakeLineAdapter = LineMessagingAdapter & {
  readonly sentMessages: readonly LineMessage[];
  failNext: (count?: number) => void;
};

// localでは実LINEへ送信せず、失敗と再試行を決定的に再現する。
export function createFakeLineAdapter(): FakeLineAdapter {
  const sentMessages: LineMessage[] = [];
  let failuresRemaining = 0;
  return {
    get sentMessages() {
      return sentMessages.map((message) => ({
        ...message,
        notification: { ...message.notification },
      }));
    },
    failNext(count = 1) {
      failuresRemaining = Math.max(0, Math.floor(count));
    },
    async send(message) {
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        throw new Error('fake LINE adapter failure');
      }
      sentMessages.push({
        ...message,
        notification: { ...message.notification },
      });
      return { providerMessageId: `fake-${message.notification.id}` };
    },
  };
}
