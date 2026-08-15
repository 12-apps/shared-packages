'use client';

import { Alert, Stack } from '@mui/material';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import type {
  CredentialFieldSpec,
  MaskedProviderConfig,
  PaymentEnvironment,
  ProviderDescriptor,
} from '@12-apps/payments-backend';

import type { PaymentsSettingsClient } from '../client';

import { ConfirmCredentialSave, type PendingSave } from './ConfirmCredentialSave';
import { CredentialFields } from './CredentialFieldStack';
import { isConnected } from './connection-state';
import { DoneRow } from './CredentialFields';
import {
  credentialsComplete,
  fieldsWellFormed,
  needsConfirmation,
  summaryOf,
} from './credential-rules';
import { ProbeAlert, ProbeChecklist, type VerifyProbe } from './CredentialFormAlerts';

/**
 * The `authMode: 'credentials'` half of the settings page — a provider whose
 * connection is a FORM, rendered entirely from its `credentialSchema` so
 * adding a vendor changes nothing here.
 *
 * Secrets are WRITE-ONLY: a stored value shows as a `••••1234` hint and is
 * never echoed back, and leaving a field blank PRESERVES what is stored
 * (which is what makes rotating one key without re-typing the others work).
 */

/** Mutation runner shared by save/verify/enable: busy + error + refresh. */
function useSettingsAction(
  onChanged: ((c: MaskedProviderConfig) => void) | undefined,
  onSaved: () => void,
) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Generic in the action's result: `verify` returns a MaskedProviderConfig
  // with the probe outcome attached, and narrowing it here would throw away
  // the only field that reports what the probe actually found.
  const run = useCallback(
    async <T extends MaskedProviderConfig>(
      label: string,
      action: () => Promise<T>,
    ): Promise<T | null> => {
      setBusy(label);
      setError(null);
      try {
        const next = await action();
        onChanged?.(next);
        onSaved();
        return next;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        setBusy(null);
      }
    },
    [onChanged, onSaved],
  );
  return { busy, error, run };
}

interface ProviderFormProps {
  descriptor: ProviderDescriptor;
  config: MaskedProviderConfig | null;
  client: PaymentsSettingsClient;
  /**
   * Which credential set is being edited.
   *
   * Owned by the PANEL, not by this form: the environment tabs sit at the top
   * of the provider's card, above the walkthrough, because the choice frames
   * everything below it — including which step the guide thinks you are on. A
   * selector rendered halfway down, under the stepper it changes the meaning
   * of, reads as a property of the fields rather than of the whole screen.
   */
  environment: PaymentEnvironment;
  /** The owner has reopened a finished step. Owned by the panel — see there. */
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onChanged?: (config: MaskedProviderConfig) => void;
  onSaved: () => void;
  /**
   * The stored credentials were REPLACED — a different account may now be on
   * record.
   *
   * Distinct from `onSaved`, which merely means "refetch". Everything the owner
   * has told us about the OLD account stops applying: "I switched Checkout
   * Integrado on" was a claim about a specific InfinitePay account, and
   * carrying it across to another one is how a store ends up on step 3 with a
   * setting nobody has enabled there. The server already drops what IT knew
   * (`applySaveCredentials` clears the status and the proof); this is the same
   * rule for the one fact the server does not hold.
   */
  onCredentialsReplaced?: () => void;
  /**
   * The walkthrough, given this form's two pieces to place.
   *
   * A render prop rather than a rendered node because the two interleave: the
   * finished credential belongs in the row strip above the open card, and the
   * live field belongs INSIDE it, under the instruction that asks for it. Only
   * this component knows which of the two it currently has.
   */
  renderGuide?: (slots: {
    rows: ReactNode;
    sectionFooter: ReactNode;
    /** The owner reopened a finished step — the guide must go back to it. */
    editing: boolean;
    /**
     * The environment ON SCREEN holds every required credential.
     *
     * Credentials are stored PER environment while `status`, the proof and the
     * walkthrough's stage all describe the ACTIVE one — so a store that
     * connected in Sandbox and then opened the Produção tab was shown a
     * walkthrough reporting steps 1 and 2 done, over an empty field, for an
     * environment that had never been connected at all. On the screen whose
     * subject is which account gets paid, that is the worst possible place to
     * imply work has been done.
     */
    stored: boolean;
    /** Which connection path these steps describe — see `ActivePanelProps`. */
    path: 'oauth' | 'credentials';
  }) => ReactNode;
}

