/**
 * Pure form primitives barrel.
 *
 * The field validators, the `Result<T>` type with its `ok`/`err` constructors,
 * and the `createServerAction` wrapper + `ActionError`. Zero dependencies — safe
 * to import from a client component, a server action, or a plain node context
 * alike.
 *
 * @module forms-core
 */
export * from './validators';
export * from './result';
export * from './serverAction';
export * from './br';
