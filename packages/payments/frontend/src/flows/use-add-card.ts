/**
 * The add-card state machine (FUT-183) — the buyer half of the FUT-478 vault
 * surface: `POST /cards/begin` equips this browser, the shared card form and
 * tokenizer mint the instrument, `POST /cards/complete` stores it and answers
 * display metadata. Extracted from the view for the same reason
 * `use-card-checkout.ts` is: the screen stays presentational, and a story can
 * stage any phase by building a {@link AddCardController} literal.
 *
 * What never appears here is as deliberate as what does:
 *
 *   - no ownership facts. `reference`/`customerRef` are the HOST's answer to
 *     the mount's vault port; the browser contributes only the session it was
 *     handed and the token it minted.
 *   - no vault token on the way back. `complete` answers display metadata
 *     only, and that is all the saved phase holds.
 */
import {
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import {
  detectBrand,
  onlyDigits,
  tokenizeForCheckout,
  validateCardNumber,
  validateCvv,
  validateExpiry,
  validateHolder,
  type CardBrand,
  type CardDetails,
  type CardFieldErrors,
  type CardTokenizationConfig,
} from "../card";
import type {
  BuyerVaultSession,
  VaultedCardDisplay,
} from "../components/checkout/transport";
import type { CheckoutProviderConfig } from "../components/checkout/types";
import type { Result } from "../result";

import { useResolvedConfig, type FlowsRuntime } from "./runtime";

const EMPTY_CARD: CardDetails = { number: "", holder: "", expiry: "", cvv: "" };

/** Where the add-card flow is, from first paint to a card on file. */
export type AddCardPhase =
  | { kind: "preparing" }
  /** `begin` refused — a state the buyer cannot fix, said plainly. */
  | { kind: "unavailable"; message: string }
  | { kind: "form"; session: BuyerVaultSession }
  | { kind: "saved"; display: VaultedCardDisplay };

/** Everything the add-card view renders. A story stages one as a literal. */
export interface AddCardController {
  phase: AddCardPhase;
  card: CardDetails;
  setCard: Dispatch<SetStateAction<CardDetails>>;
  fieldErrors: CardFieldErrors;
  setFieldErrors: Dispatch<SetStateAction<CardFieldErrors>>;
  brand: CardBrand;
  /** A tokenize + complete round trip is in flight. */
  saving: boolean;
  /** The refusal the buyer reads — the endpoint's own reason, form kept editable. */
  error: string | null;
  submit(): Promise<void>;
}

/**
 * Word a refused `begin`. `VAULT_NOT_ENABLED` is the mount's machine-level
 * convention (a deliberately English sentence — a host wiring gap no buyer can
 * fix), so the factory's own pt-BR stands in for it; every other refusal
 * (`PAYMENT_NOT_CONFIGURED`, a transport failure) already carries the pt-BR
 * message the host's copy table worded.
 */
function beginRefusalMessage(
  runtime: FlowsRuntime,
  refusal: { error: string; code?: string },
): string {
  return refusal.code === "VAULT_NOT_ENABLED" ? runtime.copy.addCardUnavailable : refusal.error;
}

/**
 * The tokenization triple for THIS vault session. Provider and key come from
 * the `begin` answer — the session's own facts. The stub grant does not travel
 * on it: `GET /config` is the ONLY sanctioned source for `mockTokenization`
 * (FUT-697), so it is read off the published chain entry for the session's
 * provider, and absent that, off the config head. No config ⇒ no grant.
 */
function sessionTokenization(
  session: BuyerVaultSession,
  config: CheckoutProviderConfig | null,
): CardTokenizationConfig {
  const link = config?.chain?.find((entry) => entry.provider === session.provider);
  const mockTokenization =
    link?.mockTokenization ??
    (config?.provider === session.provider ? config.mockTokenization : false);
  return { provider: session.provider, publicKey: session.publicKey, mockTokenization };
}

/** Fetch the vault session once on mount; the phases follow the answer. */
function useVaultSession(runtime: FlowsRuntime): {
  phase: AddCardPhase;
  setPhase: Dispatch<SetStateAction<AddCardPhase>>;
} {
  const [phase, setPhase] = useState<AddCardPhase>({ kind: "preparing" });
  useEffect(() => {
    let active = true;
    void runtime.client.beginVault().then((result: Result<BuyerVaultSession>) => {
      if (!active) return;
      if (!result.ok) {
        setPhase({ kind: "unavailable", message: beginRefusalMessage(runtime, result) });
        return;
      }
      setPhase({ kind: "form", session: result.data });
    });
    return () => {
      active = false;
    };
  }, [runtime]);
  return { phase, setPhase };
}

/**
 * The add-card flow: begin → (buyer types) → tokenize → complete → saved.
 *
 * A refused `complete` sets {@link AddCardController.error} and stays on the
 * form — the endpoint's reason is the buyer's cue to fix the card, and wiping
 * their input to say it would be the screen working against them.
 */
export function useAddCard(
  runtime: FlowsRuntime,
  onSaved?: (display: VaultedCardDisplay) => void,
): AddCardController {
  const { config } = useResolvedConfig(runtime);
  const { phase, setPhase } = useVaultSession(runtime);
  const [card, setCard] = useState<CardDetails>(EMPTY_CARD);
  const [fieldErrors, setFieldErrors] = useState<CardFieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const brand = detectBrand(onlyDigits(card.number));

  const fieldCopy = runtime.copy.views.screens.card.fields;
  const validate = (): CardFieldErrors => ({
    number: validateCardNumber(card.number, fieldCopy),
    holder: validateHolder(card.holder, fieldCopy),
    expiry: validateExpiry(card.expiry, fieldCopy),
    cvv: validateCvv(card.cvv, fieldCopy, brand),
  });

  const submit = async (): Promise<void> => {
    if (phase.kind !== "form" || saving) return;
    setError(null);
    const errors = validate();
    setFieldErrors(errors);
    if (Object.values(errors).some(Boolean)) return;

    setSaving(true);
    const minted = await tokenizeForCheckout(
      card,
      sessionTokenization(phase.session, config),
      runtime.copy.views.screens.card,
    );
    if (!minted.ok) {
      setError(minted.error);
      setSaving(false);
      return;
    }
    // The browser's two legitimate facts, and nothing else: the session it is
    // completing and the instrument it minted. Ownership rides server-side.
    const completed = await runtime.client.completeVault({
      ...(phase.session.sessionId ? { sessionId: phase.session.sessionId } : {}),
      token: minted.data.token,
    });
    setSaving(false);
    if (!completed.ok) {
      setError(completed.error);
      return;
    }
    setPhase({ kind: "saved", display: completed.data });
    onSaved?.(completed.data);
  };

  return { phase, card, setCard, fieldErrors, setFieldErrors, brand, saving, error, submit };
}
