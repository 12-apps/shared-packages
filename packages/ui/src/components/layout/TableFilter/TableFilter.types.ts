import type { ReactNode } from 'react';

/** Props for the `<TableFilter>` root (provider). */
export interface TableFilterProps {
  children: ReactNode;
  /** Whether the panel is open. */
  open: boolean;
  /** Toggle the panel. */
  onOpenChange: (open: boolean) => void;
  /** Shows a filled dot on the trigger when filters are active. */
  hasActiveFilters?: boolean;
}

/** Props for `<TableFilter.Layout>`. */
export interface TableFilterLayoutProps {
  children: ReactNode;
  className?: string;
}

/** Props for `<TableFilter.Main>`. */
export interface TableFilterMainProps {
  children: ReactNode;
  className?: string;
}

/** Props for `<TableFilter.Panel>`. */
export interface TableFilterPanelProps {
  children: ReactNode;
  /** Clears every filter. Rendered as the panel's "Clear All Filters" link. */
  onClearAll: () => void;
  /** Accessible label for the panel `<aside>`. */
  ariaLabel?: string;
  clearTestId?: string;
}

/** Props for `<TableFilter.Keyword>`. */
export interface TableFilterKeywordProps {
  value: string;
  /** Committed on blur or Enter (not on every keystroke). */
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  testId?: string;
}

/** Props for `<TableFilter.Section>`. */
export interface TableFilterSectionProps {
  title: string;
  children: ReactNode;
}

/** A checkbox option for `<TableFilter.CheckboxField>`. */
export interface TableFilterCheckboxOption<TValue extends string = string> {
  value: TValue;
  label: string;
  count?: number;
}

/** Props for `<TableFilter.CheckboxField>` — a labelled multi-select group. */
export interface TableFilterCheckboxFieldProps<TValue extends string = string> {
  label: string;
  options: TableFilterCheckboxOption<TValue>[];
  selected: ReadonlySet<TValue>;
  onToggle: (value: TValue, checked: boolean) => void;
  testId?: string;
}

/** A numeric min/max range value. */
export interface TableFilterRange {
  min?: number;
  max?: number;
}

/** Props for `<TableFilter.RangeField>` — a labelled min/max pair. */
export interface TableFilterRangeFieldProps {
  label: string;
  value: TableFilterRange;
  onChange: (range: TableFilterRange) => void;
  /** Optional unit suffix (e.g. "R$", "un"). */
  unit?: string;
  step?: number;
  minPlaceholder?: string;
  maxPlaceholder?: string;
  /** Error text shown when the range is inverted (max < min). */
  invalidLabel?: string;
  testId?: string;
}
