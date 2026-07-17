/**
 * Pure forms primitives barrel.
 *
 * Re-exports the field validators, the `Result<T>` type with its `ok`/`err`
 * constructors, and the `createServerAction` wrapper. This module is
 * client-bundle safe: it imports zero `pg`/`prisma`/`aws` code.
 *
 * @module shared-helpers/forms
 */
export * from './validators';
export * from './result';
export * from './serverAction';
