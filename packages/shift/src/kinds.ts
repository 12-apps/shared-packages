import type { ShiftKind } from './types';

/**
 * The configured kind set, checked once at assembly.
 *
 * A plain `Error` rather than a `ShiftError`: those carry a `ShiftErrorCode`
 * that hosts map onto HTTP responses, and a wiring mistake is not a request
 * outcome. It is also thrown HERE rather than on the first `openShift`, so the
 * stack points at the line that wired the service.
 */
export function requireKinds(kinds: readonly ShiftKind[] | undefined): readonly ShiftKind[] {
  const named = (kinds ?? []).filter((kind) => typeof kind === 'string' && kind.trim() !== '');
  if (named.length === 0) {
    throw new Error(
      'createShiftService: options.kinds must name at least one shift kind. ' +
        'The kinds a host runs are its own vocabulary; this package ships none.',
    );
  }
  return named;
}
