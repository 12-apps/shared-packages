import { Box } from "@mui/material";
import type { JSX } from "react";

import { formatCpf, validateCpf } from "../../card";

import type { BuyerField, BuyerInfo } from "./types";
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

/**
 * Per-field error, overlaying any server-flagged error on top of the local format
 * checks — so a failed "pay" attempt highlights the exact input.
 */
function deriveErrors(value: BuyerInfo, fieldError: FieldError): BuyerFieldErrors {
  const override = (field: BuyerField): string | undefined =>
    fieldError?.field === field ? fieldError.message : undefined;
  const localEmail =
    value.email && !EMAIL_PATTERN.test(value.email) ? "E-mail inválido." : undefined;
  return {
    cpf: override("cpf") ?? (value.taxId ? validateCpf(value.taxId) : undefined),
    email: override("email") ?? localEmail,
    name: override("name"),
    phone: override("phone"),
  };
}

/**
 * Buyer contact at checkout. CPF is REQUIRED (PagBank needs it for the charge);
 * name, e-mail and phone are optional and only used for the receipt. A provided
 * e-mail is format-checked. Fully controlled by the parent checkout state.
 */
export function BuyerInfoForm({
  value,
  onChange,
  fieldError,
}: {
  value: BuyerInfo;
  onChange: (buyer: BuyerInfo) => void;
  fieldError?: FieldError;
}): JSX.Element {
  const { Input, Text } = useCheckoutComponents();
  const errors = deriveErrors(value, fieldError ?? null);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Text variant="caption" size="xs" color="secondary" as="p">
        Informe seu CPF (obrigatório para o pagamento). Nome, e-mail e telefone são
        opcionais — usados apenas para o comprovante.
      </Text>

      <Input
        label="CPF"
        type="text"
        inputMode="numeric"
        variant="outlined"
        size="md"
        fullWidth
        required
        autoComplete="off"
        placeholder="000.000.000-00"
        value={value.taxId ?? ""}
        error={Boolean(errors.cpf)}
        helperText={errors.cpf}
        onChange={(event) => onChange({ ...value, taxId: formatCpf(event.target.value) })}
        data-testid="buyer-cpf"
      />

      <OptionalContactFields value={value} onChange={onChange} errors={errors} />
    </Box>
  );
}

/** The optional receipt fields (name / e-mail / phone). */
function OptionalContactFields({
  value,
  onChange,
  errors,
}: {
  value: BuyerInfo;
  onChange: (buyer: BuyerInfo) => void;
  errors: BuyerFieldErrors;
}): JSX.Element {
  const { Input } = useCheckoutComponents();
  return (
    <>
      <Input
        label="Nome"
        type="text"
        variant="outlined"
        size="md"
        fullWidth
        autoComplete="name"
        value={value.name ?? ""}
        error={Boolean(errors.name)}
        helperText={errors.name}
        onChange={(event) => onChange({ ...value, name: event.target.value })}
        data-testid="buyer-name"
      />
      <Input
        label="E-mail"
        type="email"
        variant="outlined"
        size="md"
        fullWidth
        autoComplete="email"
        value={value.email ?? ""}
        error={Boolean(errors.email)}
        helperText={errors.email}
        onChange={(event) => onChange({ ...value, email: event.target.value })}
        data-testid="buyer-email"
      />
      <Input
        label="Telefone"
        type="tel"
        variant="outlined"
        size="md"
        fullWidth
        autoComplete="tel"
        value={value.phone ?? ""}
        error={Boolean(errors.phone)}
        helperText={errors.phone}
        onChange={(event) => onChange({ ...value, phone: event.target.value })}
        data-testid="buyer-phone"
      />
    </>
  );
}
