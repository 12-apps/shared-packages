import type { CheckboxProps } from './Checkbox.types';

type CheckboxDefaultedKeys = 'variant' | 'ripple' | 'glow' | 'pulse';

type ResolvedCheckboxProps = CheckboxProps &
  Required<Pick<CheckboxProps, CheckboxDefaultedKeys>>;

const CHECKBOX_DEFAULTS: Pick<CheckboxProps, CheckboxDefaultedKeys> = {
  variant: 'default',
  ripple: true,
  glow: false,
  pulse: false,
};

// Strips explicitly-undefined props before the merge, so `ripple={undefined}` still
// falls back to the default exactly as a destructuring default would.
const definedProps = (props: CheckboxProps): Partial<CheckboxProps> =>
  Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Partial<CheckboxProps>;

export const resolveCheckboxProps = (props: CheckboxProps): ResolvedCheckboxProps =>
  ({ ...CHECKBOX_DEFAULTS, ...definedProps(props) }) as ResolvedCheckboxProps;

export const makeTestId =
  (dataTestId?: string) =>
  (suffix: string): string =>
    dataTestId ? `${dataTestId}-${suffix}` : `checkbox-${suffix}`;
