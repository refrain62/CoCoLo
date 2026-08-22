import type { LineMessagingAdapter } from './line-adapter.js';

type LineMessagingAdapterOptions = {
  channelAccessToken: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
};

// LINEのアクセストークンをAPI内に閉じ込め、失敗時もproviderの本文や秘密情報を呼び出し側へ返さない。
export function createLineMessagingAdapter({
  channelAccessToken,
  endpoint = 'https://api.line.me/v2/bot/message/push',
  fetchImpl = fetch,
}: LineMessagingAdapterOptions): LineMessagingAdapter {
  return {
    async send({ groupId, notification }) {
      const text = `${notification.title}\n${notification.body}\n${notification.deepLink}`;
      if (text.length > 5000) throw new Error('LINE通知本文が長すぎます。');
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${channelAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: groupId,
          messages: [
            {
              type: 'text',
              text,
            },
          ],
        }),
      });
      if (!response.ok)
        throw new Error('LINEプロバイダーへの送信に失敗しました。');
      return {
        providerMessageId:
          response.headers.get('x-line-request-id') ??
          `line-${notification.id}`,
      };
    },
  };
}
