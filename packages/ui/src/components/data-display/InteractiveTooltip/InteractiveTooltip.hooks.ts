import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { InteractiveTooltipProps } from './InteractiveTooltip.types';

type TooltipDefaultedKeys = 'variant' | 'size' | 'glow' | 'pulse' | 'maxWidth' | 'clickable';

type ResolvedTooltipProps = InteractiveTooltipProps &
  Required<Pick<InteractiveTooltipProps, TooltipDefaultedKeys>>;

const TOOLTIP_DEFAULTS: Pick<InteractiveTooltipProps, TooltipDefaultedKeys> = {
  variant: 'default',
  size: 'md',
  glow: false,
  pulse: false,
  maxWidth: 300,
  clickable: true,
};

// Strips explicitly-undefined props before the merge, so `size={undefined}` still
// falls back to the default exactly as a destructuring default would.
const definedProps = (props: InteractiveTooltipProps): Partial<InteractiveTooltipProps> =>
  Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Partial<InteractiveTooltipProps>;

export const resolveTooltipProps = (
  props: InteractiveTooltipProps,
): ResolvedTooltipProps =>
  ({ ...TOOLTIP_DEFAULTS, ...definedProps(props) }) as ResolvedTooltipProps;

interface PinOptions {
  clickable: boolean;
  onPin?: () => void;
  onUnpin?: () => void;
}

/**
 * Clicking the trigger pins the tooltip open; clicking anywhere that is neither
 * the tooltip nor the trigger unpins it. The listener only exists while pinned,
 * so an unpinned tooltip costs nothing on every document click.
 */
export const usePinnedTooltip = ({ clickable, onPin, onUnpin }: PinOptions) => {
  const [isPinned, setIsPinned] = useState(false);
  const [isControlledOpen, setIsControlledOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isPinned || !clickable) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      const targetElement = event.target as Element;

      // Check if click was on tooltip or trigger
      const isClickOnTooltip = targetElement.closest('[role="tooltip"]');
      const isClickOnTrigger = wrapperRef.current?.contains(targetElement);

      if (isClickOnTooltip || isClickOnTrigger) {
        return;
      }

      // Click was outside - unpin
      setIsPinned(false);
      setIsControlledOpen(false);
      onUnpin?.();
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isPinned, clickable, onUnpin]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!clickable) return;

      e.preventDefault();
      e.stopPropagation();

      setIsPinned((current) => {
        const newPinned = !current;
        setIsControlledOpen(newPinned);

        if (newPinned) {
          onPin?.();
        } else {
          onUnpin?.();
        }

        return newPinned;
      });
    },
    [clickable, onPin, onUnpin],
  );

  return { isPinned, isControlledOpen, wrapperRef, handleClick };
};
