/**
 * The words the standalone components render, as REQUIRED host config
 * (FUT-760).
 *
 * `@12-apps/ui` is the package EVERY host renders, so copy compiled in here
 * reached every adopter of every other package too — the same leak as anywhere
 * else, at the widest possible blast radius. Several of these components made
 * it worse by taking the words as OPTIONAL props with pt-BR defaults, which
 * reads as configurable right up until nobody configures it.
 *
 * The DataViews family has its own object (`DataViewsCopy`) threaded through a
 * context, because nineteen files are one mounted surface. These six are
 * mounted independently, so each takes what it renders.
 *
 * This file is a BARREL over `./copy/`, one module per component family. It was
 * one file until the port made it 411 lines against this package's own 400-line
 * budget — and a single list of every family is exactly the file that grows on
 * every port, so the budget would have been the thing that gave way next.
 * Consumers are unaffected: `@12-apps/ui/copy` still resolves here.
 */

export type * from './copy/data-display';
export type * from './copy/feedback';
export type * from './copy/form';
export type * from './copy/layout';
export type * from './copy/navigation';
export type * from './copy/shared';
export type * from './copy/utility';
