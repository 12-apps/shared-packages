import { useCallback, useMemo, useState } from 'react';

export const useVirtualScrolling = (
  data: Record<string, unknown>[],
  rowHeight: number,
  containerHeight: number,
  overscan: number = 5
) => {
  const [scrollTop, setScrollTop] = useState(0);
  
  const visibleItems = useMemo(() => {
    const visibleHeight = containerHeight;
    const startIndex = Math.floor(scrollTop / rowHeight);
    const endIndex = Math.min(
      data.length,
      Math.ceil((scrollTop + visibleHeight) / rowHeight)
    );
    
    const start = Math.max(0, startIndex - overscan);
    const end = Math.min(data.length, endIndex + overscan);
    
    return {
      startIndex: start,
      endIndex: end,
      items: data.slice(start, end),
      totalHeight: data.length * rowHeight,
      offsetY: start * rowHeight,
    };
  }, [data, rowHeight, containerHeight, scrollTop, overscan]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  return { visibleItems, handleScroll };
};

// Responsive Hook
