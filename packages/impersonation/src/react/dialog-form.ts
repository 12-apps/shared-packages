import type { ImpersonationDialogLabels } from './labels';

/**
 * The start form's rules, with no JSX in them — what a draft has to satisfy
 * before the dialog will send it, and what justification actually reaches the
 * trail.
 *
 * Split from the dialog so the two things worth arguing about — that some apps
 * may never be started with writes, and that a write opt-in carries its OWN
 * justification — are readable without rendering anything.
 */

/** Everything the operator fills in, before it becomes a request body. */
export interface ImpersonationDraft {
  /** The tenant the session is bounded to. Empty means "not chosen". */
  tenantId: string;
  targetApp: string;
  reason: string;
  allowWrites: boolean;
  /** The SEPARATE justification for the write opt-in. */
  writeReason: string;
}

/** The host facts the rules are decided against. */
export interface DialogRules {
  /**
   * Which apps a session may be started with WRITES enabled.
   *
   * A host's own policy, and typically narrower than the API's. The money-path
   * rule already refuses every charge under every kind — but a session in a
   * buyer-facing app with writes enabled could still edit that person's own
   * account, and nobody supporting a shopper needs that.
   */
  writableApps: readonly string[];
  /** Mirrors the server's own rule, so the refusal lands before the submit. */
  reasonLength: { min: number; max: number };
  labels: ImpersonationDialogLabels;
}

/**
 * MAY this session even ask for writes?
 *
 * The screen refuses it TWICE: the opt-in does not exist for an app outside this
 * list, and {@link reviewDraft} blocks the combination even when a caller
 * assembles it directly. That is the difference between a UI that carries the
 * rule and a UI that merely does not offer the mistake.
 */
export function writesAvailableFor(app: string, rules: DialogRules): boolean {
  return rules.writableApps.includes(app);
}

/**
 * The single justification string that reaches the trail.
 *
 * The endpoint takes ONE reason, and a write opt-in answers a different question
 * ("why must this be more than a look?"). The JOINED string is what gets
 * length-checked — see {@link reviewDraft} — because the joined string is what
 * the server validates, not the box the operator typed in.
 */
function composeReason(draft: ImpersonationDraft, rules: DialogRules): string {
  const reason = draft.reason.trim();
  if (!draft.allowWrites) return reason;
  return rules.labels.composeReason({ reason, writeReason: draft.writeReason.trim() });
}

/** What the dialog needs to know about a draft: the text, and what blocks it. */
interface DraftReview {
  /** The composed justification exactly as it would be recorded. */
  reason: string;
  /** The sentence naming the first unmet rule, or `null` when ready to send. */
  blocker: string | null;
}

function firstBlocker(
  draft: ImpersonationDraft,
  reason: string,
  rules: DialogRules,
): string | null {
  const { blockers } = rules.labels;
  const { min, max } = rules.reasonLength;
  if (draft.tenantId === '') return blockers.tenantMissing;
  if (draft.allowWrites && !writesAvailableFor(draft.targetApp, rules)) {
    return blockers.writesUnavailable;
  }
  if (draft.reason.trim().length < min) return blockers.reasonTooShort({ min });
  if (draft.allowWrites && draft.writeReason.trim().length < min) {
    return blockers.writeReasonTooShort({ min });
  }
  if (reason.length > max) return blockers.reasonTooLong({ length: reason.length, max });
  return null;
}

/**
 * Review a draft — first unmet rule wins.
 *
 * One blocker at a time rather than a list: the dialog shows it under the
 * disabled button, and a stack of five sentences on a four-field form reads as
 * failure rather than as guidance.
 */
export function reviewDraft(draft: ImpersonationDraft, rules: DialogRules): DraftReview {
  const reason = composeReason(draft, rules);
  return { reason, blocker: firstBlocker(draft, reason, rules) };
}

/** The body of a start request, as the platform surface takes it. */
interface StartOperatorRequestBody {
  targetUserId: string;
  targetApp: string;
  tenantId: string;
  reason: string;
  allowWrites: boolean;
}

/**
 * The request body for a reviewed draft.
 *
 * Takes the reviewed `reason` rather than re-composing it, so the string that
 * was validated is the string that is sent.
 */
export function toStartBody(
  draft: ImpersonationDraft,
  targetUserId: string,
  reason: string,
  rules: DialogRules,
): StartOperatorRequestBody {
  return {
    targetUserId,
    targetApp: draft.targetApp,
    tenantId: draft.tenantId,
    reason,
    allowWrites: draft.allowWrites && writesAvailableFor(draft.targetApp, rules),
  };
}
