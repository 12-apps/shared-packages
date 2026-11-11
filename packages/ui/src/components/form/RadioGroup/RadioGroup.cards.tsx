import Box from '@mui/material/Box/index.js';
import Card from '@mui/material/Card/index.js';
import { styled } from '@mui/material/styles/index.js';
import React, { useRef } from 'react';

import { radioCardSx } from './RadioGroup.styles';
import type { SurfaceFlags } from './RadioGroup.styles';
import type { RadioOption } from './RadioGroup.types';
import { CardBody, testId, type VariantProps } from './RadioGroup.variants';

/**
 * `variant="cards"` as a real radio group (FUT-4477): the container is a
 * `radiogroup` named by the group's label (or the caller's `aria-label`), each
 * card a `radio` with `aria-checked`, one Tab stop (the checked card, else the
 * first enabled one), arrows/Home/End move AND choose — as native radios do —
 * Space or Enter chooses the focused card, and a visible focus ring. It used to
 * be clickable cards with no role and no keyboard.
 */

const StyledRadioCard = styled(Card, {
  shouldForwardProp: (prop) =>
    !['selected', 'customColor', 'glass', 'gradient', 'glow', 'customSize', 'animated'].includes(
      prop as string,
    ),
})<SurfaceFlags>(({ theme, ...flags }) => ({ ...radioCardSx(theme, flags) }));

const NEXT: Readonly<Record<string, 1 | -1>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** The next enabled option from `from` in direction `step`, wrapping; `from` when none is. */
function nextEnabled(options: readonly RadioOption[], from: number, step: 1 | -1): number {
  for (let hop = 1; hop <= options.length; hop += 1) {
    const index = (from + step * hop + options.length) % options.length;
    if (!options[index]?.disabled) return index;
  }
  return from;
}

/** Where a key takes the choice, or null for a key the group does not answer. */
function target(options: readonly RadioOption[], from: number, key: string): number | null {
  const step = NEXT[key];
  if (step) return nextEnabled(options, from, step);
  if (key === 'Home') return nextEnabled(options, -1, 1);
  if (key === 'End') return nextEnabled(options, options.length, -1);
  return null;
}

export const CardRadios: React.FC<VariantProps> = ({
  options, value, color, size, direction, showDescriptions, glass, gradient, glow, dataTestId, onSelect,
  label, rest, indicator,
}) => {
  const group = useRef<HTMLDivElement>(null);
  const checked = options.findIndex((option) => option.value === value);
  const stop = checked >= 0 ? checked : nextEnabled(options, -1, 1);
  const choose = (index: number, focus: boolean): void => {
    const option = options[index];
    if (!option || option.disabled) return;
    if (focus) group.current?.querySelectorAll<HTMLElement>('[role="radio"]')[index]?.focus();
    onSelect(option);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const focused = Number((event.target as HTMLElement).dataset.index ?? stop);
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      choose(focused, false);
      return;
    }
    const next = target(options, focused, event.key);
    if (next === null) return;
    event.preventDefault();
    choose(next, true);
  };
  const named = (rest?.['aria-label'] as string | undefined) ?? label;
  return (
    <Box
      ref={group}
      role="radiogroup"
      aria-label={named}
      onKeyDown={onKeyDown}
      sx={{ display: 'flex', flexDirection: direction, gap: 2, '& > *': direction === 'row' ? { flex: '1 1 0', minWidth: 0 } : {} }}
      data-testid={testId(dataTestId, 'container')}
    >
      {options.map((option, index) => {
        const isSelected = value === option.value;
        return (
          <StyledRadioCard
            key={option.value}
            role="radio"
            aria-checked={isSelected}
            aria-disabled={option.disabled || undefined}
            tabIndex={index === stop ? 0 : -1}
            data-index={index}
            selected={isSelected}
            customColor={color}
            glass={glass}
            gradient={gradient}
            glow={glow}
            customSize={size}
            animated
            data-testid={testId(dataTestId, `card-${index}`)}
            onClick={() => choose(index, false)}
          >
            <CardBody
              option={option}
              index={index}
              isSelected={isSelected}
              color={color}
              showDescriptions={showDescriptions}
              dataTestId={dataTestId}
              indicator={indicator}
            />
          </StyledRadioCard>
        );
      })}
    </Box>
  );
};
