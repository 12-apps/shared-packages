import FirstPage from '@mui/icons-material/FirstPage';
import LastPage from '@mui/icons-material/LastPage';
import NavigateBefore from '@mui/icons-material/NavigateBefore';
import NavigateNext from '@mui/icons-material/NavigateNext';
import React from 'react';

import type { PaginationProps } from './Pagination.types';

type PaginationDefaultedKeys =
  | 'variant'
  | 'size'
  | 'boundaryCount'
  | 'siblingCount'
  | 'hideNextButton'
  | 'hidePrevButton'
  | 'showFirstButton'
  | 'showLastButton'
  | 'firstIcon'
  | 'lastIcon'
  | 'previousIcon'
  | 'nextIcon'
  | 'disabled'
  | 'color'
  | 'showPageInfo'
  | 'pageInfoFormat'
  | 'showItemsPerPage'
  | 'itemsPerPageOptions'
  | 'itemsPerPage';

export type ResolvedPaginationProps = PaginationProps &
  Required<Pick<PaginationProps, PaginationDefaultedKeys>>;

const PAGINATION_DEFAULTS: Pick<PaginationProps, PaginationDefaultedKeys> = {
  variant: 'default',
  size: 'md',
  boundaryCount: 1,
  siblingCount: 1,
  hideNextButton: false,
  hidePrevButton: false,
  showFirstButton: false,
  showLastButton: false,
  firstIcon: <FirstPage />,
  lastIcon: <LastPage />,
  previousIcon: <NavigateBefore />,
  nextIcon: <NavigateNext />,
  disabled: false,
  color: 'primary',
  showPageInfo: false,
  pageInfoFormat: (page: number, count: number) => `Page ${page} of ${count}`,
  showItemsPerPage: false,
  itemsPerPageOptions: [10, 25, 50, 100],
  itemsPerPage: 10,
};

// Strips explicitly-undefined props before the merge, so `prop={undefined}` still
// falls back to the default exactly as a destructuring default would. Applied as
// a merge rather than destructuring defaults, which would otherwise put nineteen
// branches into the component's own complexity budget.
export const resolvePaginationProps = (props: PaginationProps): ResolvedPaginationProps =>
  ({
    ...PAGINATION_DEFAULTS,
    ...(Object.fromEntries(
      Object.entries(props).filter(([, value]) => value !== undefined),
    ) as Partial<PaginationProps>),
  }) as ResolvedPaginationProps;

export const makeTestId =
  (dataTestId?: string) =>
  (suffix: string): string =>
    dataTestId ? `${dataTestId}-${suffix}` : `pagination-${suffix}`;

// Our three sizes map onto MUI's own scale.
export const muiSizeFor = (size: string): 'small' | 'medium' | 'large' => {
  if (size === 'sm') return 'small';
  if (size === 'lg') return 'large';
  return 'medium';
};

// One scale for every place that sizes something off the same prop. Kept
// generic so spacing values stay in MUI units rather than being converted.
export const scaleFor = <T,>(size: string, scale: [T, T, T]): T => {
  if (size === 'sm') return scale[0];
  if (size === 'lg') return scale[2];
  return scale[1];
};
