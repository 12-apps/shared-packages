import inutilize from "./sidecar/inutilize.json";
import inutilizeUsed from "./sidecar/inutilize-used.json";
import nfceCancel from "./sidecar/nfce-cancel.json";
import nfceCancelLate from "./sidecar/nfce-cancel-late.json";
import nfceCancelSubstitution from "./sidecar/nfce-cancel-substitution.json";
import nfceIssue2027 from "./sidecar/nfce-issue-2027.json";
import nfceIssueAuth from "./sidecar/nfce-issue-auth.json";
import nfceIssueAuthorized from "./sidecar/nfce-issue-authorized.json";
import nfceIssueContingency from "./sidecar/nfce-issue-contingency.json";
import nfceIssueDenied from "./sidecar/nfce-issue-denied.json";
import nfceIssueRejected from "./sidecar/nfce-issue-rejected.json";
import nfceIssueRetryable from "./sidecar/nfce-issue-retryable.json";
import nfceIssueUnanswered from "./sidecar/nfce-issue-unanswered.json";
import nfceLookupAuthorized from "./sidecar/nfce-lookup-authorized.json";
import nfceLookupNotFound from "./sidecar/nfce-lookup-not-found.json";
import nfceSignContingency from "./sidecar/nfce-sign-contingency.json";
import nfceTransmitAuthorized from "./sidecar/nfce-transmit-authorized.json";

/**
 * The fiscal service's OWN recorded answers, one per file in `sidecar/`
 * (`sidecar/tests/Support/record-answers.php` regenerates them), by file name.
 * Imported statically so no suite reads the disk: a recording the service adds
 * is listed here to be replayed.
 */
interface RecordedAnswer {
  readonly path: string;
  readonly request: Record<string, unknown>;
  readonly status: number;
  readonly body: unknown;
}

export const RECORDED_ANSWERS: Readonly<Record<string, RecordedAnswer>> = {
  "inutilize": inutilize,
  "inutilize-used": inutilizeUsed,
  "nfce-cancel": nfceCancel,
  "nfce-cancel-late": nfceCancelLate,
  "nfce-cancel-substitution": nfceCancelSubstitution,
  "nfce-issue-2027": nfceIssue2027,
  "nfce-issue-auth": nfceIssueAuth,
  "nfce-issue-authorized": nfceIssueAuthorized,
  "nfce-issue-contingency": nfceIssueContingency,
  "nfce-issue-denied": nfceIssueDenied,
  "nfce-issue-rejected": nfceIssueRejected,
  "nfce-issue-retryable": nfceIssueRetryable,
  "nfce-issue-unanswered": nfceIssueUnanswered,
  "nfce-lookup-authorized": nfceLookupAuthorized,
  "nfce-lookup-not-found": nfceLookupNotFound,
  "nfce-sign-contingency": nfceSignContingency,
  "nfce-transmit-authorized": nfceTransmitAuthorized,
};
