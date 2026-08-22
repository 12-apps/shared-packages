import type { ConfirmActionCopy } from '../../../copy';
import { Button } from '../../form/Button';
import type { ButtonProps } from '../../form/Button/Button.types';

import { withConfirmation } from './with-confirmation';
import type { ConfirmableComponent } from './ConfirmAction.types';

/**
 * The library `Button`, already wrapped — the shape most call sites want.
 *
 * Adding the guard to an existing button is then an import swap plus the
 * `confirm` prop; the button's own props (colour, size, icon) are untouched.
 * The baked-in defaults are only the wording and tone every destructive
 * confirmation shares, and each instance can still override them.
 */
export function createConfirmButton(
  copy: ConfirmActionCopy,
  errorText: string,
): ConfirmableComponent<ButtonProps> {
  return withConfirmation<ButtonProps>(Button, {
    cancelText: copy.cancel,
    tone: 'destructive',
    errorText,
    copy,
  });
}
