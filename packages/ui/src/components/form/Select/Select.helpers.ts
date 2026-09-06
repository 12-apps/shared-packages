import type { SelectBaseProps, SelectOption, SelectValue } from './Select.base';
import { withDefaults } from '../../../utils/withDefaults';

type SelectDefaultedKeys = 'variant' | 'size' | 'fullWidth' | 'error' | 'glow' | 'pulse' | 'disabled';

export type ResolvedSelectProps<P extends SelectBaseProps> = P &
  Required<Pick<SelectBaseProps, SelectDefaultedKeys>>;

/**
 * `Select.tsx` leaves `variant`, `size`, `glow` and `pulse` undefined on
 * purpose — undefined resolves to the default variant, MUI's medium and no
 * effects, which keeps its render function under the complexity budget. The
 * native renderer has to name them, so the same resolution happens here.
 */
const SELECT_DEFAULTS: Required<Pick<SelectBaseProps, SelectDefaultedKeys>> = {
  variant: 'default',
  size: 'md',
  fullWidth: true,
  error: false,
  glow: false,
  pulse: false,
  disabled: false,
};

export const resolveSelectProps = <P extends SelectBaseProps>(props: P): ResolvedSelectProps<P> =>
  withDefaults(props, SELECT_DEFAULTS as Partial<P>) as ResolvedSelectProps<P>;

/** One row of the list: an option, or the disabled placeholder above them. */
export interface SelectItem {
  value: SelectValue;
  label: string;
  disabled: boolean;
  /** The placeholder is not an option: it carries no test id and cannot be chosen. */
  placeholder: boolean;
  option?: SelectOption;
}

/**
 * The list MUI renders: the placeholder first when there is one, then the
 * options, in the order `renderMenuItems` builds them.
 */
export function selectItems(options: SelectOption[], placeholder?: string): SelectItem[] {
  const items: SelectItem[] = options.map((option) => ({
    value: option.value,
    label: option.label,
    disabled: option.disabled === true,
    placeholder: false,
    option,
  }));
  if (placeholder === undefined || placeholder === '') return items;
  return [{ value: '', label: placeholder, disabled: true, placeholder: true }, ...items];
}

/**
 * What the display slot shows.
 *
 * The LAST match wins, which is MUI's own answer: `SelectInput` walks its
 * children and overwrites the display for every child whose value matches, so
 * a list carrying both an empty placeholder and a real empty-valued option
 * shows the option. Values are compared as strings because the DOM stringifies
 * them anyway (MUI's `areEqualValues`).
 */
export function displayLabel(items: SelectItem[], value: SelectValue): string {
  let label = '';
  for (const item of items) {
    if (String(item.value) === String(value)) label = item.label;
  }
  return label;
}

/** The three ids the web puts on the control, spelled exactly as it spells them. */
export function selectTestIds(id: string | undefined): {
  root: string | undefined;
  trigger: string;
  option: (value: SelectValue) => string;
} {
  return {
    root: id,
    trigger: id ? `${id}-select` : 'select',
    option: (value) => (id ? `${id}-option-${value}` : `option-${value}`),
  };
}
