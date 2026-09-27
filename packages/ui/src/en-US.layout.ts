/**
 * The en-US pack for the layout family. Split the same way `pt-BR.layout.ts`
 * is — see `en-US.ts` for why the packs live in per-family files.
 */
import type {
  SettingCardCopy,
  SettingSwitchCopy,
  TableFilterCopy,
} from './copy';

export const EN_US_TABLE_FILTER_COPY: TableFilterCopy = {
  clearAllFilters: "Clear all filters",
  clearKeyword: "Clear the search",
  invalidRange: "The maximum must be greater than or equal to the minimum.",
  rangeMin: "Minimum",
  rangeMax: "Maximum",
};

export const EN_US_SETTING_CARD_COPY: SettingCardCopy = {
  edit: "Edit",
  cancel: "Cancel",
  save: "Save",
  saving: "Saving…",
  learnMore: "Learn more",
  saveFailed: "Could not save. Please try again.",
};

export const EN_US_SETTING_SWITCH_COPY: SettingSwitchCopy = {
  saving: "Saving…",
  saveFailed: "Could not save. Please try again.",
};
