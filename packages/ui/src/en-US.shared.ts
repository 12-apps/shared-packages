/**
 * The en-US pack for the shared family. Split the same way `pt-BR.shared.ts`
 * is — see `en-US.ts` for why.
 */
import type { SavedViewsLabels } from "./components/layout/ContentToolbar/ContentToolbar.types";
import type {
  CategorySelectCopy,
  CepFieldCopy,
  ConfirmActionCopy,
  SectionOnboardingCopy,
} from './copy';

export const EN_US_SECTION_ONBOARDING_COPY: SectionOnboardingCopy = {
  edit: "Edit",
  collapse: "Hide",
  start: "Start",
};

export const EN_US_CONFIRM_ACTION_COPY: ConfirmActionCopy = {
  cancel: "Cancel",
  defaultError: "That action could not be completed. Try again.",
  irreversible: "This cannot be undone.",
  // The expected word is what the reader must type, and it is the HOST's word.
  // It is interpolated rather than translated: a dialog that asks for one word
  // and matches on another can never be confirmed.
  typeToConfirm: (expected) => `Type "${expected}" to confirm.`,
};

export const EN_US_CATEGORY_SELECT_COPY: CategorySelectCopy = {
  purpose: "Categories organise the menu and the filters shoppers see.",
  clearSelection: "Clear selection",
  selectAll: "Select all",
  deselectAll: "Deselect all",
  expandAll: "Expand all",
  collapseAll: "Collapse all",
  expandCategory: (name) => `Expand ${name}`,
  collapseCategory: (name) => `Collapse ${name}`,
  placeholderSingle: "Move to…",
  placeholderMulti: "Category",
  emptyTitle: "No categories yet",
  createCategory: "Create category",
  noResults: {
    title: (query) => `Nothing found for “${query}”`,
    hint: "Try another term, or check the spelling.",
    clearSearch: "Clear search",
    create: (query) => `Create “${query}”`,
  },
  search: {
    placeholderSingle: "Search categories…",
    placeholderMulti: "Search a category or subcategory",
    clear: "Clear search",
    removeChip: (label) => `Remove ${label}`,
    pinnedLabel: (count) => `Selected · ${count}`,
  },
  footer: {
    // The pt-BR pack pluralises with a suffix; English changes the noun, so the
    // whole word is chosen here. Each locale owning its own plural rule is the
    // reason these are functions rather than templates.
    selectedCount: (count) => `${count} ${count === 1 ? "category" : "categories"} selected`,
    clear: "Clear",
    apply: "Apply",
    close: "Close",
    singleHint: "Pick one category",
    cancel: "Cancel",
  },
};

/**
 * CEP is Brazil's postal code and is NOT translated: the field looks up a
 * Brazilian address by a Brazilian code, and calling it a "ZIP code" in the
 * error would send an English-reading operator hunting for a field that does
 * not exist. The surrounding sentences are English; the code's name is a proper
 * noun, the same way a vendor's own field name is.
 */
export const EN_US_CEP_FIELD_COPY: CepFieldCopy = {
  loading: "Looking up the address…",
  found: "Address filled in from the CEP.",
  notfound: "CEP not found — fill the address in by hand.",
};

/**
 * The saved-views dropdown's labels.
 *
 * Typed as the package's OWN `SavedViewsLabels` rather than a parallel shape,
 * for the reason `pt-BR.shared.ts` records: that interface already named every
 * string, including the seven with no diacritics the copy gate could not see.
 */
export const EN_US_SAVED_VIEWS_LABELS: SavedViewsLabels = {
  trigger: "Views",
  mainView: "Main view",
  pinned: "Pinned",
  recent: "Recent",
  empty: "No saved views yet.",
  saveCurrent: "+ Save current view",
  manageAll: "Manage views",
  apply: "Apply",
  setDefault: "Set as default",
  pin: "Pin to the sidebar",
  unpin: "Unpin",
  share: "Share with the team",
  unshare: "Make private",
  edit: "Edit",
  remove: "Delete",
  defaultTag: "Default",
};
