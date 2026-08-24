import type { ReportEngineCopy } from './copy';
import { EN_US_REPORT_ENGINE_COPY } from './en-US';
import { PT_BR_REPORT_ENGINE_COPY } from './pt-BR';
import { EN_US_REPORT_SCREENS_COPY } from './react/en-US';
import { PT_BR_REPORT_SCREENS_COPY } from './react/pt-BR';
import type { ReportScreensCopy } from './react/screens-copy';
import type { BlankBlockTemplateCopy } from './server/block-templates';
import {
  EN_US_BLANK_BLOCK_TEMPLATE_COPY,
  EN_US_REPORT_SERVER_MESSAGES,
} from './server/en-US';
import type { ReportServerMessages } from './server/messages';
import {
  PT_BR_BLANK_BLOCK_TEMPLATE_COPY,
  PT_BR_REPORT_SERVER_MESSAGES,
} from './server/pt-BR';

/**
 * All three halves, in both languages, keyed by tag.
 *
 * The ENGINE pack is the one to resolve first and hand to everything else: it
 * carries `spec.locale`, which is what `format.ts` formats every value with, so
 * an export and the screen that produced it can never disagree about how a
 * number is written. A host that resolved the screens from one locale and the
 * engine from another would get an English sentence over Brazilian decimals.
 *
 * `LocalePack` is mirrored here rather than imported so the package stays
 * liftable into a repo that has never heard of `@12-apps/i18n`.
 */
type LocalePack<T> = { readonly 'pt-BR': T; readonly 'en-US': T };

export const REPORT_ENGINE_COPY = {
  'pt-BR': PT_BR_REPORT_ENGINE_COPY,
  'en-US': EN_US_REPORT_ENGINE_COPY,
} as const satisfies LocalePack<ReportEngineCopy>;

export const REPORT_SERVER_MESSAGES = {
  'pt-BR': PT_BR_REPORT_SERVER_MESSAGES,
  'en-US': EN_US_REPORT_SERVER_MESSAGES,
} as const satisfies LocalePack<ReportServerMessages>;

export const BLANK_BLOCK_TEMPLATE_COPY = {
  'pt-BR': PT_BR_BLANK_BLOCK_TEMPLATE_COPY,
  'en-US': EN_US_BLANK_BLOCK_TEMPLATE_COPY,
} as const satisfies LocalePack<BlankBlockTemplateCopy>;

export const REPORT_SCREENS_COPY = {
  'pt-BR': PT_BR_REPORT_SCREENS_COPY,
  'en-US': EN_US_REPORT_SCREENS_COPY,
} as const satisfies LocalePack<ReportScreensCopy>;
