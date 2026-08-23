/**
 * The pt-BR packs — NAMED constants a host passes by hand, never defaults.
 *
 * The filename is what exempts this file from the copy-portability gate:
 * Portuguese may ship, it may not be silent. Every sentence is VERBATIM what
 * the components used to render, so a host adopting these sees no change on
 * screen — what changes is that the words are chosen in a diff.
 *
 * A BARREL over `./pt-BR.<family>.ts`, one module per component family. It was
 * one file until the port made it 471 lines against this package's own
 * 400-line budget — and the single list of every pack is exactly the file that
 * grows on every port. Each part keeps `pt-BR` in its own FILENAME rather than
 * sitting in a `pt-BR/` folder, because the gate's exemption is a filename
 * rule (`NAMED_PACK` in `scripts/lib/shipped-source.mjs`): a folder would have
 * put seven files full of Portuguese back in scope. Consumers are unaffected —
 * `@12-apps/ui/pt-BR` still resolves here.
 */

export * from './pt-BR.data-display';
export * from './pt-BR.feedback';
export * from './pt-BR.form';
export * from './pt-BR.layout';
export * from './pt-BR.navigation';
export * from './pt-BR.shared';
export * from './pt-BR.utility';
