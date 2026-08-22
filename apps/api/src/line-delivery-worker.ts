import type {
  LineDeliveryItemStatus,
  LineDeliveryProcessor,
} from './line-delivery-scheduler.js';

// release成果物から直接起動され、claim・外部送信・確定を一件ずつ繰り返すworker入口。
export async function runLineDeliveryWorker(input: {
  maxItems: number;
  signal: AbortSignal;
  processOne: LineDeliveryProcessor['processOne'];
}): Promise<'idle' | 'sent' | 'failed' | 'unknown'> {
  if (
    !Number.isInteger(input.maxItems) ||
    input.maxItems < 1 ||
    input.maxItems > 100
  )
    throw new Error('LINE配信workerの件数が不正です。');
  let processed = 0;
  let sent = 0;
  let failed = 0;
  let unknown = 0;
  while (processed < input.maxItems) {
    if (input.signal.aborted)
      throw new Error('LINE配信workerが中断されました。');
    const result: LineDeliveryItemStatus = await input.processOne({
      signal: input.signal,
    });
    if (result === 'idle') break;
    processed += 1;
    if (result === 'sent') sent += 1;
    if (result === 'failed') failed += 1;
    if (result === 'unknown') unknown += 1;
  }
  if (unknown > 0) return 'unknown';
  if (failed > 0) return 'failed';
  if (sent > 0) return 'sent';
  return 'idle';
}
