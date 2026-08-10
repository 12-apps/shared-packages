import type { SizeValue } from '../../../tokens/scales';
/** One selectable option: a stable `value` and its human `label`. */
export interface CreatableSelectOption {
  value: string;
  label: string;
  /**
   * Nesting level for a hierarchical list (0 = top level), rendered as INDENT on
   * the dropdown row only. Callers used to bake the indent into `label`
   * ("— Chocolate"), which then travelled everywhere the label goes: the closed
   * field, the search text, and whatever else reads the selected option's label.
   * Keeping it a separate number leaves `label` the category's actual name.
   */
  depth?: number;
}

export interface CreatableSelectProps {
  /** The available options to search/select. */
  options: CreatableSelectOption[];
  /** The selected option's `value`, or `null`/`""` when nothing is selected. */
  value: string | null;
  /** Fired with the chosen option's `value`, or `null` when cleared. */
  onChange: (value: string | null) => void;
  /**
   * Enables "create on Enter": when the typed text matches no option and this is
   * provided, a "create" row appears and choosing it (Enter) calls `onCreate`
   * with the raw typed label. Omit to make the field a plain searchable select.
   */
  onCreate?: (label: string) => void | Promise<void>;
  /** Field label, rendered above the control (matching the other form fields). */
  label?: string;
  /** Validation error message; also flags the label/border as errored. */
  error?: string;
  /** Placeholder shown when empty. */
  placeholder?: string;
  /** Builds the create-row label from the typed text (default: `Criar "<text>"`). */
  createOptionLabel?: (input: string) => string;
  /** Text shown when no option matches and creation is disabled. */
  noOptionsText?: string;
  disabled?: boolean;
  /** Shows a spinner in the adornment (e.g. while a create request is in flight). */
  loading?: boolean;
  /** Stretch to the container width (default: true). */
  fullWidth?: boolean;
  /**
   * Control height, matching {@link Input}'s scale so the two line up when they
   * share a grid row (default: `md`).
   */
  size?: SizeValue;
  /** Base test id; the input is `<dataTestId>-input`. */
  dataTestId?: string;
}
