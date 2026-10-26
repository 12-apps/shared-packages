import { useState } from "react";

import type { EmailAuthScreenReason } from "./copy";

/** What a form's refusal banner is told: the code, and the password rules behind it. */
export interface RefusalState {
  reason: EmailAuthScreenReason | null;
  violations: readonly string[] | null;
  violationCodes: readonly string[] | null;
}

/** A refusal as the client reports it. */
interface ClientRefusal {
  reason: EmailAuthScreenReason;
  violations?: readonly string[];
  violationCodes?: readonly string[];
}

const NONE: RefusalState = { reason: null, violations: null, violationCodes: null };

/**
 * The refusal a form shows, held as ONE value so the code, the sentences and
 * the codes behind them can never disagree, and so the three forms that show a
 * refusal (sign-up, reset, security card) share the plumbing.
 */
export function useRefusal(): RefusalState & {
  /** Show a refusal the client reported, with its password rules. */
  refuse: (result: ClientRefusal) => void;
  /** Show a refusal that has a code and nothing more to say. */
  refuseWith: (reason: EmailAuthScreenReason) => void;
  /** Take the banner away. */
  clear: () => void;
} {
  const [state, setState] = useState<RefusalState>(NONE);
  return {
    ...state,
    refuse: (result) =>
      setState({
        reason: result.reason,
        violations: result.violations ?? null,
        violationCodes: result.violationCodes ?? null,
      }),
    refuseWith: (reason) => setState({ ...NONE, reason }),
    clear: () => setState(NONE),
  };
}
