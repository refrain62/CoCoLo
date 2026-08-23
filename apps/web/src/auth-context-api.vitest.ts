import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthContextApi } from './auth-context-api.js';

const TENANT_ID = '00000000-0000-7000-8000-000000000001';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('認証context API client', () => {
  it('中央APIの所属roleへBearer tokenを渡す', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: { tenantId: TENANT_ID, role: 'owner' } }),
          { status: 200 },
        ),
      );

    await expect(
      createAuthContextApi({
        getAccessToken: () => 'access-token',
        fetcher,
      }).get(),
    ).resolves.toEqual({ tenantId: TENANT_ID, role: 'owner' });
    expect(fetcher).toHaveBeenCalledWith('/api/v1/auth/context', {
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer access-token',
      },
    });
  });

  it('tokenがなければ中央APIへ送信しない', async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      createAuthContextApi({ getAccessToken: () => null, fetcher }).get(),
    ).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
