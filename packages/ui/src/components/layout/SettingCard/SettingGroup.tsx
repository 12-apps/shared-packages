import Box from '@mui/material/Box/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import { forwardRef, useId, useMemo } from 'react';

import { Icon } from '../../../icons';

import { useAsyncSwitch } from './SettingCard.hooks';
import { partTestId } from './SettingCard.parts';
import { dependentsStyles, hintStyles, surfaceStyles, withCallerSx } from './SettingCard.styles';
import type { SettingGroupProps } from './SettingCard.types';
import { SettingGroupContext } from './SettingGroup.context';
import { SettingSwitchBlock, useSettingSwitchIds } from './SettingSwitch';

/**
 * ONE subject: a main switch, and the settings that only mean something while
 * it is on, indented beneath it.
 *
 * With the main switch off the dependent rows stay where they are — dimmed,
 * `inert`, and explained by `inactiveHint` — rather than disappearing. A
 * reader deciding whether to turn a feature on is helped by seeing what it
 * would let them configure, and a layout that jumps when a switch flips moves
 * the thing they were about to press.
 *
 * The rows are active only while the main switch is on AND saved: turning it
 * on lights them once the save lands; turning it off dims them at once.
 *
 * Several subjects are several cards, never one group — see `SettingGroup.md`.
 */
export const SettingGroup = forwardRef<HTMLElement, SettingGroupProps>(function SettingGroup(props, ref) {
  const {
    checked, onChange, copy, formatError, inactiveHint, children, disabled = false, dataTestId, className, sx,
  } = props;
  const theme = useTheme();
  const ids = useSettingSwitchIds();
  const hintId = `${useId()}-hint`;
  const state = useAsyncSwitch({ checked, onChange, formatError, fallback: copy.saveFailed });
  const active = checked && state.shown && !disabled;
  const context = useMemo(() => ({ inactive: !active }), [active]);

  return (
    <Box
      component="section"
      ref={ref}
      aria-labelledby={ids.titleId}
      aria-busy={state.saving || undefined}
      data-active={active}
      data-testid={dataTestId}
      className={className}
      sx={withCallerSx((t) => surfaceStyles(t, false), sx)}
    >
      <SettingSwitchBlock {...props} disabled={disabled} ids={ids} state={state} />
      {!active && (
        <Box component="p" id={hintId} sx={hintStyles(theme)} data-testid={partTestId(dataTestId, 'hint')}>
          <Icon name="InfoOutlined" size="xs" />
          <span>{inactiveHint}</span>
        </Box>
      )}
      <Box
        role="group"
        aria-labelledby={ids.titleId}
        aria-describedby={active ? undefined : hintId}
        aria-disabled={active ? undefined : true}
        inert={!active}
        sx={dependentsStyles(theme, active)}
        data-testid={partTestId(dataTestId, 'dependents')}
      >
        <SettingGroupContext.Provider value={context}>{children}</SettingGroupContext.Provider>
      </Box>
    </Box>
  );
});

SettingGroup.displayName = 'SettingGroup';
