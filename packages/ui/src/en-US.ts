/**
 * The en-US packs — NAMED constants a host passes by hand, never defaults.
 *
 * The filename is what exempts this file from the copy-portability gate,
 * exactly as `pt-BR.ts` beside it is exempt: a language may ship, it may not be
 * silent. `@12-apps/ui` is the package EVERY host renders, so a default
 * compiled in here would reach every adopter of every other package too — which
 * is the leak the copy port closed and the reason a second language arrives as
 * a second named pack rather than as a fallback.
 *
 * A BARREL over `./en-US.<family>.ts`, mirroring the pt-BR side one for one.
 * Each part keeps its tag in its own FILENAME rather than sitting in an
 * `en-US/` folder, because the portability gates' exemption is a filename rule
 * (`lib/locale-tag.mjs`): a folder would have put seven files of copy back in
 * scope. Consumers read `@12-apps/ui/en-US`.
 */

export * from './en-US.data-display';
export * from './en-US.feedback';
export * from './en-US.form';
export * from './en-US.layout';
export * from './en-US.navigation';
export * from './en-US.shared';
export * from './en-US.utility';
