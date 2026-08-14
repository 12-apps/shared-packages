/**
 * The audit-stamp extension: WHICH models it touches, and what it writes.
 *
 * There was no test here at all, which is a large part of why a hard-coded set
 * of one application's model names — `MenuItem`, `InventoryItem`,
 * `ProductCategory`, `Supplier`, `Discount` — survived in a package every host
 * installs. Nothing asserted the list, so nothing objected to it.
 *
 * The cases below are about the GATE rather than the stamping: that a model
 * outside the declared set is left completely alone (the failure that would
 * rewrite a foreign host's writes into columns it does not have), and that the
 * attribution and search-name lists are independent (they coincided only in
 * that one application).
 */
import type { PrismaClient } from '@prisma/client';

import { describe, expect, it } from 'vitest';

import { applyAuditStamps, auditStampConfig, configureAuditStamps } from './audit-extension';
import { runWithActor } from './actor-context';

type QueryArgs = Record<string, unknown>;
interface QueryCtx {
  model: string;
  args: QueryArgs;
  query: (args: QueryArgs) => QueryArgs;
}
type Handlers = Record<string, (ctx: QueryCtx) => QueryArgs>;

/**
 * A client that only records what the extension registered.
 *
 * `$extends` is the entire surface this module uses, so a fake of it exercises
 * the real gating logic without a database, a generated client or a schema —
 * and, importantly, without the extension being able to quietly depend on any
 * model actually existing.
 */
function captureHandlers(config?: Parameters<typeof applyAuditStamps>[1]): Handlers {
  const captured: Handlers = {};
  const fake = {
    $extends: (options: { query: { $allModels: Handlers } }) => {
      Object.assign(captured, options.query.$allModels);
      return {};
    },
  } as unknown as PrismaClient;
  applyAuditStamps(fake, config);
  return captured;
}

/** Run one write through a captured handler and return the args it forwarded. */
function write(handlers: Handlers, op: string, model: string, args: QueryArgs): QueryArgs {
  return handlers[op]({ model, args, query: (forwarded) => forwarded });
}

/** `runWithActor(userId, fn)` — the id is the first argument, not a context object. */
const ACTOR = 'u-1';

describe('applyAuditStamps — the model gate', () => {
  it('leaves a model outside the declared set completely untouched', () => {
    const handlers = captureHandlers({ trackedModels: ['Widget'] });
    const args = runWithActor(ACTOR, () => write(handlers, 'create', 'Sprocket', { data: { name: 'x' } }));
    // Not `createdBy: undefined` — the key must not be introduced at all. An
    // unknown key is what Prisma rejects, and it is the difference between
    // "this host gets no attribution" and "this host cannot write".
    expect(Object.keys(args.data as object)).toEqual(['name']);
  });

  it('stamps nothing at all when the host has declared nothing', () => {
    // The zero-config state. Deliberately inert: guessing a foreign host's
    // model names is the failure this replaces.
    const handlers = captureHandlers({ trackedModels: [] });
    const args = runWithActor(ACTOR, () => write(handlers, 'create', 'Widget', { data: { name: 'x' } }));
    expect(Object.keys(args.data as object)).toEqual(['name']);
  });

  it('stamps a declared model on create, and only the actor columns', () => {
    const handlers = captureHandlers({ trackedModels: ['Widget'] });
    const args = runWithActor(ACTOR, () => write(handlers, 'create', 'Widget', { data: { name: 'x' } }));
    expect(args.data).toEqual({ name: 'x', createdBy: 'u-1', updatedBy: 'u-1' });
  });

  it('stamps only updatedBy on update', () => {
    const handlers = captureHandlers({ trackedModels: ['Widget'] });
    const args = runWithActor(ACTOR, () => write(handlers, 'update', 'Widget', { data: { name: 'x' } }));
    expect(args.data).toEqual({ name: 'x', updatedBy: 'u-1' });
  });

  it('never clobbers an explicit override', () => {
    const handlers = captureHandlers({ trackedModels: ['Widget'] });
    const args = runWithActor(ACTOR, () =>
      write(handlers, 'create', 'Widget', { data: { name: 'x', createdBy: 'system' } }),
    );
    expect((args.data as { createdBy: string }).createdBy).toBe('system');
  });

  it('writes no attribution when there is no actor in scope', () => {
    const handlers = captureHandlers({ trackedModels: ['Widget'] });
    const args = write(handlers, 'create', 'Widget', { data: { name: 'x' } });
    expect(Object.keys(args.data as object)).toEqual(['name']);
  });
});

