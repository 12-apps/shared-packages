/**
 * The two factories' configs. Every piece is the host's and required: a
 * missing one fails when the host boots, named, never on screen.
 */
import type { TenantLifecycleCopy } from './copy';
import type { TenantRefusalConfig } from './refusals';
import type {
  TenantClosePageFrame,
  TenantClosingHooks,
  TenantLifecyclePin,
  TenantLink,
  TenantOverlay,
  TenantPinFields,
  TenantToast,
  TenantUndoNote,
} from './types';

/** The copy packs by locale tag; `defaultLocale` must be one of them. */
export interface TenantLifecycleCopyConfig {
  locales: Readonly<Record<string, TenantLifecycleCopy>>;
  defaultLocale: string;
}

/** The status values the screens branch on: the host's own. */
export interface TenantLifecycleStatuses {
  active: string;
  closing: string;
  closed: string;
}

/** `createClosingScreens`: the owner's close page, its dialog, the banner, the gone screen and the refusal readers. */
export interface TenantClosingScreensConfig<P extends TenantLifecyclePin> extends TenantRefusalConfig {
  statuses: TenantLifecycleStatuses;
  copy: TenantLifecycleCopyConfig;
  hooks: TenantClosingHooks & {
    /** The person's PIN for the close (the host's own hook). */
    usePin(): P;
  };
  components: {
    PinFields: TenantPinFields<P>;
    UndoNote: TenantUndoNote;
    Link: TenantLink;
    Frame: TenantClosePageFrame;
  };
  /** An ISO instant as the page's and the banner's short day, in the tenant's zone. */
  shortDay: (iso: string) => string;
  /** The locale the typed name is compared in, as the server compares it (`pt-BR`). */
  nameLocale: string;
}

/** `createPlatformArchive`: the platform's archive confirmation and its card. */
export interface TenantPlatformArchiveConfig<P extends TenantLifecyclePin> {
  statuses: TenantLifecycleStatuses & {
    /** The statuses the platform may archive from (`TenantStatusSet.closableFrom`). */
    closableFrom: readonly string[];
  };
  copy: TenantLifecycleCopyConfig;
  components: {
    PinFields: TenantPinFields<P>;
    UndoNote: TenantUndoNote;
    Overlay: TenantOverlay;
  };
  toast: TenantToast;
}
