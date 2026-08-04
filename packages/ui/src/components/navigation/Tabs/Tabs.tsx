import Close from '@mui/icons-material/Close';
import {
  alpha,
  Badge,
  Box,
  CircularProgress,
  Divider,
  Fade,
  Tab as MuiTab,
  Tabs as MuiTabs,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import React from 'react';

import { CustomTabPanel } from './TabsPanel';
import { tabsRootStyles } from './Tabs.styles';
import type { TabItem, TabsProps } from './Tabs.types';

const StyledTabs = styled(MuiTabs, {
  shouldForwardProp: (prop) => !['customVariant', 'size', 'showDividers'].includes(prop as string),
})<{ customVariant?: string; size?: string; showDividers?: boolean }>(
  ({ theme, customVariant, size, showDividers }) => ({
    ...tabsRootStyles({ theme, customVariant, size, showDividers }),
  }),
);

const TabPanel = styled(Box, {
  shouldForwardProp: (prop) => !['animate', 'persist'].includes(prop as string),
})<{ animate?: boolean; persist?: boolean }>(({ animate, persist }) => ({
  width: '100%',

  ...(animate && {
    transition: 'all 0.3s ease-in-out',
  }),

  ...(persist && {
    '&[hidden]': {
      display: 'none !important',
    },
  }),
}));

const CloseButton = styled(Box)(({ theme }) => ({
  marginLeft: theme.spacing(0.5),
  padding: theme.spacing(0.25),
  width: 20,
  height: 20,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  borderRadius: '50%',
  color: theme.palette.action.active,
  '&:hover': {
    backgroundColor: alpha(theme.palette.error.main, 0.1),
    color: theme.palette.error.main,
  },
}));

const BadgeWrapper = styled(Badge)(() => ({
  '& .MuiBadge-badge': {
    right: -6,
    top: 4,
    fontSize: '0.75rem',
    minWidth: 16,
    height: 16,
    padding: 0,
  },
}));

const TABS_DEFAULTS: Partial<TabsProps> = {
  variant: 'default',
  size: 'md',
  color: 'primary',
  fullWidth: false,
  orientation: 'horizontal',
  showDividers: false,
  centered: false,
  scrollable: false,
  scrollButtons: 'auto',
  sticky: false,
  stickyOffset: 0,
  animateContent: false,
  animationDuration: 300,
  persistContent: false,
  disabled: false,
  loading: false,
};

// Strips explicitly-undefined props before the merge, so `prop={undefined}`
// still falls back to the default as a destructuring default would.
const definedProps = (props: TabsProps): Partial<TabsProps> =>
  Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Partial<TabsProps>;

// Once the row is scrollable every accepted scrollButtons value ends up as
// MUI's 'auto'. That is exactly what the previous nested ternary did — it mapped
// 'on'/'off'/'desktop' to 'auto', and its remaining branch could only ever be
// 'auto' anyway — so the behaviour is preserved here rather than quietly
// changed. Worth knowing that scrollButtons="off" therefore still shows buttons.
const resolveScrollButtons = (scrollable?: boolean): 'auto' | false =>
  scrollable ? 'auto' : false;

const buildTabsSx = ({
  fullWidth,
  sticky,
  stickyOffset,
  indicatorColor,
  disabled,
}: {
  fullWidth?: boolean;
  sticky?: boolean;
  stickyOffset?: number;
  indicatorColor?: string;
  disabled?: boolean;
}) => ({
  ...(fullWidth && { width: '100%' }),
  // Pin the tab list while panels scroll beneath it. Opaque background + bottom
  // divider so scrolled content does not show through.
  ...(sticky && {
    position: 'sticky',
    top: stickyOffset,
    zIndex: 2,
    backgroundColor: 'background.default',
    borderBottom: 1,
    borderColor: 'divider',
  }),
  ...(indicatorColor && {
    '& .MuiTabs-indicator': { backgroundColor: indicatorColor },
  }),
  ...(disabled && { opacity: 0.6, pointerEvents: 'none' }),
});

// A tab's label: icon, text, optional close affordance, optionally badged.
const TabLabel: React.FC<{
  item: TabItem;
  onClose: (event: React.MouseEvent | React.KeyboardEvent, tabId: string) => void;
}> = ({ item, onClose }) => {
  const content = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {item.icon}
      <span>{item.label}</span>
      {item.closable && (
        <CloseButton
          onClick={(e) => onClose(e, item.id)}
          role="button"
          tabIndex={0}
          aria-label="Close tab"
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            onClose(e, item.id);
          }}
        >
          <Close fontSize="inherit" />
        </CloseButton>
      )}
    </Box>
  );

  if (item.badge === undefined) return content;

  return (
    <BadgeWrapper badgeContent={item.badge} color="error">
      {content}
    </BadgeWrapper>
  );
};

