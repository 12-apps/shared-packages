import type { TimingDiagramCopy } from '../../../copy';
// Types
export interface TimingData {
  dns?: number;
  connect?: number;
  ssl?: number;
  request?: number;
  response?: number;
  total: number;
}

export interface TimingDiagramProps {
  /** The region's accessible name and its visible heading. REQUIRED. */
  copy: TimingDiagramCopy;
  data: TimingData;
  showLabels?: boolean;
  color?: string;
  height?: number;
  animated?: boolean;
  showTooltips?: boolean;
  variant?: 'waterfall' | 'stacked' | 'horizontal';
}
