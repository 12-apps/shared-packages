import FirstPage from '@mui/icons-material/FirstPage';
import LastPage from '@mui/icons-material/LastPage';
import NavigateBefore from '@mui/icons-material/NavigateBefore';
import NavigateNext from '@mui/icons-material/NavigateNext';
import type { PaginationRenderItemParams } from '@mui/material';
import {
  Box,
  FormControl,
  MenuItem,
  Pagination as MuiPagination,
  PaginationItem,
  Select,
  Typography,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import React from 'react';

import { paginationStyles } from './Pagination.styles';
import type { PaginationProps } from './Pagination.types';

const StyledPagination = styled(MuiPagination, {
  shouldForwardProp: (prop) => !['customVariant', 'customSize'].includes(prop as string),
})<{ customVariant?: string; customSize?: string }>(({ theme, customVariant, customSize }) => ({
  ...paginationStyles({ theme, customVariant, customSize }),
}));

const PageInfoContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(2),
  marginLeft: theme.spacing(2),
}));

const ItemsPerPageContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1),
  marginRight: theme.spacing(2),
}));

const PaginationContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexWrap: 'wrap',
  gap: theme.spacing(1),
}));

// Arrow items get a short suffix, pages carry their number. This was two
// parallel switch statements that differed only in whether the prefix came from
// dataTestId or the literal 'pagination'.
const ITEM_TEST_SUFFIX: Record<string, string> = {
  first: 'first',
  last: 'last',
  previous: 'prev',
  next: 'next',
};

const paginationItemTestId = (
  base: string | undefined,
  item: PaginationRenderItemParams,
): string | undefined => {
  const prefix = base ?? 'pagination';

  if (item.type === 'page') return `${prefix}-page-${item.page}`;

  const suffix = ITEM_TEST_SUFFIX[item.type];
  return suffix ? `${prefix}-${suffix}` : undefined;
};

// A dots-variant page renders as a bare dot; everything else uses MUI's item
// with our own arrow icons.
const renderPaginationItem = ({
  item,
  variant,
  dataTestId,
  icons,
}: {
  item: PaginationRenderItemParams;
  variant: string;
  size: string;
  dataTestId?: string;
  icons: {
    firstIcon?: React.ReactNode;
    lastIcon?: React.ReactNode;
    previousIcon?: React.ReactNode;
    nextIcon?: React.ReactNode;
  };
}) => {
  const { firstIcon, lastIcon, previousIcon, nextIcon } = icons;

    const itemTestId = paginationItemTestId(dataTestId, item);

    if (variant === 'dots') {
      if (item.type === 'page') {
        return (
          <PaginationItem
            {...item}
            data-testid={itemTestId}
            sx={{
              '&.MuiPaginationItem-page': {
                fontSize: 0,
                overflow: 'hidden',
                textIndent: '-9999px',
              },
            }}
          />
        );
      }
      return null; // Hide navigation buttons for dots
    }

    // Map custom icons to components
    const iconMap: Record<string, React.ReactElement> = {
      first: firstIcon as React.ReactElement,
      last: lastIcon as React.ReactElement,
      previous: previousIcon as React.ReactElement,
      next: nextIcon as React.ReactElement,
    };

    return (
      <PaginationItem
        {...item}
        data-testid={itemTestId}
        components={{
          first: () => iconMap.first || <FirstPage />,
          last: () => iconMap.last || <LastPage />,
          previous: () => iconMap.previous || <NavigateBefore />,
          next: () => iconMap.next || <NavigateNext />,
        }}
      />
    );
  
};

// One place for the three-way size choice the sub-parts each make.
const bySize = <T,>(size: PaginationProps['size'], choices: { sm: T; md: T; lg: T }): T =>
  size === 'sm' ? choices.sm : size === 'lg' ? choices.lg : choices.md;

// Prop defaults live in these resolvers rather than the component's parameter
// list: nineteen `= default` branches leave no complexity budget for the render.
type Chrome = Pick<
  PaginationProps,
  | 'variant'
  | 'size'
  | 'color'
  | 'showPageInfo'
  | 'pageInfoFormat'
  | 'showItemsPerPage'
  | 'itemsPerPageOptions'
  | 'itemsPerPage'
>;

const resolveChrome = ({
  variant = 'default',
  size = 'md',
  color = 'primary',
  showPageInfo = false,
  pageInfoFormat = (page, count) => `Page ${page} of ${count}`,
  showItemsPerPage = false,
  itemsPerPageOptions = [10, 25, 50, 100],
  itemsPerPage = 10,
}: Chrome) => ({
  variant,
  size,
  color,
  showPageInfo,
  pageInfoFormat,
  showItemsPerPage,
  itemsPerPageOptions,
  itemsPerPage,
});

type Icons = Pick<PaginationProps, 'firstIcon' | 'lastIcon' | 'previousIcon' | 'nextIcon'>;

const resolveIcons = ({
  firstIcon = <FirstPage />,
  lastIcon = <LastPage />,
  previousIcon = <NavigateBefore />,
  nextIcon = <NavigateNext />,
}: Icons) => ({ firstIcon, lastIcon, previousIcon, nextIcon });

type Navigation = Pick<
  PaginationProps,
  | 'boundaryCount'
  | 'siblingCount'
  | 'hideNextButton'
  | 'hidePrevButton'
  | 'showFirstButton'
  | 'showLastButton'
  | 'disabled'
