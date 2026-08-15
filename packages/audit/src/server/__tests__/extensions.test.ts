/* eslint-disable test-flakiness/no-database-operations --
   `updateMany`/`deleteMany` are exactly what these cases CALL: the point is that
   the append-only guard throws before any of them reaches a database, and the
   client under them is the Prisma-shaped fake in `fake-prisma.ts`. */
import { describe, expect, it } from 'vitest';

import { runWithActor } from '../actor-context';
import { AppendOnlyViolationError, applyAppendOnlyGuard } from '../append-only-extension';
import { applyAuditStamps } from '../audit-extension';

import { delegate, fakePrismaClient, type FakePrisma } from './fake-prisma';

/**
 * The two Prisma extensions (12-14) — the `created_by`/`updated_by` stamp and the
 * append-only guard, ported from the origin host's `packages/prisma/src/*-extension.ts`
 * with the tracked-model set turned into config.
 *
 * These cases pin the SEMANTICS against a Prisma-shaped fake; the harness runs the
 * published extensions over real SQL and reads the columns back.
 */
const MODELS = ['MenuItem', 'Supplier', 'AuditLog', 'Order'];

const stamped = (client: FakePrisma): FakePrisma =>
  applyAuditStamps(client, { trackedModels: ['MenuItem', 'Supplier'] });

describe('created_by / updated_by stamping', () => {
  it('fills both columns on a create, from the actor context', async () => {
    const client = stamped(fakePrismaClient(MODELS));

    await runWithActor('user-7', () =>
      delegate(client, 'MenuItem').create({ data: { name: 'Chopp' } }),
    );

    expect(client.calls[0]).toMatchObject({
      model: 'MenuItem',
      operation: 'create',
      args: { data: { name: 'Chopp', createdBy: 'user-7', updatedBy: 'user-7' } },
    });
  });

  it('fills only updated_by on an update', async () => {
    const client = stamped(fakePrismaClient(MODELS));

    await runWithActor('user-7', () =>
      delegate(client, 'MenuItem').update({ where: { id: 'm1' }, data: { name: 'Chopp' } }),
    );

    expect(client.calls[0]?.args.data).toEqual({ name: 'Chopp', updatedBy: 'user-7' });
  });

  it('never clobbers a value the caller set explicitly', async () => {
    const client = stamped(fakePrismaClient(MODELS));

    await runWithActor('user-7', () =>
      delegate(client, 'MenuItem').create({ data: { name: 'Chopp', createdBy: 'importer' } }),
    );

    expect(client.calls[0]?.args.data).toEqual({
      name: 'Chopp',
      createdBy: 'importer',
      updatedBy: 'user-7',
    });
  });

  it('leaves a write with NO actor in scope untouched — the columns stay NULL', async () => {
    // System, seed and unauthenticated writes. Stamping them with a guessed id is
    // worse than leaving the column empty.
    const client = stamped(fakePrismaClient(MODELS));

    await delegate(client, 'MenuItem').create({ data: { name: 'Chopp' } });

    expect(client.calls[0]?.args.data).toEqual({ name: 'Chopp' });
  });

  it('leaves an UNTRACKED model untouched even with an actor', async () => {
    const client = stamped(fakePrismaClient(MODELS));

    await runWithActor('user-7', () =>
      delegate(client, 'Order').create({ data: { total: 100 } }),
    );

    expect(client.calls[0]?.args.data).toEqual({ total: 100 });
  });

  it('stamps every row of a createMany, and both branches of an upsert', async () => {
    const client = stamped(fakePrismaClient(MODELS));

    await runWithActor('user-7', async () => {
      await delegate(client, 'Supplier').createMany({ data: [{ name: 'A' }, { name: 'B' }] });
      await delegate(client, 'Supplier').upsert({
        where: { id: 's1' },
        create: { name: 'C' },
        update: { name: 'C2' },
      });
    });

    expect(client.calls[0]?.args.data).toEqual([
      { name: 'A', createdBy: 'user-7', updatedBy: 'user-7' },
      { name: 'B', createdBy: 'user-7', updatedBy: 'user-7' },
    ]);
    expect(client.calls[1]?.args).toMatchObject({
      create: { name: 'C', createdBy: 'user-7', updatedBy: 'user-7' },
      update: { name: 'C2', updatedBy: 'user-7' },
    });
  });

  it('honours the column names a host spells differently', async () => {
    const client = applyAuditStamps(fakePrismaClient(MODELS), {
      trackedModels: ['MenuItem'],
      columns: { createdBy: 'authorId', updatedBy: 'editorId' },
    });

    await runWithActor('user-7', () =>
      delegate(client, 'MenuItem').create({ data: { name: 'Chopp' } }),
    );

    expect(client.calls[0]?.args.data).toEqual({
      name: 'Chopp',
      authorId: 'user-7',
      editorId: 'user-7',
    });
  });

  it('runs the derive hook on EVERY tracked write, actor or not', async () => {
    // The seam the origin host needs for its normalized `search_name` column: it has to
    // stay in sync on system and seed writes too, or the column drifts.
    const client = applyAuditStamps(fakePrismaClient(MODELS), {
      trackedModels: ['MenuItem'],
      deriveFields: (_model, data) => {
        if (typeof data.name === 'string') data.searchName = data.name.toLowerCase();
      },
    });

    await delegate(client, 'MenuItem').create({ data: { name: 'Chopp' } });
    await delegate(client, 'Order').create({ data: { name: 'Chopp' } });

    expect(client.calls[0]?.args.data).toEqual({ name: 'Chopp', searchName: 'chopp' });
    expect(client.calls[1]?.args.data).toEqual({ name: 'Chopp' });
  });

  it('passes a create with no data through untouched', async () => {
    const client = stamped(fakePrismaClient(MODELS));

    await runWithActor('user-7', () => delegate(client, 'MenuItem').createMany({}));

    expect(client.calls[0]?.args).toEqual({});
  });
});

