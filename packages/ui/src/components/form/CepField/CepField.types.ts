/**
 * Types for {@link CepField} — the reusable CEP auto-completer.
 */

/**
 * A resolved CEP.
 *
 * Structurally identical to what the app's `/lookup/cep` endpoint returns, but
 * declared here so the component stays independent of any particular backend:
 * anything that can produce this shape can drive the field.
 *
 * `número` and `complemento` are deliberately absent — no CEP database holds
 * them, so they are always the user's to type.
 */
export interface CepAddress {
  /** The CEP that resolved, bare digits. */
  cep: string;
  /** Logradouro (street name, no number). */
  street: string | null;
  /** Bairro. */
  neighborhood: string | null;
  /** Município. */
  city: string | null;
  /** UF. */
  state: string | null;
}

/** What the field is currently doing, surfaced as a status line. */
export type CepLookupStatus = 'idle' | 'loading' | 'found' | 'notfound';

export interface CepFieldProps {
  /** Current field value. Masked (`01310-100`) or bare — the field re-masks. */
  value: string;
  /**
   * Called on every keystroke with the MASKED value, so the caller's state and
   * what the user sees never diverge.
   */
  onChange: (masked: string) => void;
  /**
   * Resolve a complete CEP to an address, or `null` when it is unknown.
   *
   * Injected rather than hard-wired: the component knows nothing about
   * providers, transport or auth. Omit it to get a masked, validated CEP input
   * with no lookup at all.
   */
  onLookup?: (cep: string) => Promise<CepAddress | null>;
  /**
   * Called once a CEP resolves — this is where the caller fills the address
   * fields. Never called for an incomplete, unchanged or unknown CEP.
   */
  onResolved?: (address: CepAddress) => void;
  /**
   * Called when a COMPLETE CEP fails to resolve (unknown, or every provider
   * down). The counterpart to `onResolved`: a caller that auto-filled from a
   * previous CEP should undo that here, so the form never shows one CEP's
   * street under a different CEP.
   */
  onNotFound?: () => void;
  /** Visible label. Defaults to `CEP`. */
  label?: string;
  /** Placeholder. Defaults to `00000-000`. */
  placeholder?: string;
  /** Validation error from the caller's form, shown below the input. */
  error?: string;
  /** Disables the input and suppresses lookups. */
  disabled?: boolean;
  /** Milliseconds to wait after the last keystroke before looking up. */
  debounceMs?: number;
  /** Field name / input id. Defaults to `postalCode`. */
  name?: string;
  /** Test id for the input. Defaults to `cep-field-<name>`. */
  dataTestId?: string;
}