describe('applyAuditStamps — attribution and search-name are separate lists', () => {
  it('keeps searchName for a model that is NOT attributed', () => {
    // The pair coincided in one application and is not a general fact: a host
    // may want a normalised search column on a model nobody is attributed for.
    const handlers = captureHandlers({ trackedModels: [], searchNameModels: ['Widget'] });
    const args = runWithActor(ACTOR, () => write(handlers, 'create', 'Widget', { data: { name: 'Café' } }));
    expect(args.data).toEqual({ name: 'Café', searchName: 'cafe' });
  });

  it('attributes a model without inventing a searchName for it', () => {
    const handlers = captureHandlers({ trackedModels: ['Widget'] });
    const args = runWithActor(ACTOR, () => write(handlers, 'create', 'Widget', { data: { name: 'Café' } }));
    expect(args.data).not.toHaveProperty('searchName');
  });

  it('applies both when a model is in both lists', () => {
    const handlers = captureHandlers({ trackedModels: ['Widget'], searchNameModels: ['Widget'] });
    const args = runWithActor(ACTOR, () => write(handlers, 'create', 'Widget', { data: { name: 'Café' } }));
    expect(args.data).toEqual({
      name: 'Café',
      searchName: 'cafe',
      createdBy: 'u-1',
      updatedBy: 'u-1',
    });
  });
});

describe('applyAuditStamps — every write shape is gated the same way', () => {
  const handlers = () => captureHandlers({ trackedModels: ['Widget'] });

  it('createMany stamps each row', () => {
    const args = runWithActor(ACTOR, () =>
      write(handlers(), 'createMany', 'Widget', { data: [{ name: 'a' }, { name: 'b' }] }),
    );
    expect(args.data).toEqual([
      { name: 'a', createdBy: 'u-1', updatedBy: 'u-1' },
      { name: 'b', createdBy: 'u-1', updatedBy: 'u-1' },
    ]);
  });

  it('updateMany stamps updatedBy', () => {
    const args = runWithActor(ACTOR, () => write(handlers(), 'updateMany', 'Widget', { data: { name: 'a' } }));
    expect(args.data).toEqual({ name: 'a', updatedBy: 'u-1' });
  });

  it('upsert stamps the create and update halves differently', () => {
    const args = runWithActor(ACTOR, () =>
      write(handlers(), 'upsert', 'Widget', { create: { name: 'a' }, update: { name: 'b' } }),
    );
    expect(args.create).toEqual({ name: 'a', createdBy: 'u-1', updatedBy: 'u-1' });
    expect(args.update).toEqual({ name: 'b', updatedBy: 'u-1' });
  });

  it('leaves an undeclared model alone on every shape', () => {
    const h = handlers();
    const created = runWithActor(ACTOR, () => write(h, 'createMany', 'Other', { data: [{ name: 'a' }] }));
    const upserted = runWithActor(ACTOR, () =>
      write(h, 'upsert', 'Other', { create: { name: 'a' }, update: { name: 'b' } }),
    );
    expect(created.data).toEqual([{ name: 'a' }]);
    expect(upserted.create).toEqual({ name: 'a' });
    expect(upserted.update).toEqual({ name: 'b' });
  });
});

describe('configureAuditStamps — the host declaration', () => {
  it('ships no model catalog of its own', () => {
    // The property that regressed: this package must arrive knowing nothing
    // about anybody's schema.
    const fresh = auditStampConfig();
    expect(fresh.trackedModels).toEqual([]);
    expect(fresh.searchNameModels ?? []).toEqual([]);
  });

  it('is what an unparameterised applyAuditStamps reads', () => {
    configureAuditStamps({ trackedModels: ['Declared'] });
    try {
      const args = runWithActor(ACTOR, () =>
        write(captureHandlers(), 'create', 'Declared', { data: { name: 'x' } }),
      );
      expect(args.data).toEqual({ name: 'x', createdBy: 'u-1', updatedBy: 'u-1' });
    } finally {
      // Restore, so this case cannot decide the outcome of the one above it
      // depending on file order.
      configureAuditStamps({ trackedModels: [] });
    }
  });
});
