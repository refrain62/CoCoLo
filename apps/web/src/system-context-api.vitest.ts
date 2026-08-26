import { describe, expect, it, vi } from 'vitest';
import { createSystemContextApi } from './system-context-api.js';

describe('system context API client', () => {
  it('選択中チームを送らずsystem admin contextを取得する', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { systemAdmin: true } }), {
        status: 200,
      }),
    );

    await expect(
      createSystemContextApi({
        getAccessToken: () => 'system-token',
        fetcher,
      }).get(),
    ).resolves.toEqual({ systemAdmin: true });
    expect(fetcher).toHaveBeenCalledWith('/api/v1/system/context', {
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer system-token',
      },
    });
  });
});
