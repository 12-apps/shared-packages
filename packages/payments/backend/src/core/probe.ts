/**
 * What a credential probe answers, and the three shapes its failure comes in.
 *
 * Its own module rather than one more block in `core/types.ts`, which is at
 * its size budget — and because these two types are read together by everyone
 * who touches them: an adapter writing a verdict and a screen deciding what to
 * tell the owner about it.
 */

/**
 * WHY a credential probe failed, in the only three shapes a screen can act on.
 *
 * The distinction is not pedantry, it is what the owner is told to do next.
 * `NOT_FOUND` means the value they typed names no account — go and re-read it.
 * `UNREACHABLE` means we never got an answer, so the value may be perfectly
 * good — wait and ask again. A single "não foi possível conectar, confira as
 * credenciais" served both, and on the second one it accused the owner of a
 * mistake the probe had not established: the credential is already SAVED at
 * that point, so the instruction to go and check it is also the instruction to
 * re-type a value that was right.
 *
 * `REFUSED` is the account answering and saying no (401/403) — a real refusal,
 * neither a typo nor an outage.
 */
export type ProbeFault = 'NOT_FOUND' | 'UNREACHABLE' | 'REFUSED';

/**
 * What {@link PaymentProviderAdapter.verifyCredentials} answers.
 *
 * `message` is the ADAPTER's words, not the host's: only the adapter knows the
 * provider's name, what its screens call the field, and where in its app the
 * owner fixes it. A host that composed this sentence itself could only ever
 * say "o provedor" and "as credenciais".
 */
export interface ProbeOutcome {
  ok: boolean;
  message?: string;
  /** Absent when `ok` — there is nothing to classify about a pass. */
  fault?: ProbeFault;
  /**
   * Per-credential findings, when the adapter can produce them (FUT-796).
   *
   * One boolean is the wrong shape for a connection built from several
   * credentials that fail in different ways. Stripe's probe was a bare
   * `GET /v1/balance`: it authenticated the SECRET KEY and nothing else, so a
   * green "Testar conexão" said nothing about the publishable key the browser
   * tokenizes with or the signing secret that authenticates deliveries — both
   * of which fail later, in front of a buyer, looking like something else.
   *
   * Optional, so an adapter that has one thing to check keeps answering with
   * `ok` alone and every existing screen is unaffected.
   */
  checks?: readonly ProbeCheck[];
}

/**
 * One credential's own verdict inside a probe.
 *
 * `UNCHECKED` is the load-bearing state and the reason this is not a boolean.
 * Some credentials cannot be verified at all — no Stripe endpoint will tell you
 * whether a webhook signing secret is the right one; you find out when a
 * delivery fails to verify. Reporting that as a PASS is a claim nothing
 * established, and as a FAIL it accuses a value that is probably fine. Saying
 * "not checked, and here is why" is the only honest answer, and it is also the
 * useful one: it tells the owner which parts of a green result they may rely on.
 */
export interface ProbeCheck {
  /**
   * The `credentialSchema` key this is about, so a screen can point at the
   * field the owner has to fix rather than at the form.
   */
  key: string;
  status: 'PASS' | 'FAIL' | 'UNCHECKED';
  /** The adapter's words: what was established, or why it could not be. */
  message: string;
}
