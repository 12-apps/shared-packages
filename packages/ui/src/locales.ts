/**
 * Every component family's copy, in both languages, keyed by tag.
 *
 * One pack per family rather than one giant pack, because that is how the
 * components take it: six of these are mounted independently and each takes
 * what it renders, while the DataViews family threads one object through a
 * context. A single blob would force a host mounting one component to state
 * copy for ninety.
 *
 * ```ts
 * import { useLocaleCopy } from '@12-apps/i18n/react';
 * const copy = useLocaleCopy(LIGHTBOX_COPY);
 * ```
 *
 * `LocalePack` is mirrored here rather than imported from `@12-apps/i18n`: this
 * package is the one EVERY host renders, and giving it a dependency to carry a
 * type would push that dependency onto every adopter of every other package.
 * The mirror buys the same key-checking for one line.
 */
import type { DataViewsCopy } from './components/data-display/DataViews/data-views-copy';
import type { SavedViewsLabels } from './components/layout/ContentToolbar/ContentToolbar.types';
import type {
  AddressAutocompleteCopy,
  AutocompleteCopy,
  BreadcrumbCopy,
  CarouselCopy,
  CategorySelectCopy,
  CepFieldCopy,
  ChromeCopy,
  CodeEditorCopy,
  CommandPaletteCopy,
  ConfirmActionCopy,
  DataStateCopy,
  InstallPromptCopy,
  LightboxCopy,
  MapPreviewCopy,
  PasswordStrengthCopy,
  PhoneInputCopy,
  RichEditorToolbarCopy,
  SectionOnboardingCopy,
  TableFilterCopy,
  TimingDiagramCopy,
  TutorialCopy,
  UploadButtonCopy,
  UserAvatarCopy,
} from './copy';
import * as en from './en-US';
import * as pt from './pt-BR';

type LocalePack<T> = { readonly 'pt-BR': T; readonly 'en-US': T };

const pack = <T,>(ptBR: T, enUS: T): LocalePack<T> => ({ 'pt-BR': ptBR, 'en-US': enUS });

// data-display
export const LIGHTBOX_COPY = pack<LightboxCopy>(pt.PT_BR_LIGHTBOX_COPY, en.EN_US_LIGHTBOX_COPY);
export const MAP_PREVIEW_COPY = pack<MapPreviewCopy>(
  pt.PT_BR_MAP_PREVIEW_COPY,
  en.EN_US_MAP_PREVIEW_COPY,
);
export const CAROUSEL_COPY = pack<CarouselCopy>(pt.PT_BR_CAROUSEL_COPY, en.EN_US_CAROUSEL_COPY);
export const TIMING_DIAGRAM_COPY = pack<TimingDiagramCopy>(
  pt.PT_BR_TIMING_DIAGRAM_COPY,
  en.EN_US_TIMING_DIAGRAM_COPY,
);
export const DATA_STATE_COPY = pack<DataStateCopy>(
  pt.PT_BR_DATA_STATE_COPY,
  en.EN_US_DATA_STATE_COPY,
);
export const DATA_VIEWS_COPY = pack<DataViewsCopy>(
  pt.PT_BR_DATA_VIEWS_COPY,
  en.EN_US_DATA_VIEWS_COPY,
);

// feedback
export const TUTORIAL_COPY = pack<TutorialCopy>(pt.PT_BR_TUTORIAL_COPY, en.EN_US_TUTORIAL_COPY);
export const CHROME_COPY = pack<ChromeCopy>(pt.PT_BR_CHROME_COPY, en.EN_US_CHROME_COPY);

// form
export const ADDRESS_AUTOCOMPLETE_COPY = pack<AddressAutocompleteCopy>(
  pt.PT_BR_ADDRESS_AUTOCOMPLETE_COPY,
  en.EN_US_ADDRESS_AUTOCOMPLETE_COPY,
);
export const AUTOCOMPLETE_COPY = pack<AutocompleteCopy>(
  pt.PT_BR_AUTOCOMPLETE_COPY,
  en.EN_US_AUTOCOMPLETE_COPY,
);
export const CODE_EDITOR_COPY = pack<CodeEditorCopy>(
  pt.PT_BR_CODE_EDITOR_COPY,
  en.EN_US_CODE_EDITOR_COPY,
);
export const PASSWORD_STRENGTH_COPY = pack<PasswordStrengthCopy>(
  pt.PT_BR_PASSWORD_STRENGTH_COPY,
  en.EN_US_PASSWORD_STRENGTH_COPY,
);
export const RICH_EDITOR_TOOLBAR_COPY = pack<RichEditorToolbarCopy>(
  pt.PT_BR_RICH_EDITOR_TOOLBAR_COPY,
  en.EN_US_RICH_EDITOR_TOOLBAR_COPY,
);
export const PHONE_INPUT_COPY = pack<PhoneInputCopy>(
  pt.PT_BR_PHONE_INPUT_COPY,
  en.EN_US_PHONE_INPUT_COPY,
);
export const UPLOAD_BUTTON_COPY = pack<UploadButtonCopy>(
  pt.PT_BR_UPLOAD_BUTTON_COPY,
  en.EN_US_UPLOAD_BUTTON_COPY,
);

// layout
export const TABLE_FILTER_COPY = pack<TableFilterCopy>(
  pt.PT_BR_TABLE_FILTER_COPY,
  en.EN_US_TABLE_FILTER_COPY,
);

// navigation
export const COMMAND_PALETTE_COPY = pack<CommandPaletteCopy>(
  pt.PT_BR_COMMAND_PALETTE_COPY,
  en.EN_US_COMMAND_PALETTE_COPY,
);
export const BREADCRUMB_COPY = pack<BreadcrumbCopy>(
  pt.PT_BR_BREADCRUMB_COPY,
  en.EN_US_BREADCRUMB_COPY,
);

// shared
export const SECTION_ONBOARDING_COPY = pack<SectionOnboardingCopy>(
  pt.PT_BR_SECTION_ONBOARDING_COPY,
  en.EN_US_SECTION_ONBOARDING_COPY,
);
export const CONFIRM_ACTION_COPY = pack<ConfirmActionCopy>(
  pt.PT_BR_CONFIRM_ACTION_COPY,
  en.EN_US_CONFIRM_ACTION_COPY,
);
export const CATEGORY_SELECT_COPY = pack<CategorySelectCopy>(
  pt.PT_BR_CATEGORY_SELECT_COPY,
  en.EN_US_CATEGORY_SELECT_COPY,
);
export const CEP_FIELD_COPY = pack<CepFieldCopy>(pt.PT_BR_CEP_FIELD_COPY, en.EN_US_CEP_FIELD_COPY);
export const SAVED_VIEWS_LABELS = pack<SavedViewsLabels>(
  pt.PT_BR_SAVED_VIEWS_LABELS,
  en.EN_US_SAVED_VIEWS_LABELS,
);

// utility
export const INSTALL_PROMPT_COPY = pack<InstallPromptCopy>(
  pt.PT_BR_INSTALL_PROMPT_COPY,
  en.EN_US_INSTALL_PROMPT_COPY,
);
export const USER_AVATAR_COPY = pack<UserAvatarCopy>(
  pt.PT_BR_USER_AVATAR_COPY,
  en.EN_US_USER_AVATAR_COPY,
);
