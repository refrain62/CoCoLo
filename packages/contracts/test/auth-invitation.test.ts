import assert from 'node:assert/strict';
import test from 'node:test';
import {
  invitationAcceptSchema,
  invitationCreateResponseSchema,
  invitationCreateSchema,
} from '../src/auth-invitation.ts';

test('招待作成はguardian対象と期限上限を固定する', () => {
  const parsed = invitationCreateSchema.parse({
    memberId: '00000000-0000-7000-8000-000000000001',
    role: 'guardian',
    linkType: 'guardian',
    relationship: '保護者',
  });
  assert.equal(parsed.expiresInHours, 72);
  assert.equal(
    invitationCreateSchema.safeParse({
      memberId: '00000000-0000-7000-8000-000000000001',
      role: 'staff',
      linkType: 'self',
      relationship: '保護者',
    }).success,
    false,
  );
  assert.equal(
    invitationCreateSchema.safeParse({
      memberId: '00000000-0000-7000-8000-000000000001',
      role: 'guardian',
      linkType: 'self',
      relationship: '本人',
    }).success,
    true,
  );
});

test('招待受諾はproviderとopaque tokenだけを入力にする', () => {
  assert.equal(
    invitationAcceptSchema.safeParse({
      token: 'a'.repeat(64),
      provider: 'google',
    }).success,
    true,
  );
  assert.equal(
    invitationAcceptSchema.safeParse({
      token: 'a'.repeat(64),
      provider: 'google',
      providerSubject: 'untrusted-subject',
    }).success,
    false,
  );
});

test('招待作成responseはraw tokenを返さずfragment付きURLだけを返す', () => {
  const parsed = invitationCreateResponseSchema.safeParse({
    data: {
      id: '00000000-0000-7000-8000-000000000001',
      memberId: '00000000-0000-7000-8000-000000000002',
      role: 'guardian',
      linkType: 'guardian',
      relationship: '保護者',
      inviteUrl:
        'https://app.example.test/invite/00000000-0000-7000-8000-000000000001#token=opaque-token',
      expiresAt: '2026-08-25T00:00:00.000Z',
    },
  });
  assert.equal(parsed.success, true);
  assert.equal(
    invitationCreateResponseSchema.safeParse({
      data: {
        id: '00000000-0000-7000-8000-000000000001',
        memberId: '00000000-0000-7000-8000-000000000002',
        role: 'guardian',
        linkType: 'guardian',
        relationship: '保護者',
        token: 'a'.repeat(64),
        expiresAt: '2026-08-25T00:00:00.000Z',
      },
    }).success,
    false,
  );
});
