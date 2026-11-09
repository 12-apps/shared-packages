'use client';

import Box from '@mui/material/Box/index.js';
import { useTheme, type SxProps, type Theme } from '@mui/material/styles/index.js';
import React, { useEffect, useId, useRef } from 'react';

import { rem, sxRem } from '../../../tokens/relative';
import { followBlock } from '../../../utils/reveal-block';
import { Card } from '../../layout/Card/Card';
import { Text } from '../../typography/Text/Text';

import type { StepCardItem, StepCardListProps, StepCardState } from './StepCardList.types';

/** Material's `Check` glyph, drawn in place so the list pulls in no icon chunk. */
const CHECK_PATH = 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z';

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

/** What a marker draws: a check, or a numbered circle outlined in the step's colour. */
type MarkerKind = 'done' | 'current' | 'todo' | 'invalid';

/** The marker's look: filled when done, outlined otherwise (red when the answer is invalid). */
const markerLookSx: Readonly<Record<MarkerKind, object>> = {
  done: { bgcolor: 'primary.main', color: 'primary.contrastText' },
  invalid: { borderWidth: sxRem(2), borderStyle: 'solid', borderColor: 'error.main', color: 'error.main' },
  current: { borderWidth: sxRem(2), borderStyle: 'solid', borderColor: 'primary.main', color: 'primary.main' },
  todo: { borderWidth: sxRem(2), borderStyle: 'solid', borderColor: 'divider', color: 'text.secondary' },
};

/** The card's own edge and surface per state. */
const cardLookSx: Readonly<Record<StepCardState, object>> = {
  // No padding of its own: the button inside is the whole card.
  done: { p: 0, overflow: 'hidden' },
  // The edge stays neutral: the marker and the error text carry the failure.
  error: { p: 0, overflow: 'hidden' },
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

function Marker({ kind, number }: { kind: MarkerKind; number: number }): React.JSX.Element {
  const glyph = kind === 'done' ? CHECK_PATH : null;
  return (
    // A span: on a done card it sits inside a <button>, which holds phrasing content only.
    <Box component="span" aria-hidden data-marker={kind} sx={{ ...markerSx, ...markerLookSx[kind] }}>
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
  /** Unique per list instance, so two lists on a page never share an `aria-describedby` target. */
  errorId: string;
}

/** The done card's words: caption, bold answer, muted line and, when wrong, the error. */
function DoneText({ item, number, testId, errorId, described }: RowProps & { described: boolean }): React.JSX.Element {
  return (
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
        {item.state === 'error' && item.error ? (
          // Hidden from the button's NAME only when the button describes itself with it;
          // a card with no button has nothing else to read it.
          <Text as="span" id={errorId} aria-hidden={described ? 'true' : undefined} size="xs" color="danger" dataTestId={`${testId}-error`}>
            {item.error}
          </Text>
        ) : null}
      </Box>
  );
}

/** The done card: what was answered, and the way back to it. */
function DoneRow({ item, number, testId, errorId }: RowProps): React.JSX.Element {
  const theme = useTheme();
  const wrong = item.state === 'error';
  const body = (
    <>
      <Marker kind={wrong ? 'invalid' : 'done'} number={number} />
      <DoneText item={item} number={number} testId={testId} errorId={errorId} described={Boolean(item.onChange)} />
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

interface CurrentProps extends Pick<RowProps, 'item' | 'number'> {
  /** The step took the current place after the list was drawn (or `focusOnMount` asked for it). */
  arrived: boolean;
  /** All-open mode: heading and face only, with no focus move and no reveal. */
  quiet: boolean;
  headingLevel: number;
  reveal: StepCardListProps['reveal'];
  revealWatch: StepCardListProps['revealWatch'];
}

/**
 * The open card. When the step ARRIVES (after "continue" or "change") its
 * heading takes focus, so a keyboard or screen-reader user is not left on
 * `<body>` by the card they pressed being redrawn, and the whole card (its
 * `<li>`) is revealed. In `quiet` mode (all steps open) it only draws.
 */
function CurrentBody({ item, number, arrived, quiet, headingLevel, reveal, revealWatch }: CurrentProps): React.JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null);
  // Held in a ref: the effect must run on arrival only, not whenever the caller
  // passes a new options object.
  const revealRef = useRef({ reveal, revealWatch });
  revealRef.current = { reveal, revealWatch };
  // The card mounts when its step becomes current, so `arrived` is read once.
  const arrivedOnMount = useRef(arrived && !quiet).current;
  useEffect(() => {
    if (!arrivedOnMount) return undefined;
    const { reveal: options, revealWatch: watch } = revealRef.current;
    // With the scroll off, focus brings the heading into view itself.
    heading.current?.focus(options === false ? undefined : { preventScroll: true });
    if (options === false) return undefined;
    // The card is the `<li>`: its bottom edge is what a sticky bar must clear.
    return followBlock(heading.current?.closest('li') ?? null, { ...options, watch });
  }, [arrivedOnMount]);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
      <Box sx={rowSx}>
        <Marker kind={item.invalid ?? item.state === 'error' ? 'invalid' : 'current'} number={number} />
        <Box ref={heading} component={`h${headingLevel}` as 'h2'} tabIndex={-1} sx={headingSx}>
          {item.title}
        </Box>
      </Box>
      {item.children}
    </Box>
  );
}

/** A closed card's face: the answer of a done step, or the name of one still to come. */
function ClosedFace(props: RowProps): React.JSX.Element {
  const { item, number } = props;
  if (item.state === 'todo') {
    return (
      <Box sx={rowSx}>
        <Marker kind="todo" number={number} />
        <Text as="span" size="md" color="secondary">
          {item.title}
        </Text>
      </Box>
    );
  }
  return <DoneRow {...props} />;
}

interface StepItemProps extends RowProps, Pick<CurrentProps, 'arrived' | 'headingLevel' | 'reveal' | 'revealWatch'> {
  allOpen: boolean;
}

/** One `<li>`: the card in the look of its state. */
function StepItem({ item, number, testId, errorId, allOpen, ...open }: StepItemProps): React.JSX.Element {
  const isCurrent = item.state === 'current' && !allOpen;
  const isOpen = isCurrent || allOpen;
  return (
    <Box
      component="li"
      data-testid={testId}
      data-state={allOpen ? 'open' : item.state}
      aria-current={isCurrent ? 'step' : undefined}
      sx={{ listStyle: 'none' }}
    >
      <Card variant="outlined" sx={{ ...cardLookSx[isOpen ? 'current' : item.state], borderRadius: 3 }}>
        {isOpen ? null : <ClosedFace item={item} number={number} testId={testId} errorId={errorId} />}
        {isOpen ? <CurrentBody item={item} number={number} quiet={allOpen} {...open} /> : null}
      </Card>
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
  allOpen = false,
  headingLevel = 2,
  'aria-label': ariaLabel,
  dataTestId = 'step-card-list',
}: StepCardListProps): React.JSX.Element {
  // Drawn before the first commit, a current step is the page's landing step;
  // drawn after it, the step ARRIVED. Read at render, set after the first commit.
  const drawn = useRef(false);
  const landed = drawn.current;
  const uid = useId();
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
      {items.map((item, index) => (
        <StepItem
          key={item.id}
          item={item}
          number={index + 1}
          testId={`${dataTestId}-${item.id}`}
          errorId={`${uid}-${item.id}-error`}
          allOpen={allOpen}
          arrived={landed || focusOnMount}
          headingLevel={headingLevel}
          reveal={reveal}
          revealWatch={revealWatch}
        />
      ))}
    </Box>
  );
}
