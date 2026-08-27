/**
 * `@12-apps/notifications/email/previews` — the preview catalogue and the
 * routes over it.
 *
 * Behind its own subpath so a web bundle importing `./email` (the layout) or
 * `./react` (the inbox) never resolves the server half.
 */
export {
  createEmailPreviews,
  DuplicateEmailPreviewIdError,
  type ApiEmailPreviews,
  type EmailPreviewCoverage,
  type EmailPreviewDetail,
  type EmailPreviewIndex,
  type EmailPreviewMessage,
  type EmailPreviewRow,
  type EmailPreviewSource,
  type EmailPreviewsConfig,
} from './catalog';

export {
  emailPreviewRoutes,
  type EmailPreviewRequest,
  type EmailPreviewResponse,
  type EmailPreviewRoute,
} from './routes';
