import type { TimelineLabels } from '../../../copy/labels';
import type React from 'react';

export interface TimelineItem {
  id: string;
  title: string;
  description?: string;
  timestamp: string;
  icon?: React.ReactNode;
  color?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  expanded?: boolean;
  metadata?: Record<string, string>;
}

export interface TimelineProps {
  items: TimelineItem[];
  variant?: 'default' | 'compact' | 'detailed';
  orientation?: 'vertical' | 'horizontal';
  showConnector?: boolean;
  animated?: boolean;
  alternating?: boolean;
  onItemClick?: (item: TimelineItem) => void;
  /** The expand toggle's and each card's accessible names; the English pack answers for any key left out. */
  labels?: Partial<TimelineLabels>;
}
