/**
 * `@12-apps/impersonation/react` — the browser half.
 *
 * ```ts
 * const { banner, dialog } = createWebImpersonation({ labels, onEnd, … });
 * ```
 *
 * NOT LAZY, anywhere, and a host should not code-split it either: a chunk that
 * fails to load is a banner that does not render, and this bar's whole job is to
 * be there. It is a few kilobytes on an entry bundle, spent on the one component
 * whose absence is a security failure rather than a slower page.
 *
 * The surface is deliberately small. The wording helpers, the exit-path rule and
 * the banner-host registry are internal — they are how the bar keeps its
 * promises, not knobs for a caller to turn.
 */
export { createWebImpersonation } from './create-web-impersonation';
export type {
  ImpersonationDialogConfig,
  ImpersonationWebConfig,
  WebImpersonation,
} from './create-web-impersonation';

export type {
  ImpersonationBannerPlacement,
  ImpersonationBannerProps,
} from './banner';
export type { ImpersonationAppOption, ImpersonationDialogProps } from './dialog';

export type {
  ImpersonationBannerLabels,
  ImpersonationDialogLabels,
  ImpersonationLabels,
} from './labels';

export { IMPERSONATION_OFFSET_VAR } from './offset';
export { formatRemaining, remainingMs } from './countdown';
export { notifyImpersonationChanged } from './state';
export type { ImpersonationStateHandle } from './state';

export { ImpersonationHttpError, httpImpersonationTransport } from './transport';
export type { ImpersonationTransport } from './transport';

export type { ImpersonationStartRefusal, ImpersonationStartResult } from './session-control';
