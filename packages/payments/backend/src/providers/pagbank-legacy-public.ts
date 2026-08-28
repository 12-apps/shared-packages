/**
 * PagBank's LEGACY post-transaction notifications, everything a host needs
 * (FUT-477, FUT-764) — served at the `./pagbank-legacy-notifications` subpath.
 *
 * A barrel rather than a block on the root index, and the reason is the one
 * `../index.ts` states in as many words: the ROOT entry is value-imported by
 * the frontend package's stories, so a provider module placed there drags
 * `./shared.ts` — and its `node:crypto` import — into a browser bundle and
 * breaks the Storybook build. `pagbank-legacy-resolve` reaches
 * `./pagbank-legacy-notifications`, which reaches `./shared`, so it is exactly
 * such a module and cannot sit on the root.
 *
 * It ships HERE, beside the resolver it binds, rather than at a second subpath
 * of its own: recognizing a parked delivery and resolving it are one
 * capability, and a host that imports either imports both. A barrel keeps that
 * a DAG — this file reaches both leaves, and neither leaf reaches this file —
 * where re-exporting from `pagbank-legacy-notifications.ts` itself would be a
 * cycle.
 *
 * The subpath name is unchanged and every name it served is still served, so
 * nothing an adopter imports moves.
 *
 * Server-only, by construction: a webhook handler is the only caller.
 */
export { resolvePagbankNotification } from './pagbank-legacy-notifications';
export { legacyNotificationCode, pagbankLegacyResolver } from './pagbank-legacy-resolve';
