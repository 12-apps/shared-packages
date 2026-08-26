import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import type { FC, ReactNode } from 'react';
import React from 'react';

const EMPTY_MIN_HEIGHT = 200;

const EmptyState: FC<{ children: ReactNode }> = ({ children }) => {
  const theme = useTheme();

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        minHeight: EMPTY_MIN_HEIGHT,
        color: theme.palette.text.secondary,
      }}
    >
      {children}
    </Box>
  );
};

// VirtualList and VirtualGrid scroll themselves by default. When one is nested
// here that would mean two scrollers, so they are handed this container instead
// and told to stop scrolling internally. They are recognised by the props they
// accept rather than by identity, so a wrapper around one still works.
const wantsScrollContainer = (props: Record<string, unknown>): boolean =>
  'disableInternalScroll' in props || props.scrollContainerRef !== undefined;

export interface ScrollAreaContentProps {
  children: ReactNode;
  emptyContent?: ReactNode;
  scrollRef: React.RefObject<HTMLDivElement | null> | ((node: HTMLDivElement | null) => void);
  containerWidth: number;
}

export const ScrollAreaContent: FC<ScrollAreaContentProps> = ({
  children,
  emptyContent,
  scrollRef,
  containerWidth,
}) => {
  if (!children && emptyContent) return <EmptyState>{emptyContent}</EmptyState>;

  return (
    <>
      {React.Children.map(children, (child) => {
        if (!React.isValidElement(child)) return child;

        const childProps = child.props as Record<string, unknown>;
        if (!wantsScrollContainer(childProps)) return child;

        const enhanced: Record<string, unknown> = {
          scrollContainerRef: scrollRef,
          disableInternalScroll: true,
        };

        // Only fill in a measured width where the child is still at its default.
        if (containerWidth > 0 && childProps.width === '100%') {
          enhanced.width = containerWidth;
        }

        return React.cloneElement(child, enhanced);
      })}
    </>
  );
};
