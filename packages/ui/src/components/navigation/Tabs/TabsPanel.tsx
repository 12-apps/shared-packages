import { Box, CircularProgress, Fade } from '@mui/material';
import { alpha, styled } from '@mui/material/styles';
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

  const content = loading
    ? loadingComponent || (
        <LoadingContainer>
          <CircularProgress size={32} />
        </LoadingContainer>
      )
    : children;

  const testId = dataTestId ? `${dataTestId}-panel-${index}` : `tabs-panel-${index}`;

  if (animate) {
    return (
      <Fade in={isActive} timeout={animationDuration}>
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
      </Fade>
    );
  }

  return (
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
};
