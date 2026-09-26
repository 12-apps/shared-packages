import { createContext, useContext } from 'react';

/**
 * What a `SettingGroup` tells the rows inside it: whether its main switch is
 * off. `inert` on the rows' container already makes every descendant
 * unreachable; this is for the family's own rows (`SettingToggle`) to ALSO
 * draw and announce themselves as disabled, which `inert` does not do.
 */
export const SettingGroupContext = createContext<{ inactive: boolean }>({ inactive: false });

export const useSettingGroup = (): { inactive: boolean } => useContext(SettingGroupContext);
