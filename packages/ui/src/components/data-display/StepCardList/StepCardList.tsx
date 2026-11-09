'use client';

import Box from '@mui/material/Box/index.js';
import { useTheme, type SxProps, type Theme } from '@mui/material/styles/index.js';
import React, { useEffect, useRef } from 'react';

import { rem, sxRem } from '../../../tokens/relative';
import { followBlock } from '../../../utils/reveal-block';
import { Card } from '../../layout/Card/Card';
import { Text } from '../../typography/Text/Text';

import type { StepCardItem, StepCardListProps, StepCardState } from './StepCardList.types';

/** Material's `Check` glyph, drawn in place so the list pulls in no icon chunk. */
const CHECK_PATH = 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z';
/** Material's `PriorityHigh` glyph, the error marker's exclamation mark. */
const ERROR_PATH = 'M12 2c-1.1 0-2 .9-2 2v9c0 1.1.9 2 2 2s2-.9 2-2V4c0-1.1-.9-2-2-2zm0 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4z';

const markerSx = {
  width: sxRem(26),
  height: sxRem(26),
  borderRadius: '50%',
  flexShrink: 0,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
} as const;

/** The marker's look per state: filled when done or wrong, outlined otherwise. */
const markerLookSx: Readonly<Record<StepCardState, object>> = {
  done: { bgcolor: 'primary.main', color: 'primary.contrastText' },
  error: { bgcolor: 'error.main', color: 'error.contrastText' },
  current: { borderWidth: sxRem(2), borderStyle: 'solid', borderColor: 'primary.main', color: 'primary.main' },
  todo: { borderWidth: sxRem(2), borderStyle: 'solid', borderColor: 'divider', color: 'text.secondary' },
};

/** The card's own edge and surface per state. */
const cardLookSx: Readonly<Record<StepCardState, object>> = {
  // No padding of its own: the button inside is the whole card.
  done: { p: 0, overflow: 'hidden' },
  error: { p: 0, overflow: 'hidden', borderColor: 'error.main' },
  // `visible`, not the card's `hidden`: a clipping box is the scroll container a
  // `sticky` child pins to, and a step's face may pin its own bar from inside.
  current: { p: 1.75, boxShadow: 1, overflow: 'visible' },
  todo: { px: 1.75, py: 1.5, borderStyle: 'dashed', bgcolor: 'action.hover' },
};

const rowSx = { display: 'flex', alignItems: 'center', gap: 1.5 } as const;
const doneRowSx = { ...rowSx, alignItems: 'flex-start' } as const;

/** The done card AS a button: a native one reset to read as the card. */
const doneButtonSx = {
  ...doneRowSx,
  width: '100%',
  m: 0,
  px: 1.75,
  py: 1.5,
  border: 0,
  bgcolor: 'transparent',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  '&:hover': { bgcolor: 'action.hover' },
  '&:focus-visible': { outlineWidth: sxRem(2), outlineStyle: 'solid', outlineColor: 'primary.main', outlineOffset: sxRem(-2) },
} as const;

/**
 * The visible "change" word at the card's end: a label inside the button, not a
 * second control. It gives up some padding in a container narrower than `sm`.
 */
function changeWordSx(theme: Theme): SxProps<Theme> {
  return {
    flexShrink: 0,
    alignSelf: 'center',
    color: 'primary.main',
    typography: 'body2',
    fontWeight: 600,
    py: 1,
    px: 1,
    [`@container (max-width: ${rem(theme, theme.breakpoints.values.sm)})`]: { px: 0.5 },
  };
}

const headingSx = { m: 0, outline: 'none', typography: 'body1', fontWeight: 700 } as const;

function Marker({ state, number }: { state: StepCardState; number: number }): React.JSX.Element {
  const glyph = state === 'done' ? CHECK_PATH : state === 'error' ? ERROR_PATH : null;
  return (
    // A span: on a done card it sits inside a <button>, which holds phrasing content only.
    <Box component="span" aria-hidden sx={{ ...markerSx, ...markerLookSx[state] }}>
      {glyph ? (
        <Box component="svg" viewBox="0 0 24 24" sx={{ width: sxRem(16), height: sxRem(16), fill: 'currentColor' }}>
          <path d={glyph} />
        </Box>
      ) : (
        <Box component="span" sx={{ typography: 'body2', fontWeight: 700, color: 'inherit' }}>
          {number}
        </Box>
      )}
    </Box>
  );
}

interface RowProps {
  item: StepCardItem;
  number: number;
  testId: string;
}

