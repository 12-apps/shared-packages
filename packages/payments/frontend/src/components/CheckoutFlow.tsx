'use client';

import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';

import type { ClientChargeView, CustomerInfo, Money } from '@12-apps/payments-backend';

import { CheckoutPayment, type CheckoutPaymentProps } from './CheckoutPayment';

/**
 * The full plug-and-play checkout: the three-step flow of the buyer-facing
 * screens — Dados (CPF required; name/email/phone optional, "save my data")
 * → Pagamento (method cards, saved cards, pay button — `CheckoutPayment`)
 * → Confirmação. The host supplies cart totals, prefilled customer data,
 * saved cards, and reacts to `onCustomerConfirmed` / `onPaid`.
 */
export interface CheckoutFlowProps
  extends Omit<CheckoutPaymentProps, 'customer' | 'onPaid'> {
  initialCustomer?: Partial<CustomerInfo>;
  /** Default state of the "save my data for next time" checkbox. */
  saveDataDefault?: boolean;
  /** Fired when the buyer completes step 1 (persist profile if saveData). */
  onCustomerConfirmed?: (customer: CustomerInfo, saveData: boolean) => void;
  onPaid?: (charge: ClientChargeView) => void;
  /** e.g. "1 item" — shown next to the total in the footer. */
  itemsLabel?: string;
}

const STEPS = ['Dados', 'Pagamento', 'Confirmação'];

/** CPF: 11 digits (checksum stays server/provider-side; this is UX-level). */
function cpfDigits(value: string): string {
  return value.replace(/\D/g, '');
}

interface CustomerStepProps {
  amount: Money;
  itemsLabel?: string;
  initial: Partial<CustomerInfo>;
  saveDataDefault: boolean;
  onContinue: (customer: CustomerInfo, saveData: boolean) => void;
}

function CustomerStep({ amount, itemsLabel, initial, saveDataDefault, onContinue }: CustomerStepProps) {
  const [taxId, setTaxId] = useState(initial.taxId ?? '');
  const [name, setName] = useState(initial.name ?? '');
  const [email, setEmail] = useState(initial.email ?? '');
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [saveData, setSaveData] = useState(saveDataDefault);
  const [touched, setTouched] = useState(false);
  const cpfInvalid = cpfDigits(taxId).length !== 11;

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Informe seu CPF (obrigatório para o pagamento). Nome, e-mail e telefone são opcionais —
        usados apenas para o comprovante.
      </Typography>
      <TextField
        size="small"
        label="CPF"
        required
        value={taxId}
        error={touched && cpfInvalid}
        helperText={touched && cpfInvalid ? 'Informe um CPF com 11 dígitos.' : undefined}
        onBlur={() => setTouched(true)}
        onChange={(e) => setTaxId(e.target.value)}
      />
      <TextField size="small" label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
      <TextField size="small" label="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
      <TextField size="small" label="Telefone" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <FormControlLabel
        control={<Checkbox checked={saveData} onChange={(_, v) => setSaveData(v)} />}
        label="Salvar meus dados para a próxima compra"
      />
      <Stack direction="row" spacing={2} alignItems="center">
        <Typography variant="body2" color="text.secondary">
          {itemsLabel ? `Total · ${itemsLabel} — ` : 'Total: '}
          {(amount.amountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: amount.currency })}
        </Typography>
        <Button
          variant="contained"
          fullWidth
          disabled={cpfInvalid}
          onClick={() => onContinue({ name, email, taxId: cpfDigits(taxId), phone }, saveData)}
        >
          Continuar
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary" textAlign="right">
        🔒 Pagamento seguro
      </Typography>
    </Stack>
  );
}

export function CheckoutFlow(props: CheckoutFlowProps) {
  const {
    initialCustomer = {},
    saveDataDefault = true,
    onCustomerConfirmed,
    onPaid,
    itemsLabel,
    ...payment
  } = props;
  const [step, setStep] = useState(0);
  const [customer, setCustomer] = useState<CustomerInfo | null>(null);
  const [paid, setPaid] = useState<ClientChargeView | null>(null);

  return (
    <Stack spacing={3}>
      <Stepper activeStep={step} alternativeLabel>
        {STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {step === 0 ? (
        <CustomerStep
          amount={payment.amount}
          itemsLabel={itemsLabel}
          initial={initialCustomer}
          saveDataDefault={saveDataDefault}
          onContinue={(confirmed, saveData) => {
            setCustomer(confirmed);
            onCustomerConfirmed?.(confirmed, saveData);
            setStep(1);
          }}
        />
      ) : null}

      {step === 1 && customer ? (
        <Stack spacing={1}>
          <Button size="small" sx={{ alignSelf: 'flex-start' }} onClick={() => setStep(0)}>
            ← Voltar
          </Button>
          <CheckoutPayment
            {...payment}
            customer={customer}
            onPaid={(charge) => {
              setPaid(charge);
              setStep(2);
              onPaid?.(charge);
            }}
          />
        </Stack>
      ) : null}

      {step === 2 && paid ? (
        <Alert severity="success">
          Pagamento confirmado — {paid.provider} · {paid.providerChargeId}
        </Alert>
      ) : null}
    </Stack>
  );
}
