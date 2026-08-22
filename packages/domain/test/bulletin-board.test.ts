import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canPublishAnnouncement,
  canReadAnnouncement,
  canViewUnreadMembers,
} from '../dist/bulletin-board-domain.js';

test('回覧板の権限と状態遷移の判定を固定する', () => {
  assert.equal(canPublishAnnouncement('owner'), true);
  assert.equal(canPublishAnnouncement('admin'), true);
  assert.equal(canPublishAnnouncement('staff'), true);
  assert.equal(canPublishAnnouncement('guardian'), false);
  assert.equal(canReadAnnouncement('published'), true);
  assert.equal(canReadAnnouncement('archived'), false);
  assert.equal(canViewUnreadMembers('owner-a', 'owner-a'), true);
  assert.equal(canViewUnreadMembers('staff-a', 'owner-a'), false);
});