describe('append-only guard', () => {
  const guarded = (): FakePrisma =>
    applyAppendOnlyGuard(fakePrismaClient(MODELS), { models: ['AuditLog'] });

  it('refuses every mutating delegate on a guarded model', async () => {
    const client = guarded();
    const auditLog = delegate(client, 'AuditLog');

    for (const [operation, call] of [
      ['update', () => auditLog.update({ where: { id: 'a1' }, data: { action: 'x' } })],
      ['updateMany', () => auditLog.updateMany({ where: {}, data: { action: 'x' } })],
      ['updateManyAndReturn', () => auditLog.updateManyAndReturn({ where: {}, data: {} })],
      ['upsert', () => auditLog.upsert({ where: { id: 'a1' }, create: {}, update: {} })],
      ['delete', () => auditLog.delete({ where: { id: 'a1' } })],
      ['deleteMany', () => auditLog.deleteMany({})],
    ] as const) {
      expect(call, operation).toThrow(AppendOnlyViolationError);
    }
    // Nothing reached the database.
    expect(client.calls).toEqual([]);
  });

  it('lets create and reads through', async () => {
    const client = guarded();

    await delegate(client, 'AuditLog').create({ data: { action: 'order.cancel' } });
    await delegate(client, 'AuditLog').findMany({ where: {} });

    expect(client.calls.map((call) => call.operation)).toEqual(['create', 'findMany']);
  });

  it('leaves every other model alone', async () => {
    const client = guarded();

    await delegate(client, 'Order').delete({ where: { id: 'o1' } });

    expect(client.calls[0]).toMatchObject({ model: 'Order', operation: 'delete' });
  });

  it('names the model and the operation in the error', () => {
    const client = guarded();

    expect(() => delegate(client, 'AuditLog').deleteMany({})).toThrow(
      /AuditLog is append-only: "deleteMany"/,
    );
  });

  it('guards the models a host adds, not only the audit log', async () => {
    const client = applyAppendOnlyGuard(fakePrismaClient(MODELS), {
      models: ['AuditLog', 'Order'],
    });

    expect(() => delegate(client, 'Order').update({ where: {}, data: {} })).toThrow(
      AppendOnlyViolationError,
    );
    await delegate(client, 'MenuItem').update({ where: {}, data: {} });
    expect(client.calls).toHaveLength(1);
  });
});

describe('both extensions on one client', () => {
  it('stamps a tracked write and still refuses an audit mutation', async () => {
    // The order a host applies them in must not matter: the two hook sets are
    // disjoint per model, so composition cannot make one shadow the other.
    const client = applyAppendOnlyGuard(stamped(fakePrismaClient(MODELS)), {
      models: ['AuditLog'],
    });

    await runWithActor('user-7', () =>
      delegate(client, 'MenuItem').create({ data: { name: 'Chopp' } }),
    );
    expect(client.calls[0]?.args.data).toMatchObject({ createdBy: 'user-7' });
    expect(() => delegate(client, 'AuditLog').delete({ where: { id: 'a1' } })).toThrow(
      AppendOnlyViolationError,
    );

    const reversed = stamped(
      applyAppendOnlyGuard(fakePrismaClient(MODELS), { models: ['AuditLog'] }),
    );
    await runWithActor('user-7', () =>
      delegate(reversed, 'MenuItem').create({ data: { name: 'Chopp' } }),
    );
    expect(reversed.calls[0]?.args.data).toMatchObject({ createdBy: 'user-7' });
    expect(() => delegate(reversed, 'AuditLog').delete({ where: { id: 'a1' } })).toThrow(
      AppendOnlyViolationError,
    );
  });
});
