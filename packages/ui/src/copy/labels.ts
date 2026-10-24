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

/**
 * `ViewSelector`'s two options, `FilterTrigger`'s accessible name and visible
 * label, and `MultiSelectDropdown`'s "everything" option, search box and empty
 * list.
 */
export interface ContentToolbarLabels {
  gridView: string;
  listView: string;
  openFilters: string;
  closeFilters: string;
  filters: string;
  all: string;
  search: string;
  noResults: string;
}

/** `Dashboard.Breadcrumb`'s landmark name and `Dashboard.MoreFilters`' toggle. */
export interface DashboardLabels {
  breadcrumb: string;
  moreFilters: string;
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

/** `AlertDialog`'s two buttons, when the host names neither. */
export interface AlertDialogLabels {
  cancel: string;
  confirm: string;
}

/** `Avatar`'s accessible name when it carries no `alt` and no `aria-label`. */
export interface AvatarLabels {
  name: string;
}

/** `EmptyState`'s two built-in actions. */
export interface EmptyStateLabels {
  refresh: string;
  create: string;
}

/** `ErrorState`'s retry button. */
export interface ErrorStateLabels {
  retry: string;
}

/** `LoadingState`'s accessible name while it shows no `message`, per variant. */
export interface LoadingStateLabels {
  skeleton: string;
  spinner: string;
}

/** `StackedModal`'s line while a panel loads. */
export interface StackedModalLabels {
  loading: string;
}

/** `Command`'s search box, its empty list and its busy line. */
export interface CommandLabels {
  placeholder: string;
  empty: string;
  loading: string;
}

/** `FormErrorSnackbar`'s sentence when the form names none. */
export interface FormErrorSnackbarLabels {
  message: string;
}

/** `ColumnsMenu`'s heading and its trigger's accessible name. */
export interface ColumnsMenuLabels {
  title: string;
  toggle: string;
}

/** `Drawer`'s close button. */
export interface DrawerLabels {
  close: string;
}

/** `SettingsLayout`'s navigation name (when its title is not text), search and back control. */
export interface SettingsLayoutLabels {
  navigation: string;
  searchPlaceholder: string;
  emptySearch: string;
  back: string;
}

/** `TableFilter`'s landmark name and its keyword box. */
export interface TableFilterLabels {
  filters: string;
  keywordPlaceholder: string;
  keywordLabel: string;
}

/** `AppHeader`'s identity disclosure, named after the host's own title. */
export interface AppHeaderLabels {
  disclose(title: string): string;
}

/** `Breadcrumbs`' landmark name. */
export interface BreadcrumbsLabels {
  navigation: string;
}

/** `AnimatedIcon`'s accessible name, from the animation it plays. */
export interface AnimatedIconLabels {
  name(variant: string): string;
}

/** `InfiniteScroll`'s default error, when the failure carries no message. */
export interface InfiniteScrollLabels {
  loadFailed: string;
}

/** `SocialLoginContainer`'s heading. */
export interface SocialLoginLabels {
  title: string;
}

/** `DateRangePicker`'s calendar popover name. */
export interface DateRangePickerLabels {
  calendar: string;
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
  alertDialog: AlertDialogLabels;
  avatar: AvatarLabels;
  emptyState: EmptyStateLabels;
  errorState: ErrorStateLabels;
  loadingState: LoadingStateLabels;
  stackedModal: StackedModalLabels;
  command: CommandLabels;
  formErrorSnackbar: FormErrorSnackbarLabels;
  columnsMenu: ColumnsMenuLabels;
  drawer: DrawerLabels;
  settingsLayout: SettingsLayoutLabels;
  tableFilter: TableFilterLabels;
  appHeader: AppHeaderLabels;
  breadcrumbs: BreadcrumbsLabels;
  animatedIcon: AnimatedIconLabels;
  infiniteScroll: InfiniteScrollLabels;
  socialLogin: SocialLoginLabels;
  dateRangePicker: DateRangePickerLabels;
}
