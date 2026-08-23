import type { CSSProperties } from 'react';
import type { LightboxCopy } from '../../../copy';

export interface LightboxItem {
  src: string;
  alt?: string;
  caption?: string;
  type?: 'image' | 'video';
}

export interface AutoplayConfig {
  interval?: number;
}

export interface LightboxProps {
  /**
   * Every word this viewer renders — all of them aria-labels on glyph-only
   * controls, so this object IS what a screen-reader user hears for the whole
   * component. REQUIRED: a default could only be one language read aloud to
   * everybody else's users, and the sighted path looks identical either way,
   * which is why the English literals survived so long.
   */
  copy: LightboxCopy;
  /** Controls visibility; must lock body scroll when true */
  isOpen: boolean;
  /** Fired on close button, backdrop click, Esc, and swipe-down (mobile) */
  onClose: () => void;
  /** Gallery items; mixed media supported */
  items?: LightboxItem[];
  /** Initial active item index (clamped to bounds) */
  startIndex?: number;
  /** Toggles Next/Prev controls and keyboard arrows */
  showControls?: boolean;
  /** Renders caption below media if present */
  showCaptions?: boolean;
  /** Wrap navigation at edges */
  loop?: boolean;
  /** Auto-advance; default interval 4000ms when true. Pauses on hover/focus */
  autoplay?: boolean | AutoplayConfig;
  /** Shows filmstrip for quick navigation */
  thumbnails?: boolean;
  /** Enable pinch/scroll zoom, drag pan, double-tap reset */
  zoomable?: boolean;
  /** Style extension hook for container */
  className?: string;
  /** Inline styles */
  style?: CSSProperties;
  /** Optional test ID for automated testing */
  dataTestId?: string;
}

export interface LightboxRef {
  open: (index?: number) => void;
  close: () => void;
  next: () => void;
  prev: () => void;
  goTo: (index: number) => void;
}