/** The done card: what was answered, and the way back to it. */
function DoneRow({ item, number, testId }: RowProps): React.JSX.Element {
  const theme = useTheme();
  const wrong = item.state === 'error';
  const errorId = `${testId}-error`;
  const body = (
    <>
      <Marker state={item.state} number={number} />
      <Box component="span" sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
        <Text as="span" size="xs" color="secondary">
          {item.caption ?? `${number} · ${item.title}`}
        </Text>
        {item.answer ? (
          <Text as="span" size="md" weight="semibold" dataTestId={`${testId}-answer`}>
            {item.answer}
          </Text>
        ) : null}
        {item.detail ? (
          <Text as="span" size="xs" color="secondary" dataTestId={`${testId}-detail`}>
            {item.detail}
          </Text>
        ) : null}
        {wrong && item.error ? (
          <Text as="span" id={errorId} size="xs" color="danger" dataTestId={errorId}>
            {item.error}
          </Text>
        ) : null}
      </Box>
    </>
  );
  if (!item.onChange) return <Box sx={{ ...doneRowSx, px: 1.75, py: 1.5 }}>{body}</Box>;
  return (
    <Box
      component="button"
      type="button"
      onClick={item.onChange}
      aria-label={item.changeAriaLabel}
      aria-describedby={wrong && item.error ? errorId : undefined}
      data-testid={`${testId}-change`}
      sx={doneButtonSx}
    >
      {body}
      {item.changeLabel ? (
        <Box component="span" sx={changeWordSx(theme)} data-testid={`${testId}-change-label`}>
          {item.changeLabel}
        </Box>
      ) : null}
    </Box>
  );
}

interface CurrentProps extends RowProps {
  /** The step took the current place after the list was drawn (or `focusOnMount` asked for it). */
  arrived: boolean;
  headingLevel: number;
  reveal: StepCardListProps['reveal'];
  revealWatch: StepCardListProps['revealWatch'];
}

/**
 * The current card. When the step ARRIVES (after "continue" or "change") its
 * heading takes focus, so a keyboard or screen-reader user is not left on
 * `<body>` by the card they pressed being redrawn, and the card is revealed.
 */
function CurrentBody({ item, number, arrived, headingLevel, reveal, revealWatch }: CurrentProps): React.JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null);
  const card = useRef<HTMLDivElement>(null);
  // Held in a ref: the effect must run on arrival only, not whenever the caller
  // passes a new options object.
  const revealRef = useRef({ reveal, revealWatch });
  revealRef.current = { reveal, revealWatch };
  // The card mounts when its step becomes current, so `arrived` is read once.
  const arrivedOnMount = useRef(arrived).current;
  useEffect(() => {
    if (!arrivedOnMount) return undefined;
    heading.current?.focus({ preventScroll: true });
    const { reveal: options, revealWatch: watch } = revealRef.current;
    if (options === false) return undefined;
    return followBlock(card.current, { ...options, watch });
  }, [arrivedOnMount]);
  return (
    <Box ref={card} sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
      <Box sx={rowSx}>
        <Marker state="current" number={number} />
        <Box ref={heading} component={`h${headingLevel}` as 'h2'} tabIndex={-1} sx={headingSx}>
          {item.title}
        </Box>
      </Box>
      {item.children}
    </Box>
  );
}

/**
 * A list of steps shown all at once, each as a card: the answered ones collapse
 * into a button that reopens them, the current one draws its face, the rest wait
 * dashed. Everything a visitor reads is passed in; the list has no copy of its own.
 */
export function StepCardList({
  items,
  reveal,
  revealWatch,
  focusOnMount = false,
  headingLevel = 2,
  'aria-label': ariaLabel,
  dataTestId = 'step-card-list',
}: StepCardListProps): React.JSX.Element {
  // Drawn before the first commit, a current step is the page's landing step;
  // drawn after it, the step ARRIVED. Read at render, set after the first commit.
  const drawn = useRef(false);
  const landed = drawn.current;
  useEffect(() => {
    drawn.current = true;
  }, []);
  return (
    <Box
      component="ol"
      aria-label={ariaLabel}
      data-testid={dataTestId}
      // The container the "change" word measures against, not the viewport.
      sx={{ containerType: 'inline-size', listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1.25 }}
    >
      {items.map((item, index) => {
        const number = index + 1;
        const testId = `${dataTestId}-${item.id}`;
        const isCurrent = item.state === 'current';
        return (
          <Box
            component="li"
            key={item.id}
            data-testid={testId}
            data-state={item.state}
            aria-current={isCurrent ? 'step' : undefined}
            sx={{ listStyle: 'none' }}
          >
            <Card variant="outlined" sx={{ ...cardLookSx[item.state], borderRadius: 3 }}>
              {item.state === 'done' || item.state === 'error' ? <DoneRow item={item} number={number} testId={testId} /> : null}
              {item.state === 'todo' ? (
                <Box sx={rowSx}>
                  <Marker state="todo" number={number} />
                  <Text as="span" size="md" color="secondary">
                    {item.title}
                  </Text>
                </Box>
              ) : null}
              {isCurrent ? (
                <CurrentBody
                  item={item}
                  number={number}
                  testId={testId}
                  arrived={landed || focusOnMount}
                  headingLevel={headingLevel}
                  reveal={reveal}
                  revealWatch={revealWatch}
                />
              ) : null}
            </Card>
          </Box>
        );
      })}
    </Box>
  );
}