type ResolvedTabs = TabsProps;

// The tab strip. Kept in this file because StyledTabs cannot cross a module
// boundary (TS2742).
const TabsBar: React.FC<
  ResolvedTabs & {
    rest: Record<string, unknown>;
    onChange: (event: React.SyntheticEvent, newValue: string) => void;
    onCloseTab: (event: React.MouseEvent | React.KeyboardEvent, tabId: string) => void;
  }
> = ({ rest, items, value, onChange, onCloseTab, dataTestId, ...p }) => (
  <StyledTabs
    {...rest}
    value={value}
    onChange={onChange}
    customVariant={p.variant}
    size={p.size}
    showDividers={p.showDividers}
    orientation={p.orientation}
    centered={p.centered}
    // MUI only scrolls when its own `variant` is `scrollable`; map our
    // `scrollable` flag onto it so overflowing tab rows actually scroll.
    variant={p.scrollable ? 'scrollable' : 'standard'}
    data-testid={dataTestId ? `${dataTestId}-list` : 'tabs-list'}
    scrollButtons={resolveScrollButtons(p.scrollable)}
    allowScrollButtonsMobile={p.scrollable}
    textColor={p.color}
    indicatorColor={p.color}
    sx={buildTabsSx({
      fullWidth: p.fullWidth,
      sticky: p.sticky,
      stickyOffset: p.stickyOffset,
      indicatorColor: p.indicatorColor,
      disabled: p.disabled,
    })}
  >
    {items.map((item, index) => (
      <MuiTab
        key={item.id}
        value={item.id}
        label={<TabLabel item={item} onClose={onCloseTab} />}
        disabled={item.disabled || p.disabled}
        className={item.className}
        id={`tab-${item.id}`}
        aria-controls={`tabpanel-${item.id}`}
        aria-disabled={item.disabled || p.disabled}
        data-testid={dataTestId ? `${dataTestId}-tab-${index}` : `tabs-tab-${index}`}
      />
    ))}
  </StyledTabs>
);

const TabsPanels: React.FC<ResolvedTabs> = ({
  items,
  value,
  variant,
  animateContent,
  animationDuration,
  persistContent,
  loading,
  loadingComponent,
  tabPanelProps,
  dataTestId,
}) => (
  <Box sx={{ mt: variant === 'enclosed' ? 0 : 2 }}>
    {items.map((item, index) => (
      <CustomTabPanel
        key={item.id}
        id={item.id}
        value={value}
        animate={animateContent}
        animationDuration={animationDuration}
        persist={persistContent}
        loading={loading}
        loadingComponent={loadingComponent}
        className={tabPanelProps?.className}
        dataTestId={dataTestId}
        index={index}
      >
        {item.content}
      </CustomTabPanel>
    ))}
  </Box>
);

export const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
  (tabsProps, ref) => {
    const resolved = { ...TABS_DEFAULTS, ...definedProps(tabsProps) } as TabsProps;
    const {
      value,
      onChange,
      onTabClose,
      className,
      disabled,
      showDividers,
      variant,
      dataTestId,
      ...rest
    } = resolved;

    const handleChange = (event: React.SyntheticEvent, newValue: string) => {
      if (!disabled) onChange(event, newValue);
    };

    const handleTabClose = (event: React.MouseEvent | React.KeyboardEvent, tabId: string) => {
      event.stopPropagation();
      onTabClose?.(tabId);
    };

    return (
      <Box className={className} ref={ref} data-testid={dataTestId || 'tabs'}>
        <TabsBar
          {...resolved}
          rest={rest as unknown as Record<string, unknown>}
          onChange={handleChange}
          onCloseTab={handleTabClose}
        />

        {showDividers && variant !== 'enclosed' && <Divider />}

        <TabsPanels {...resolved} />
      </Box>
    );
  },
);

Tabs.displayName = 'Tabs';
