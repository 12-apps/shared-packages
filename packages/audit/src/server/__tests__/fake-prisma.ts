/**
 * A Prisma-SHAPED client for the extension tests (12-14).
 *
 * The two extensions are `$extends({ query: { $allModels } })` wrappers, so what
 * has to be faithful is the COMPOSITION contract: a hook receives
 * `{ model, args, query }`, calling `query(args)` reaches the next layer down,
 * and the extension applied LAST is the outermost one. That is what this
 * implements — and it is all that can be implemented in a unit test, because a
 * real client needs a generated schema.
 *
 * The other half of the proof lives in the consumer harness
 * (`harness/backend/tests/audit-extensions.test.ts`), where the SAME published
 * extensions run over real SQL against PGlite and the stamped columns are read
 * back with SELECT. Neither test alone is enough: this one pins the semantics,
 * that one pins that the semantics reach the database.
 */

export interface RecordedCall {
  model: string;
  operation: string;
  args: Record<string, unknown>;
}

interface HookArgs {
  model: string;
  args: Record<string, unknown>;
  query: (args: Record<string, unknown>) => unknown;
}

type Hook = (args: HookArgs) => unknown;

interface QueryExtension {
  name?: string;
  query: { $allModels: Record<string, Hook> };
}

const OPERATIONS = [
  'create',
  'createMany',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
  'findMany',
] as const;

export interface FakePrisma {
  /** Every call that reached the base client, in order. */
  calls: RecordedCall[];
  [model: string]: unknown;
}

/** Build a client whose delegates record what reached the "database". */
export function fakePrismaClient(models: readonly string[]): FakePrisma {
  const calls: RecordedCall[] = [];
  const client: Record<string, unknown> = { calls };
  const base = (model: string, operation: string) => (args: Record<string, unknown>) => {
    calls.push({ model, operation, args });
    return Promise.resolve({ model, operation });
  };
  for (const model of models) {
    // Prisma's delegate key is the model name with a lowercase first letter.
    const key = model.charAt(0).toLowerCase() + model.slice(1);
    client[key] = Object.fromEntries(
      OPERATIONS.map((operation) => [operation, base(model, operation)]),
    );
  }
  client.$extends = function extend(extension: unknown): unknown {
    return applyExtension(client as FakePrisma, models, extension as QueryExtension);
  };
  return client as FakePrisma;
}

/**
 * Wrap every delegate operation the extension declares a hook for, leaving the
 * rest as they are — Prisma's own behaviour, and the reason a hook must call
 * `query(args)` rather than returning a value of its own.
 */
function applyExtension(
  client: FakePrisma,
  models: readonly string[],
  extension: QueryExtension,
): FakePrisma {
  const hooks = extension.query.$allModels;
  const next: Record<string, unknown> = { calls: client.calls };
  for (const model of models) {
    const key = model.charAt(0).toLowerCase() + model.slice(1);
    const delegate = client[key] as Record<string, (args: Record<string, unknown>) => unknown>;
    next[key] = Object.fromEntries(
      Object.entries(delegate).map(([operation, inner]) => {
        const hook = hooks[operation];
        if (!hook) return [operation, inner];
        return [operation, (args: Record<string, unknown>) => hook({ model, args, query: inner })];
      }),
    );
  }
  next.$extends = (nested: unknown): unknown =>
    applyExtension(next as FakePrisma, models, nested as QueryExtension);
  return next as FakePrisma;
}

/** One model's delegate, typed for the assertions. */
type Operation = (typeof OPERATIONS)[number];

/** A mapped type, not an index signature: every operation is present, so a case
 *  can call one without a `?.` that would hide a delegate the fake forgot. */
type FakeDelegate = {
  [K in Operation]: (args: Record<string, unknown>) => Promise<unknown>;
};

export function delegate(client: FakePrisma, model: string): FakeDelegate {
  const key = model.charAt(0).toLowerCase() + model.slice(1);
  return client[key] as FakeDelegate;
}
