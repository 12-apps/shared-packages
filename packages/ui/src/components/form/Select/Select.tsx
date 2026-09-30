import React from 'react';

import { MenuSelect } from './Select.menu';
import { SearchableSelect, shouldSearch } from './Select.searchable';
import type { SelectProps } from './Select.types';

/**
 * The house select. Up to five options it opens a menu; from six on it is a
 * search box over a list of bounded height (`Select.searchable.tsx`), with the
 * same props, events and test ids either way. `searchable` overrides the count.
 */
export const Select = React.forwardRef<HTMLDivElement, SelectProps>((props, ref) => {
  if (shouldSearch(props)) return <SearchableSelect {...props} ref={ref} />;
  return <MenuSelect {...props} ref={ref} />;
});

Select.displayName = 'Select';

export { MenuSelect };
