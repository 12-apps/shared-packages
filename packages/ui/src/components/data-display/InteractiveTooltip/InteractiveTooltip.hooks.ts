import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { InteractiveTooltipProps } from './InteractiveTooltip.types';

// `maxWidth` defaults where it is read (`tooltipCap`), in design px through the theme.
type TooltipDefaultedKeys = 'variant' | 'size' | 'glow' | 'pulse' | 'clickable';

type ResolvedTooltipProps = InteractiveTooltipProps &
  Required<Pick<InteractiveTooltipProps, TooltipDefaultedKeys>>;

const TOOLTIP_DEFAULTS: Pick<InteractiveTooltipProps, TooltipDefaultedKeys> = {
  variant: 'default',
  size: 'md',
  glow: false,
  pulse: false,
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

type OnOpen = NonNullable<InteractiveTooltipProps['onOpen']>;
type OnClose = NonNullable<InteractiveTooltipProps['onClose']>;

/**
 * The hover half of the tooltip's open state, so the MUI Tooltip is controlled
 * from its first render (FUT-3013). It used to receive `open={undefined}` while
 * hovering and a boolean once pinned, which MUI reports as a component switching
 * from uncontrolled to controlled on the first click. The caller's own
 * onOpen/onClose still run.
 *
 * Unpinning also closes it: the hover listeners are off while pinned, so a
 * hover state left `true` from before the pin would otherwise keep the tooltip
 * open after the click outside that unpinned it.
 */
export const useHoverOpen = (
  isPinned: boolean,
  onOpen?: OnOpen,
  onClose?: OnClose,
): { open: boolean; onOpen: OnOpen; onClose: OnClose } => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!isPinned) setOpen(false);
  }, [isPinned]);
  return {
    open,
    onOpen: (event) => {
      setOpen(true);
      onOpen?.(event);
    },
    onClose: (event) => {
      setOpen(false);
      onClose?.(event);
    },
  };
};
