/**
 * `@12-apps/notifications/email/previews/react` — the operator screen over the
 * preview catalogue.
 *
 * Its own subpath rather than a member of `./react`, which is the INBOX: the
 * bell and the preference matrix ship to every signed-in user, and this screen
 * is a platform-staff diagnostic. A host that mounts one has no reason to
 * resolve the other.
 */
export { createEmailPreviewScreen, type EmailPreviewScreenConfig } from './preview-screen';
export { type EmailPreviewScreenCopy } from './copy';
export { EN_US_EMAIL_PREVIEW_COPY } from './copy.en-US';
export { PT_BR_EMAIL_PREVIEW_COPY } from './copy.pt-BR';
export { type PreviewTab, type PreviewWidth } from './message-view';
