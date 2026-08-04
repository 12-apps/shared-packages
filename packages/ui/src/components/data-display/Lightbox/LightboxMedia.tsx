import type { FC } from 'react';
import React from 'react';

import type { LightboxItem } from './Lightbox.types';

export interface LightboxMediaProps {
  item: LightboxItem;
  index: number;
  total: number;
  zoomLevel: number;
  panOffset: { x: number; y: number };
  zoomable: boolean;
  isDragging: boolean;
  testId: (suffix: string) => string;
  onLoadStart: () => void;
  onLoaded: () => void;
  onWheel: (event: React.WheelEvent) => void;
  onDoubleClick: () => void;
}

const cursorFor = (zoomLevel: number, zoomable: boolean): string => {
  if (zoomLevel > 1) return 'move';
  return zoomable ? 'zoom-in' : 'default';
};

export const LightboxMedia: FC<LightboxMediaProps> = ({
  item,
  index,
  total,
  zoomLevel,
  panOffset,
  zoomable,
  isDragging,
  testId,
  onLoadStart,
  onLoaded,
  onWheel,
  onDoubleClick,
}) => {
  if (item.type === 'video') {
    return (
      <video
        src={item.src}
        controls
        style={{ maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain' }}
        onLoadStart={onLoadStart}
        onLoadedData={onLoaded}
        aria-label={item.alt || `Video ${index + 1} of ${total}`}
        data-testid={testId('video')}
      />
    );
  }

  return (
    <img
      src={item.src}
      alt={item.alt || `Image ${index + 1} of ${total}`}
      style={{
        // At 1x the image is bounded by the viewport; once zoomed it is allowed
        // to overflow so there is something to pan around.
        maxWidth: zoomLevel === 1 ? '90vw' : 'none',
        maxHeight: zoomLevel === 1 ? '80vh' : 'none',
        transform: `scale(${zoomLevel}) translate(${panOffset.x}px, ${panOffset.y}px)`,
        transformOrigin: 'center',
        cursor: cursorFor(zoomLevel, zoomable),
        transition: isDragging ? 'none' : 'transform 0.2s ease',
        objectFit: 'contain',
      }}
      onLoad={onLoaded}
      onWheel={onWheel}
      onDoubleClick={onDoubleClick}
      draggable={false}
      data-testid={testId('image')}
    />
  );
};
