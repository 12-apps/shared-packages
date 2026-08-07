import { Box } from "@mui/material";
import type { JSX } from "react";

import { formatCpf, validateCpf } from "../../card";

import { fieldSatisfied } from "./buyer-fields";
import type { BuyerField, BuyerInfo, CheckoutCustomerField } from "./types";
import { useCheckoutComponents } from "./ui";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A server-flagged field error (which field + message), or null. */
type FieldError = { field: BuyerField; message: string } | null;

interface BuyerFieldErrors {
  cpf?: string;
  email?: string;
  name?: string;
  phone?: string;
}

/** The four inputs this form can render, keyed by the schema's own key. */
const INPUTS = {
  taxId: {
    label: "CPF",
    testId: "buyer-cpf",
    errorKey: "cpf",
    props: {
      type: "text",
      inputMode: "numeric",
      autoComplete: "off",
      placeholder: "000.000.000-00",
    },
  },
  name: { label: "Nome", testId: "buyer-name", errorKey: "name", props: { type: "text", autoComplete: "name" } },
  email: { label: "E-mail", testId: "buyer-email", errorKey: "email", props: { type: "email", autoComplete: "email" } },
  phone: { label: "Telefone", testId: "buyer-phone", errorKey: "phone", props: { type: "tel", autoComplete: "tel" } },
} as const;

type InputKey = keyof typeof INPUTS;

/** The order the inputs are shown in — CPF first, as it always has been. */
const FIELD_ORDER: readonly InputKey[] = ["taxId", "name", "email", "phone"];

/**
 * The contact fields the checkout offers regardless of what any provider asks
 * for: they are the RECEIPT's, not the charge's. A chain that requires none of
 * them still gets them as optional inputs, which is what they have always been.
 */
const RECEIPT_FIELDS: readonly InputKey[] = ["name", "email", "phone"];

/** What the buyer typed for one key. */
function valueOf(buyer: BuyerInfo, key: InputKey): string {
  return buyer[key] ?? "";
}

/**
 * Per-field error, overlaying any server-flagged error on top of the local format
 * checks — so a failed "pay" attempt highlights the exact input.
 */
function deriveErrors(
  value: BuyerInfo,
  fieldError: FieldError,
  required: ReadonlySet<InputKey>,
): BuyerFieldErrors {
  const override = (field: BuyerField): string | undefined =>
    fieldError?.field === field ? fieldError.message : undefined;
  const localEmail =
    value.email && !EMAIL_PATTERN.test(value.email) ? "E-mail inválido." : undefined;
  const missing = (key: InputKey, message: string): string | undefined =>
    required.has(key) && !valueOf(value, key).trim() ? message : undefined;
  return {
    cpf: override("cpf") ?? (value.taxId ? validateCpf(value.taxId) : undefined),
    email: override("email") ?? localEmail ?? missing("email", "E-mail obrigatório."),
    name: override("name") ?? missing("name", "Nome obrigatório."),
    phone: override("phone") ?? missing("phone", "Telefone obrigatório."),
  };
}

/**
 * The instruction line above the inputs, worded from what the chain actually
 * declared. It used to name the CPF unconditionally, which is wrong the moment
 * a store's provider wants something else (or nothing).
 */
function instructionFor(required: ReadonlySet<InputKey>): string {
  const names = FIELD_ORDER.filter((key) => required.has(key)).map((key) =>
    key === "taxId" ? "CPF" : INPUTS[key].label.toLowerCase(),
  );
  if (names.length === 0) {
    return "Nome, e-mail e telefone são opcionais — usados apenas para o comprovante.";
  }
  return (
    `Informe seu ${names.join(", ")} (${names.length === 1 ? "obrigatório" : "obrigatórios"} ` +
    "para o pagamento). Os demais campos são opcionais — usados apenas para o comprovante."
  );
}

/** Which inputs to render, and which of them are required. */
function resolveShape(fields: readonly CheckoutCustomerField[] | undefined): {
  shown: InputKey[];
  required: Set<InputKey>;
} {
  // No declaration reaching this component means the pre-FUT-595 form: CPF
  // required, receipt fields optional. `buyerFieldsFor` degrades the same way,
  // so a caller that derived its fields from a chain lands here too.
  const declared = fields ?? [{ key: "taxId" as const, type: "CPF" as const, required: true }];
  const required = new Set<InputKey>(
    declared.filter((field) => field.required).map((field) => field.key),
  );
  const declaredKeys = new Set<InputKey>(declared.map((field) => field.key));
  const shown = FIELD_ORDER.filter(
    (key) => declaredKeys.has(key) || RECEIPT_FIELDS.includes(key),
  );
  return { shown, required };
}

/** Whether every declared requirement is met — the "Continuar" gate's question. */
export function buyerFormComplete(
  buyer: BuyerInfo,
  fields: readonly CheckoutCustomerField[],
): CheckoutCustomerField | null {
  return fields.find((field) => !fieldSatisfied(field, buyer[field.key])) ?? null;
}

/** One declaration-driven input, rendered through the host's slot. */
function BuyerInput({
  fieldKey,
  value,
  required,
  error,
  onChange,
}: {
  fieldKey: InputKey;
  value: BuyerInfo;
  required: boolean;
  error?: string;
  onChange: (buyer: BuyerInfo) => void;
}): JSX.Element {
  const { Input } = useCheckoutComponents();
  const spec = INPUTS[fieldKey];
  return (
    <Input
      label={spec.label}
      variant="outlined"
      size="md"
      fullWidth
      required={required}
      {...spec.props}
      value={valueOf(value, fieldKey)}
      error={Boolean(error)}
      helperText={error}
      onChange={(event) =>
        onChange({
          ...value,
          // The CPF keeps its progressive mask; everything else is taken as typed.
          [fieldKey]: fieldKey === "taxId" ? formatCpf(event.target.value) : event.target.value,
        })
      }
      data-testid={spec.testId}
    />
  );
}

/**
 * Buyer contact at checkout, with WHICH fields are required decided by the
 * store's provider chain (FUT-595) rather than hard-coded.
 *
 * Passing no `fields` is the pre-FUT-595 form, verbatim: CPF required, name /
 * e-mail / telefone optional and used only for the receipt. That is also what
 * `buyerFieldsFor` produces for a chain that declares nothing, so a caller
 * cannot accidentally land on "ask nothing".
 */
export function BuyerInfoForm({
  value,
  onChange,
  fieldError,
  fields,
}: {
  value: BuyerInfo;
  onChange: (buyer: BuyerInfo) => void;
  fieldError?: FieldError;
  /** The chain's resolved declaration; absent ⇒ CPF-required (never "nothing"). */
  fields?: readonly CheckoutCustomerField[];
}): JSX.Element {
  const { Text } = useCheckoutComponents();
  const { shown, required } = resolveShape(fields);
  const errors = deriveErrors(value, fieldError ?? null, required);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Text variant="caption" size="xs" color="secondary" as="p">
        {instructionFor(required)}
      </Text>

      {shown.map((key) => (
        <BuyerInput
          key={key}
          fieldKey={key}
          value={value}
          required={required.has(key)}
          error={errors[INPUTS[key].errorKey]}
          onChange={onChange}
        />
      ))}
    </Box>
  );
}
