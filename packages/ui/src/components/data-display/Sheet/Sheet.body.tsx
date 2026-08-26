import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import React from 'react';

import { SheetContent, SheetFooter, SheetHeader } from './Sheet.parts';
import type { SheetProps } from './Sheet.types';
import { muiColor } from '../../../tokens/scales';

export interface SheetBodyProps extends Pick<
  SheetProps,
  | 'title'
  | 'description'
  | 'showCloseButton'
  | 'showHandle'
  | 'header'
  | 'footer'
  | 'loading'
  | 'color'
  | 'children'
  | 'onClick'
  | 'onFocus'
  | 'onBlur'
> {
  testId: string;
  isDragging: boolean;
  isVerticalSheet: boolean;
  isDraggableVariant: boolean;
  onClose: () => void;
  onDragStart: (e: React.MouseEvent | React.TouchEvent) => void;
}

/**
 * The header earns its place if it would show anything at all — a grab handle,
 * either piece of text, the close button, or caller-supplied content.
 */
const needsHeader = (props: SheetBodyProps) =>
  Boolean(
    props.showHandle ||
    props.title ||
    props.description ||
    props.showCloseButton ||
    props.header,
  );

/** The centred spinner shown in place of the children while `loading`. */
const SheetLoading: React.FC<Pick<SheetBodyProps, 'color'>> = ({ color }) => (
  <Box
    sx={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: 200,
    }}
  >
    <CircularProgress color={color === undefined ? undefined : muiColor(color, 'inherit')} />
  </Box>
);

/**
 * What the sheet contains, independent of which drawer is carrying it. The
 * swipeable and plain branches render exactly this — they differ only in the
 * MUI component and its swipe props, so the contents are built once.
 */
export const SheetBody: React.FC<SheetBodyProps> = (props) => {
  const {
    title,
    description,
    showCloseButton,
    showHandle,
    header,
    footer,
    loading,
    color,
    children,
    onClick,
    onFocus,
    onBlur,
    testId,
    isDragging,
    isVerticalSheet,
    isDraggableVariant,
    onClose,
    onDragStart,
  } = props;

  return (
    <Box
      onClick={onClick}
      onFocus={onFocus}
      onBlur={onBlur}
      data-testid={testId}
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        userSelect: isDragging ? 'none' : 'auto',
      }}
    >
      {needsHeader(props) && (
        <SheetHeader
          title={title}
          description={description}
          showCloseButton={showCloseButton}
          onClose={onClose}
          showHandle={showHandle && isVerticalSheet}
          isDraggable={isDraggableVariant && isVerticalSheet}
          onDragStart={onDragStart}
          dataTestId={`${testId}-header`}
        >
          {header}
        </SheetHeader>
      )}

      <SheetContent padded dataTestId={`${testId}-content`}>
        {loading ? <SheetLoading color={color} /> : children}
      </SheetContent>

      {footer && (
        <SheetFooter sticky divider dataTestId={`${testId}-footer`}>
          {footer}
        </SheetFooter>
      )}
    </Box>
  );
};
