import type { EmptyStateBaseProps } from './EmptyState.base';

export const makeTestId =
  (dataTestId?: string) =>
  (suffix: string): string =>
    dataTestId ? `${dataTestId}-${suffix}` : `empty-state-${suffix}`;

/** The glyph an action carries, by the shared icon set's name; each renderer draws it its own way. */
export type ActionIconName = 'Add' | 'Refresh';

export interface ActionSpec {
  key: 'primary-action' | 'create-button' | 'secondary-action' | 'refresh-button';
  variant: 'contained' | 'outlined';
  onClick: () => void;
  label: string;
  icon?: ActionIconName;
}

// The four buttons are one button with different props. Listing them keeps their
// order — primary, create, secondary, refresh — visible in one place, and both
// renderers read this one list.
export const actionsOf = (
  props: EmptyStateBaseProps,
  refreshLabel: string,
  createLabel: string,
): ActionSpec[] => {
  const { primaryAction, secondaryAction, onCreate, onRefresh } = props;
  const specs: ActionSpec[] = [];

  if (primaryAction) {
    specs.push({
      key: 'primary-action',
      variant: 'contained',
      onClick: primaryAction.onClick,
      label: primaryAction.label,
    });
  }
  if (onCreate) {
    specs.push({
      key: 'create-button',
      variant: 'contained',
      onClick: onCreate,
      label: createLabel,
      icon: 'Add',
    });
  }
  if (secondaryAction) {
    specs.push({
      key: 'secondary-action',
      variant: 'outlined',
      onClick: secondaryAction.onClick,
      label: secondaryAction.label,
    });
  }
  if (onRefresh) {
    specs.push({
      key: 'refresh-button',
      variant: 'outlined',
      onClick: onRefresh,
      label: refreshLabel,
      icon: 'Refresh',
    });
  }

  return specs;
};
