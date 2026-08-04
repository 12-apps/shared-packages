import type { FC } from 'react';
import React from 'react';

import type { ZoomState } from './Lightbox.hooks';
import type { LightboxItem } from './Lightbox.types';
import { LightboxMedia } from './LightboxMedia';

export interface LightboxCurrentMediaProps {
  item?: LightboxItem;
  index: number;
  total: number;
  zoomable: boolean;
  zoom: ZoomState;
  testId: (suffix: string) => string;
  onLoadingChange: (loading: boolean) => void;
  onWheel: (event: React.WheelEvent) => void;
}

// Wires the active item to the zoom state. Double-clicking zooms in, or snaps
// back to 1x if already zoomed.
export const LightboxCurrentMedia: FC<LightboxCurrentMediaProps> = ({
  item,
  index,
  total,
  zoomable,
  zoom,
  testId,
  onLoadingChange,
  onWheel,
}) => {
  if (!item) return null;

  return (
    <LightboxMedia
      item={item}
      index={index}
      total={total}
      zoomLevel={zoom.zoomLevel}
      panOffset={zoom.panOffset}
      zoomable={zoomable}
      // Drag-panning is not wired up, so the transform transition is always on.
      isDragging={false}
      testId={testId}
      onLoadStart={() => onLoadingChange(true)}
      onLoaded={() => onLoadingChange(false)}
      onWheel={onWheel}
      onDoubleClick={zoom.zoomLevel > 1 ? zoom.resetZoom : zoom.zoomIn}
    />
  );
};
