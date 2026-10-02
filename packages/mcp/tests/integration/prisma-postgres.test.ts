import assert from 'node:assert/strict';
import test from 'node:test';
import { disconnectAiHost, isRefreshBindingActive } from '../../dist/oauth/index.js';
import { AT, OWNER, ROOT, assertRetry, child, fixture, report, waitForLock } from './postgres-fixture.ts';

const options = { timeout: 30_000, concurrency: false };
const disconnect = (actor) => disconnectAiHost(actor.stores, OWNER, 'claude');
const binding = {
  refreshTokenHash: ROOT.tokenHash, clientId: ROOT.clientId,
  email: ROOT.userEmail, subject: ROOT.userSub,
};

test('concurrent rotations create one successor and retry the losing claim', options, async (t) => {
  const db = await fixture(t);
  const held = db.hold();
  const first = db.actor('fut211-rotation-a', { 'token.updateMany': held.pause });
  const second = db.actor('fut211-rotation-b');
  const winner = first.stores.refreshTokens.rotate(child('child-a'), ROOT.tokenHash, AT);
  await held.reached;
  const loser = second.stores.refreshTokens.rotate(child('child-b'), ROOT.tokenHash, AT);
  await waitForLock(db.pool, 'fut211-rotation-b');
  held.release();
  assert.deepEqual(await Promise.all([winner, loser]), [true, false]);
  assertRetry(second.record);
  const rows = await db.control.oAuthRefreshToken.findMany();
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((row) => row.rotatedFrom === ROOT.tokenHash).length, 1);
  assert.equal(rows.find((row) => row.tokenHash === ROOT.tokenHash).graceSeal, null);
  assert.equal(await isRefreshBindingActive(first.stores.refreshTokens, binding), true);
  report(t, first, second);
});

test('disconnect racing rotation revokes the committed successor and connection', options, async (t) => {
  const db = await fixture(t);
  const held = db.hold();
  const rotation = db.actor('fut211-disconnect-rotation', { 'token.updateMany': held.pause });
  const revoke = db.actor('fut211-disconnect');
  const rotating = rotation.stores.refreshTokens.rotate(child('disconnect-child'), ROOT.tokenHash, AT);
  await held.reached;
  const revoking = disconnect(revoke);
  await waitForLock(db.pool, 'fut211-disconnect');
  held.release();
  assert.equal(await rotating, true);
  assert.equal((await revoking).revokedRefreshTokens, 1);
  assertRetry(revoke.record);
  assert.equal(await db.control.oAuthRefreshToken.count({ where: { revokedAt: null } }), 0);
  assert.equal(await db.control.mcpConnection.count({ where: { revokedAt: null } }), 0);
  assert.equal(await isRefreshBindingActive(revoke.stores.refreshTokens, binding), false);
  report(t, rotation, revoke);
});

test('replay retries its lineage snapshot after rotation without revoking another root', options, async (t) => {
  const db = await fixture(t);
  const held = db.hold();
  await db.control.oAuthRefreshToken.create({ data: { ...ROOT, tokenHash: 'unrelated-root' } });
  const replay = db.actor('fut211-replay', { 'token.findMany': held.pause });
  const rotation = db.actor('fut211-replay-rotation');
  const revoking = replay.stores.refreshTokens.revokeLineage(
    { userEmail: ROOT.userEmail, clientId: ROOT.clientId }, ROOT.tokenHash, AT,
  );
  await held.reached;
  assert.equal(await rotation.stores.refreshTokens.rotate(child('replay-child'), ROOT.tokenHash, AT), true);
  held.release();
  await revoking;
  assertRetry(replay.record);
  const live = await db.control.oAuthRefreshToken.findMany({ where: { revokedAt: null } });
  assert.deepEqual(live.map((row) => row.tokenHash), ['unrelated-root']);
  assert.equal(await isRefreshBindingActive(replay.stores.refreshTokens, binding), false);
  report(t, replay, rotation);
});

test('delayed grant recording cannot revive a completed disconnect', options, async (t) => {
  const db = await fixture(t);
  const held = db.hold();
  const activity = db.actor('fut211-activity', { 'token.findUnique': held.pause });
  const revoke = db.actor('fut211-activity-disconnect');
  const recording = activity.stores.connections.recordActivity({
    userId: OWNER.userId, oauthClientId: ROOT.clientId, clientName: 'Synthetic client',
    host: 'claude', at: AT, refreshTokenHash: ROOT.tokenHash,
  });
  await held.reached;
  assert.equal((await disconnect(revoke)).revokedRefreshTokens, 1);
  held.release();
  await recording;
  assertRetry(activity.record);
  assert.equal(await db.control.mcpConnection.count({ where: { revokedAt: null } }), 0);
  assert.equal(await isRefreshBindingActive(activity.stores.refreshTokens, binding), false);
  report(t, activity, revoke);
});
