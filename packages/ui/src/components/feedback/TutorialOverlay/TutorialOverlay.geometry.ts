const DEFAULT_PADDING = 16;

export const getElementBounds = (selector: string): globalThis.DOMRect | null =>
  document.querySelector(selector)?.getBoundingClientRect() ?? null;

// With placement 'auto', the side with the most free space around the target
// wins.
const pickPlacement = (targetBounds: globalThis.DOMRect): string => {
  const spaces = {
    top: targetBounds.top,
    bottom: window.innerHeight - targetBounds.bottom,
    left: targetBounds.left,
    right: window.innerWidth - targetBounds.right,
  };

  return Object.entries(spaces).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
};

const offsetFor = (
  placement: string,
  targetBounds: globalThis.DOMRect,
  tooltipBounds: globalThis.DOMRect,
  padding: number,
): { top: number; left: number } => {
  const centredLeft = targetBounds.left + targetBounds.width / 2 - tooltipBounds.width / 2;
  const centredTop = targetBounds.top + targetBounds.height / 2 - tooltipBounds.height / 2;

  switch (placement) {
    case 'top':
      return { top: targetBounds.top - tooltipBounds.height - padding, left: centredLeft };
    case 'bottom':
      return { top: targetBounds.bottom + padding, left: centredLeft };
    case 'left':
      return { top: centredTop, left: targetBounds.left - tooltipBounds.width - padding };
    case 'right':
      return { top: centredTop, left: targetBounds.right + padding };
    default:
      return { top: 0, left: 0 };
  }
};

// Keeps the tooltip fully on screen, whatever the chosen side works out to.
const clampToViewport = (
  position: { top: number; left: number },
  tooltipBounds: globalThis.DOMRect,
  padding: number,
) => ({
  top: Math.max(padding, Math.min(position.top, window.innerHeight - tooltipBounds.height - padding)),
  left: Math.max(padding, Math.min(position.left, window.innerWidth - tooltipBounds.width - padding)),
});

export const calculateTooltipPosition = (
  targetBounds: globalThis.DOMRect,
  tooltipBounds: globalThis.DOMRect,
  placement: string,
  padding = DEFAULT_PADDING,
) => {
  const finalPlacement = placement === 'auto' ? pickPlacement(targetBounds) : placement;
  const offset = offsetFor(finalPlacement, targetBounds, tooltipBounds, padding);

  return {
    position: clampToViewport(offset, tooltipBounds, padding),
    placement: finalPlacement,
  };
};