>;

const resolveNavigation = ({
  boundaryCount = 1,
  siblingCount = 1,
  hideNextButton = false,
  hidePrevButton = false,
  showFirstButton = false,
  showLastButton = false,
  disabled = false,
}: Navigation) => ({
  boundaryCount,
  siblingCount,
  hideNextButton,
  hidePrevButton,
  showFirstButton,
  showLastButton,
  disabled,
});

// The dots variant shows no numbered pages, so it drops the sibling/boundary
// counts and the step buttons that only make sense alongside them.
const applyDotsVariant = (
  navigation: ReturnType<typeof resolveNavigation>,
  dots: boolean,
) => ({
  ...navigation,
  boundaryCount: dots ? 0 : navigation.boundaryCount,
  siblingCount: dots ? 0 : navigation.siblingCount,
  hideNextButton: navigation.hideNextButton || dots,
  hidePrevButton: navigation.hidePrevButton || dots,
  showFirstButton: navigation.showFirstButton && !dots,
  showLastButton: navigation.showLastButton && !dots,
});

const ItemsPerPageSelect: React.FC<{
  size: PaginationProps['size'];
  itemsPerPage: number;
  options: number[];
  disabled: boolean;
  dataTestId?: string;
  onChange?: (value: number) => void;
}> = ({ size, itemsPerPage, options, disabled, dataTestId, onChange }) => {
  if (!onChange) return null;

  return (
    <ItemsPerPageContainer>
      <Typography variant="body2" color="text.secondary">
        Show:
      </Typography>
      <FormControl size="small" sx={{ minWidth: 80 }}>
        <Select
          value={itemsPerPage}
          onChange={(e) => onChange(e.target.value as number)}
          disabled={disabled}
          data-testid={dataTestId ? `${dataTestId}-items-per-page` : 'pagination-items-per-page'}
          sx={{
            '& .MuiSelect-select': {
              fontSize: bySize(size, { sm: '0.875rem', md: '1rem', lg: '1.125rem' }),
              py: bySize(size, { sm: 0.5, md: 1, lg: 1.5 }),
            },
          }}
        >
          {options.map((option) => (
            <MenuItem key={option} value={option}>
              {option}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </ItemsPerPageContainer>
  );
};

const PageInfo: React.FC<{
  size: PaginationProps['size'];
  page: number;
  count: number;
  format: NonNullable<PaginationProps['pageInfoFormat']>;
  dataTestId?: string;
}> = ({ size, page, count, format, dataTestId }) => (
  <PageInfoContainer>
    <Typography
      variant="body2"
      color="text.secondary"
      fontSize={bySize(size, { sm: '0.75rem', md: '0.875rem', lg: '1rem' })}
      data-testid={dataTestId ? `${dataTestId}-info` : 'pagination-info'}
    >
      {format(page, count)}
    </Typography>
  </PageInfoContainer>
);

export const Pagination = React.forwardRef<HTMLElement, PaginationProps>(
  (
    {
      variant, size, page, count, onChange, boundaryCount, siblingCount,
      hideNextButton, hidePrevButton, showFirstButton, showLastButton,
      firstIcon, lastIcon, previousIcon, nextIcon, disabled, color,
      showPageInfo, pageInfoFormat, showItemsPerPage, itemsPerPageOptions,
      itemsPerPage, onItemsPerPageChange, className, dataTestId, ...props
    },
    ref,
  ) => {
    const chrome = resolveChrome({
      variant, size, color, showPageInfo, pageInfoFormat,
      showItemsPerPage, itemsPerPageOptions, itemsPerPage,
    });
    const icons = resolveIcons({ firstIcon, lastIcon, previousIcon, nextIcon });
    const navigation = applyDotsVariant(
      resolveNavigation({
        boundaryCount, siblingCount, hideNextButton, hidePrevButton,
        showFirstButton, showLastButton, disabled,
      }),
      chrome.variant === 'dots',
    );

    const renderItem = (item: PaginationRenderItemParams) =>
      renderPaginationItem({ item, variant: chrome.variant, size: chrome.size, dataTestId, icons });

    return (
      <PaginationContainer className={className} data-testid={dataTestId || 'pagination'}>
        {chrome.showItemsPerPage && (
          <ItemsPerPageSelect
            size={chrome.size}
            itemsPerPage={chrome.itemsPerPage}
            options={chrome.itemsPerPageOptions}
            disabled={navigation.disabled}
            dataTestId={dataTestId}
            onChange={onItemsPerPageChange}
          />
        )}

        <StyledPagination
          ref={ref}
          page={page}
          count={count}
          onChange={onChange}
          customVariant={chrome.variant}
          customSize={chrome.size}
          variant="outlined"
          size={bySize(chrome.size, { sm: 'small', md: 'medium', lg: 'large' })}
          color={chrome.color}
          renderItem={renderItem}
          {...navigation}
          {...props}
        />

        {chrome.showPageInfo && (
          <PageInfo
            size={chrome.size}
            page={page}
            count={count}
            format={chrome.pageInfoFormat}
            dataTestId={dataTestId}
          />
        )}
      </PaginationContainer>
    );
  },
);

Pagination.displayName = 'Pagination';
