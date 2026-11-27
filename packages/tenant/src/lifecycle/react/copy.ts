/**
 * The words of the closing screens: ALL of them are the host's. A screens pack
 * is the host's lifecycle pack (`TenantCopyPack`, every key of
 * `TENANT_COPY_SHAPE`) plus the keys only a screen reads, listed in
 * {@link TENANT_LIFECYCLE_SCREENS_COPY_SHAPE}.
 *
 * Those extra keys live HERE, not in `TENANT_COPY_SHAPE`, on purpose: the core
 * shape is required by `createApiTenant` too, so a key added to it would make
 * every host's backend fail at boot on a minor release. A host that adopts the
 * screens adds the screen keys to the pack it already has.
 *
 * `text` keys are non-empty strings; `sentence` keys are functions that write
 * the whole sentence (the host owns grammar, plurals and word order). A
 * sentence with a part set in bold answers {@link TenantEmphasis}.
 */
import type { TenantCopyPack } from '../../config';

/** A sentence with one part set in bold: `before` + **`bold`** + `after`. */
export interface TenantEmphasis {
  before: string;
  bold: string;
  after: string;
}

/** Who archived a tenant, when and why, for the platform's card. */
export interface TenantArchivedFacts {
  /** The archive's day, already formatted. */
  day: string;
  /** The person who archived it, by name; null when the tenant's owner did. */
  actor: string | null;
  /** True when the platform archived it on the owner's behalf. */
  byPlatform: boolean;
  /** The reason given, as typed. */
  reason: string;
}

/** The keys only the screens read, on top of `TenantCopyPack`. */
export interface TenantLifecycleScreensKeys {
  /** The reopen answered a status that is not live (a suspended tenant archived by the platform). */
  readonly reopenedSuspended: string;
  /** A tenant neither open nor closing (suspended, not approved yet): it cannot be closed from the close page. */
  readonly notClosableTitle: string;
  readonly notClosableBody: string;
  /** The accessible name of a dialog's or a panel's close button. */
  readonly closeLabel: string;
  /** The platform's confirmation: its title, as a question naming the tenant. */
  readonly platformArchiveTitle: (name: string) => string;
  /** What happens, with the last day it can be restored. */
  readonly platformArchiveLead: (purgeDay: string) => string;
  /** The pending list's heading (unnumbered: the platform has no steps). */
  readonly platformPendingTitle: string;
  /** Nothing pending. */
  readonly platformPendingNone: string;
  /** Under the blockers: who resolves them. */
  readonly platformPendingHint: string;
  /** The facts' heading. */
  readonly platformAfterTitle: string;
  /** The owner's e-mail, with the short last day. */
  readonly platformFactEmail: (purgeShortDay: string) => TenantEmphasis;
  /** The automatic deletion. */
  readonly platformFactPurge: (purgeDay: string) => TenantEmphasis;
  /** The audit line. */
  readonly platformFactAudit: string;
  /** What cannot be undone, set apart. */
  readonly platformUndo: (purgeDay: string) => string;
  readonly platformReasonPlaceholder: string;
  /** Under the reason: where it goes. */
  readonly platformReasonHelp: string;
  /** The platform's card. */
  readonly platformCardTitle: string;
  /** The card's "what happens" heading. */
  readonly platformCardWhat: string;
  /** The archived card's who / when / why. */
  readonly platformArchived: (facts: TenantArchivedFacts) => TenantEmphasis;
  /** The archived card's deletion day. */
  readonly platformPurgeFact: (purgeDay: string) => TenantEmphasis;
  /** Undo the archive (card button). */
  readonly platformRestore: string;
  /** Said once the platform archived the tenant. */
  readonly platformArchivedToast: (name: string) => string;
  /** The host's status line under an archived tenant's status. */
  readonly platformStatusSub: (purgeDay: string) => string;
}

/** One language's pack for the closing screens. */
export type TenantLifecycleCopy = TenantCopyPack & TenantLifecycleScreensKeys;

type Kind = 'text' | 'sentence';

/** The screens' own keys and their kinds; the rest of a pack is `TENANT_COPY_SHAPE`. */
export const TENANT_LIFECYCLE_SCREENS_COPY_SHAPE = {
  reopenedSuspended: 'text',
  notClosableTitle: 'text',
  notClosableBody: 'text',
  closeLabel: 'text',
  platformArchiveTitle: 'sentence',
  platformArchiveLead: 'sentence',
  platformPendingTitle: 'text',
  platformPendingNone: 'text',
  platformPendingHint: 'text',
  platformAfterTitle: 'text',
  platformFactEmail: 'sentence',
  platformFactPurge: 'sentence',
  platformFactAudit: 'text',
  platformUndo: 'sentence',
  platformReasonPlaceholder: 'text',
  platformReasonHelp: 'text',
  platformCardTitle: 'text',
  platformCardWhat: 'text',
  platformArchived: 'sentence',
  platformPurgeFact: 'sentence',
  platformRestore: 'text',
  platformArchivedToast: 'sentence',
  platformStatusSub: 'sentence',
} as const satisfies { [K in keyof TenantLifecycleScreensKeys]-?: Kind };