/**
 * "Salvar InfiniteTag", not "Salvar".
 *
 * A provider whose whole connection is one field can name it on the button, and
 * that is worth doing on a step whose entire content is that field: the label
 * then says what is about to be committed rather than merely that something is.
 * Providers with several fields keep the plain verb — naming one of four would
 * be a lie about what the button does.
 */

/**
 * The write, as the backend's preserve/clear/replace contract expects it.
 *
 * Every schema key is named on every save, and a key the owner did not touch
 * arrives as `undefined` — which PRESERVES what is stored. That is what makes
 * rotating one secret without re-typing the others work, and it is the reason
 * the payload is built from the SCHEMA rather than from the typed values.
 */
function savePayload(
  descriptor: ProviderDescriptor,
  environment: PaymentEnvironment,
  values: Record<string, string>,
) {
  return {
    environment,
    fields: Object.fromEntries(
      descriptor.credentialSchema.map((spec) => [spec.key, values[spec.key]]),
    ),
  };
}


/**
 * Switching tabs retires the last verdict AND whatever was half-typed.
 *
 * A Sandbox probe says nothing about Produção, and Produção credentials
 * mid-entry say nothing about Sandbox — carrying either across is how a screen
 * comes to display a green result for the environment it is not looking at, on
 * a page whose subject is which account gets paid.
 */
function useRetireOnEnvironmentChange(
  environment: PaymentEnvironment,
  onEditingChange: (editing: boolean) => void,
  setProbe: (probe: VerifyProbe | null) => void,
  setValues: (values: Record<string, string>) => void,
): void {
  useEffect(() => {
    setProbe(null);
    setValues({});
    onEditingChange(false);
  }, [environment, onEditingChange, setProbe, setValues]);
}

/**
 * The form's memory and its two writes.
 *
 * `nothingEdited` guards the save because saving an untouched form is not a
 * free no-op: `saveCredentials` resets the connection to UNVERIFIED, drops the
 * proof and switches the provider OFF. `complete` answers whether there is
 * enough on record for the probe to be worth running — see
 * `credentialsComplete`, which skips the advanced fields an ordinary store must
 * leave empty.
 */
/** Everything `CredentialFields` needs, without importing the hook itself. */
export type CredentialFormState = ReturnType<typeof useCredentialForm>;

function useCredentialForm(props: ProviderFormProps) {
  const {
    descriptor,
    config,
    client,
    environment,
    editing,
    onEditingChange,
    onChanged,
    onSaved,
    onCredentialsReplaced,
  } = props;
  const [values, setValues] = useState<Record<string, string>>({});
  const [probe, setProbe] = useState<VerifyProbe | null>(null);
  const [pending, setPending] = useState<PendingSave | null>(null);
  const { busy, error, run } = useSettingsAction(onChanged, onSaved);

  const probeNow = () =>
    run('verify', () => client.verify(descriptor.name, environment)).then(
      (verified) => verified && setProbe(verified.probe),
    );

  const save = () =>
    run('save', () => client.saveCredentials(descriptor.name, savePayload(descriptor, environment, values)))
      .then((next) => {
        setPending(null);
        if (!next) return undefined;
        // The verdict described the credentials as they WERE; saving retires
        // it, and so does everything the owner told us about the old account.
        setValues({});
        setProbe(null);
        onEditingChange(false);
        onCredentialsReplaced?.();
        // …and the new ones are tested at once, which is the only moment the
        // probe is useful: it reads STORED credentials, so it has nothing to
        // say until a save has happened.
        //
        // Unless there is nothing to test. A save that CLEARS the field leaves
        // no credential to probe, and asking anyway makes the adapter answer
        // "Handle não configurado" — a store that has entered nothing has not
        // failed at anything; it is simply NÃO VERIFICADO.
        //
        // The same holds one step further along: a set with fields still empty
        // is not a connection yet, and probing it reports the provider's
        // rejection of an incomplete request as a verdict on what the owner
        // typed. Read from `next` — the server's answer — because blank fields
        // PRESERVE what is stored, so the form does not know what is on record.
        return credentialsComplete(descriptor, next, environment, {}) ? probeNow() : undefined;
      });

  useRetireOnEnvironmentChange(environment, onEditingChange, setProbe, setValues);

  return {
    values,
    probe,
    pending,
    busy,
    error,
    masked: config?.environments[environment] ?? {},
    nothingEdited: Object.keys(values).length === 0,
    valid: fieldsWellFormed(descriptor, values),
    complete: credentialsComplete(descriptor, config, environment, values),
    summary: summaryOf(descriptor, config, environment),
    edit: (spec: string, value: string) => {
      setValues((v) => ({ ...v, [spec]: value }));
      setProbe(null); // an edited field retires the last verdict
    },
    /** Ask first when the value decides where the money goes, else just write. */
    requestSave: () => {
      const confirm = needsConfirmation(descriptor, config, environment, values);
      if (confirm) setPending(confirm);
      else void save();
    },
    save: () => void save(),
    cancelSave: () => setPending(null),
    reopen: () => onEditingChange(true),
    verify: () => void probeNow(),
    editing,
  };
}

