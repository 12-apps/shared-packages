'use client';

/**
 * The "o que você precisa comprar?" form. One primary action; quantity and
 * region refine the ranking (totals and, later, freight) but never block a
 * search. Submits through the injected client and hands the caller the
 * requestId — navigation is the host's business.
 */
import { useState, type JSX } from 'react';

import { Alert } from '@12-apps/ui/data-display/Alert';
import { Button } from '@12-apps/ui/form/Button';
import { Input } from '@12-apps/ui/form/Input';
import { Grid2 } from '@12-apps/ui/mui/Grid2';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import type { ResearchApiClient } from './client';
import { resolveMessages, type ResearchMessages } from './messages';

export interface ResearchFormProps {
  client: ResearchApiClient;
  /** Called with the accepted request — the host navigates to its screen. */
  onStarted: (requestId: string) => void;
  /** Pre-filled CEP (e.g. the tenant's address); the buyer can change it. */
  defaultRegion?: string;
  /** Pre-filled search (e.g. a low-stock deep link). */
  defaultTerm?: string;
  /** Pre-filled quantity (e.g. the gap to the restock level). */
  defaultQuantity?: number;
  /** Every string this screen renders — the HOST's words (see `./messages`). */
  messages: ResearchMessages;
}

interface FormValues {
  term: string;
  brand: string;
  quantity: string;
  region: string;
}

/** The four inputs; layout only — state stays with the form. */
function FormFields({
  values,
  onChange,
  t,
}: {
  values: FormValues;
  onChange: (field: keyof FormValues, value: string) => void;
  t: ResearchMessages;
}): JSX.Element {
  return (
    <Grid2 container spacing={2}>
      <Grid2 size={{ xs: 12, sm: 6 }}>
        <Input
          label={t.formTermLabel}
          placeholder={t.formTermPlaceholder}
          value={values.term}
          onChange={(event) => onChange('term', event.target.value)}
          fullWidth
          data-testid="research-term"
        />
      </Grid2>
      <Grid2 size={{ xs: 12, sm: 6 }}>
        <Input
          label={t.formBrandLabel}
          value={values.brand}
          onChange={(event) => onChange('brand', event.target.value)}
          fullWidth
          data-testid="research-brand"
        />
      </Grid2>
      <Grid2 size={{ xs: 6, sm: 3 }}>
        <Input
          label={t.formQuantityLabel}
          type="number"
          value={values.quantity}
          onChange={(event) => onChange('quantity', event.target.value)}
          fullWidth
          data-testid="research-quantity"
        />
      </Grid2>
      <Grid2 size={{ xs: 6, sm: 3 }}>
        <Input
          label={t.formRegionLabel}
          value={values.region}
          onChange={(event) => onChange('region', event.target.value)}
          fullWidth
          data-testid="research-region"
        />
      </Grid2>
    </Grid2>
  );
}

/** Trimmed, defaulted query from the raw form values. */
function toQuery(values: FormValues): {
  term: string;
  brand: string | undefined;
  quantity: number;
  region: string | undefined;
} {
  const quantity = Number.parseInt(values.quantity, 10);
  return {
    term: values.term.trim(),
    brand: values.brand.trim() === '' ? undefined : values.brand.trim(),
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    region: values.region.trim() === '' ? undefined : values.region.trim(),
  };
}

export function ResearchForm({
  client,
  onStarted,
  defaultRegion,
  defaultTerm,
  defaultQuantity,
  messages,
}: ResearchFormProps): JSX.Element {
  const t = resolveMessages(messages);
  const [values, setValues] = useState<FormValues>({
    term: defaultTerm ?? '',
    brand: '',
    quantity: defaultQuantity !== undefined && defaultQuantity > 0 ? String(defaultQuantity) : '1',
    region: defaultRegion ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    const query = toQuery(values);
    if (query.term.length < 2) {
      setError(t.formTermRequired);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const started = await client.startResearch(query);
      onStarted(started.requestId);
    } catch (caught) {
      setBusy(false);
      setError(caught instanceof Error ? caught.message : t.formStartFailed);
    }
  };

  return (
    <Stack
      spacing={2}
      component="form"
      onSubmit={(event: React.FormEvent) => {
        event.preventDefault();
        void submit();
      }}
      data-testid="research-form"
    >
      <Text variant="heading" as="h2" size="md">
        {t.formTitle}
      </Text>
      <FormFields
        values={values}
        onChange={(field, value) => setValues((current) => ({ ...current, [field]: value }))}
        t={t}
      />
      {error && <Alert variant="danger" title={error} data-testid="research-form-error" />}
      <Stack direction="row">
        <Button type="submit" disabled={busy} dataTestId="research-submit">
          {busy ? t.formSubmitBusy : t.formSubmit}
        </Button>
      </Stack>
    </Stack>
  );
}
