export type NotificationDeepLinkTarget =
  | { kind: 'event'; id: string }
  | { kind: 'bulletin'; id: string };

const uuidv7Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 通知URLはWebアプリ内の2種類の資源だけを許可し、任意の遷移先を受け付けない。
export function parseNotificationDeepLink(
  pathname: string,
): NotificationDeepLinkTarget | null {
  const match = /^\/(events|bulletins)\/([^/]+)$/.exec(pathname);
  const kind = match?.[1];
  const id = match?.[2];
  if (!kind || !id || !uuidv7Pattern.test(id)) return null;
  return kind === 'events' ? { kind: 'event', id } : { kind: 'bulletin', id };
}

export function isNotificationDeepLink(pathname: string) {
  return parseNotificationDeepLink(pathname) !== null;
}
