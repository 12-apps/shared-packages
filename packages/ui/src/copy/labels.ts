/**
 * The accessible names and small captions that components without a copy
 * pack of their own used to hard-code in English.
 *
 * Each family is taken by its component as an OPTIONAL prop (`labels`, or a
 * single `…Label` prop where the component renders one word), and the English
 * pack in `en-US.labels.ts` answers for whatever a host leaves out. That keeps
 * every key non-breaking: a host that passes nothing renders exactly what it
 * rendered before these existed, and a pt-BR host passes
 * `UI_LABELS['pt-BR'].<family>`.
 */
import type { DataGridCopy } from './data-display';

/** Words several components share: a busy spinner's name, a close and a delete glyph. */
export interface CommonLabels {
  loading: string;
  close: string;
  delete: string;
}

/** What `Stepper` adds around the host's own step labels. */
export interface StepperLabels {
  /** The step circle's accessible name, from its 1-based position and label. */
  step(position: number, label: string): string;
  optional: string;
  completed: string;
  current: string;
}

/** `Timeline`'s expand toggle and each card's accessible name. */
export interface TimelineLabels {
  expandDetails: string;
  collapseDetails: string;
  item(title: string): string;
}

/** The two stand-in images' `alt`, built from the host's own `alt`. */
export interface LazyImageLabels {
  loadingAlt(alt: string): string;
  fallbackAlt(alt: string): string;
}

/** The line under the toasts when more are queued than fit. */
export interface SonnerLabels {
  hiddenCount(count: number): string;
}

/** `RichTextEditor`'s toolbar tooltips, prompts, placeholder and accessible name. */
export interface RichTextEditorLabels {
  placeholder: string;
  ariaLabel: string;
  /** The text a new list starts with when nothing is selected. */
  listItem: string;
  bold: string;
  italic: string;
  underline: string;
  strikethrough: string;
  numberedList: string;
  bulletedList: string;
  insertLink: string;
  insertImage: string;
  codeBlock: string;
  quote: string;
  linkPrompt: string;
  imagePrompt: string;
}

/** `Table`'s sort buttons and selection checkboxes. */
export type TableLabels = Pick<DataGridCopy, 'sortBy' | 'selectRow' | 'selectAllRows'>;

/** `Code`'s copy button, before and right after a copy. */
export interface CodeLabels {
  copy: string;
  copied: string;
}

/** `ViewSelector`'s two options and `FilterTrigger`'s accessible name. */
export interface ContentToolbarLabels {
  gridView: string;
  listView: string;
  openFilters: string;
  closeFilters: string;
}

/** `Dashboard.Breadcrumb`'s landmark name. */
export interface DashboardLabels {
  breadcrumb: string;
}

/** `NavigationMenu`'s collapse control. */
export interface NavigationMenuLabels {
  collapse: string;
  /**
   * The same control's accessible name while the menu is collapsed and shows
   * only its icon. Optional: without it the control is named "Expand".
   */
  expand?: string;
}

/** `WorkflowStep`'s indicator names and its progressbar's value text. */
export interface WorkflowStepLabels {
  step(position: number, title: string): string;
  progress(position: number, total: number): string;
}

/** Every family above, keyed by the component that renders it. */
export interface UiLabels {
  common: CommonLabels;
  stepper: StepperLabels;
  timeline: TimelineLabels;
  lazyImage: LazyImageLabels;
  sonner: SonnerLabels;
  richTextEditor: RichTextEditorLabels;
  table: TableLabels;
  code: CodeLabels;
  contentToolbar: ContentToolbarLabels;
  dashboard: DashboardLabels;
  navigationMenu: NavigationMenuLabels;
  workflowStep: WorkflowStepLabels;
}
