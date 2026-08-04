import { Box, CircularProgress, Fade } from '@mui/material';
import { styled } from '@mui/material/styles';
import React from 'react';

import type { TabPanelProps } from './Tabs.types';

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

const LoadingContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 200,
  color: theme.palette.text.secondary,
}));

// A loading panel shows the caller's placeholder, or a spinner if there isn't one.
const panelContent = (
  loading: boolean,
  loadingComponent: React.ReactNode,
  children: React.ReactNode,
): React.ReactNode => {
  if (!loading) return children;

  return (
    loadingComponent || (
      <LoadingContainer>
        <CircularProgress size={32} />
      </LoadingContainer>
    )
  );
};

const panelTestId = (dataTestId: string | undefined, index: number): string =>
  dataTestId ? `${dataTestId}-panel-${index}` : `tabs-panel-${index}`;

export const CustomTabPanel: React.FC<TabPanelProps & { dataTestId?: string; index: number }> = ({
  children,
  id,
  value,
  animate = false,
  animationDuration = 300,
  persist = false,
  loading = false,
  loadingComponent,
  className,
  dataTestId,
  index,
  ...props
}) => {
  const isActive = value === id;
  const shouldRender = isActive || persist;

  if (!shouldRender) {
    return null;
  }

  const content = panelContent(loading, loadingComponent, children);
  const testId = panelTestId(dataTestId, index);

  const panel = (
    <TabPanel
      role="tabpanel"
      hidden={!isActive}
      id={`tabpanel-${id}`}
      aria-labelledby={`tab-${id}`}
      animate={animate}
      persist={persist}
      className={className}
      data-testid={testId}
      {...props}
    >
      {content}
    </TabPanel>
  );

  // The animated and plain panels are the same element; only the Fade wrapper
  // differs.
  if (!animate) return panel;

  return (
    <Fade in={isActive} timeout={animationDuration}>
      {panel}
    </Fade>
  );
};