/**
 * The summary row to show INSTEAD of the fields, or null to show the fields.
 *
 * Four conditions have to hold at once, so they live together rather than as a
 * boolean assembled beside the JSX: there has to be a summarisable value, the
 * probe has to have reached the account with it, and the owner must be neither
 * mid-edit nor holding unsaved changes — collapsing over either of those last
 * two would silently discard what they had typed.
 */
/**
 * Does the environment currently on screen hold every required credential?
 *
 * Read from the MASKED view of that environment specifically — not from
 * `config.status`, which describes the active one and would answer for the
 * other tab.
 */
function storedHere(
  descriptor: ProviderDescriptor,
  masked: Record<string, { configured: boolean } | undefined>,
): boolean {
  return descriptor.credentialSchema
    .filter((spec) => spec.required)
    .every((spec) => masked[spec.key]?.configured === true);
}

function collapsedSummary(
  form: ReturnType<typeof useCredentialForm>,
  connected: boolean,
): { spec: CredentialFieldSpec; value: string } | null {
  if (!form.summary || !connected) return null;
  if (form.editing || !form.nothingEdited) return null;
  return form.summary;
}



/** Verdict keys that name no field, so they have no box to be shown at. */
function unkeyed(descriptor: ProviderDescriptor): (key: string) => boolean {
  const fields = new Set(descriptor.credentialSchema.map((spec) => spec.key));
  return (key: string) => !fields.has(key);
}

export function ProviderForm(props: ProviderFormProps) {
  const { descriptor, config, renderGuide } = props;
  const form = useCredentialForm(props);

  // Step 1 is finished when the credential is stored AND the probe has reached
  // the account with it. Then the fields fold into one legible line: still
  // checkable at a glance, no longer one keystroke from being changed.
  const summary = collapsedSummary(form, isConnected(config));

  const rows = summary ? (
    <DoneRow
      testId="payments-credential-summary"
      label={summary.spec.label}
      value={summary.value}
      mono={summary.spec.mono}
      onEdit={form.reopen}
    />
  ) : null;

  const fields = summary ? null : <CredentialFields descriptor={descriptor} form={form} proven={Boolean(config?.chargeVerifiedAt)} />;

  return (
    <Stack spacing={2}>
      {/* No guide (the host supplied none): the form stands on its own, which
          is what every caller saw before the walkthrough could hold it. */}
      {renderGuide
        ? renderGuide({
            rows,
            sectionFooter: fields,
            editing: form.editing && !summary,
            stored: storedHere(descriptor, form.masked),
            // This branch IS the credentials path: it renders only when the
            // provider has no working connect button, so pasted keys are the
            // only way in.
            path: 'credentials',
          })
        : (rows ?? fields)}

      {form.error ? <Alert severity="error">{form.error}</Alert> : null}
      {form.probe ? (
        <ProbeAlert probe={form.probe} busy={form.busy !== null} onRetry={form.verify} />
      ) : null}
      {/* Only what could NOT be tied to a box. Every verdict carrying a field
          key is rendered at that field now; this keeps the leftovers, which is
          where the UNCHECKED rows live — the half a green result would deny. */}
      {form.probe ? <ProbeChecklist probe={form.probe} only={unkeyed(descriptor)} /> : null}

      <ConfirmCredentialSave
        pending={form.pending}
        busy={form.busy !== null}
        onCancel={form.cancelSave}
        onConfirm={form.save}
      />
    </Stack>
  );
}
