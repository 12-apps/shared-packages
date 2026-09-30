import type { ImpersonationWebConfig, WebImpersonation } from './create-web-impersonation';
import { bindWebImpersonationBase } from './web-impersonation-base';

/**
 * The web surface of an app that only ever WEARS sessions: the banner and
 * `startPreview`, and never the start dialog.
 *
 * `createWebImpersonation` without a `dialog` returns the same object, but its
 * module still names the dialog's chunk, so the host's bundle does too. This
 * factory's module graph stops at the banner, which is what the preview
 * manifest promises: the operator's picker is not in a tenant app's build at
 * all, rather than in it and never fetched.
 */
export function createPreviewWebImpersonation(
  config: Omit<ImpersonationWebConfig, 'dialog'>,
): WebImpersonation {
  const { banner, startPreview } = bindWebImpersonationBase(config);
  return { banner, dialog: null, startPreview };
}
