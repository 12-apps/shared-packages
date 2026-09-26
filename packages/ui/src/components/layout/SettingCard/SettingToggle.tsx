import Box from '@mui/material/Box/index.js';
import { forwardRef } from 'react';

import { useAsyncSwitch } from './SettingCard.hooks';
import { flatStyles, surfaceStyles, withCallerSx } from './SettingCard.styles';
import type { SettingToggleProps } from './SettingCard.types';
import { useSettingGroup } from './SettingGroup.context';
import { SettingSwitchBlock, useSettingSwitchIds } from './SettingSwitch';

/**
 * A setting that is one switch and nothing else. There is no edit state:
 * flipping it IS the edit, and it saves at once.
 *
 * `onChange` may be async. The switch shows the new value while the promise is
 * pending, with a spinner and an announced "saving"; a rejection flips it back
 * to `checked` and shows the error under it.
 *
 * Inside a `SettingGroup` whose main switch is off, it renders disabled.
 */
export const SettingToggle = forwardRef<HTMLElement, SettingToggleProps>(function SettingToggle(props, ref) {
  const { checked, onChange, copy, formatError, disabled = false, variant = 'card', dataTestId, className, sx } = props;
  const group = useSettingGroup();
  const ids = useSettingSwitchIds();
  const state = useAsyncSwitch({ checked, onChange, formatError, fallback: copy.saveFailed });
  const card = variant === 'card';

  return (
    <Box
      component={card ? 'section' : 'div'}
      ref={ref}
      aria-labelledby={ids.titleId}
      aria-busy={state.saving || undefined}
      data-variant={variant}
      data-testid={dataTestId}
      className={className}
      sx={withCallerSx((theme) => (card ? surfaceStyles(theme, false) : flatStyles(theme)), sx)}
    >
      <SettingSwitchBlock {...props} disabled={disabled || group.inactive} ids={ids} state={state} />
    </Box>
  );
});

SettingToggle.displayName = 'SettingToggle';
