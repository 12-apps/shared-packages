import type {
  CredentialFieldSpec,
  MaskedProviderConfig,
  PaymentEnvironment,
  ProviderDescriptor,
} from '@12-apps/payments-backend';

import type { PendingSave } from './ConfirmCredentialSave';

/**
 * The DECISIONS the credential form makes, with no JSX anywhere near them.
 *
 * Each one is a rule about money rather than about layout — is there anything
 * stored to probe, could this value possibly be a real handle, is it changing
 * at all, what does the button commit — and every one of them was learned from
 * a screen that got it wrong. Kept together, and apart from the rendering, so
 * they can be read as the set of rules they are.
 */

/**
 * Is there actually something stored to probe?
 *
 * Read from the SERVER's answer to the save rather than from the form: blank
 * fields are preserved rather than cleared, so what the browser just typed does
 * not describe what is now on record.
 */
export function allRequiredStored(
  descriptor: ProviderDescriptor,
  config: MaskedProviderConfig,
  environment: PaymentEnvironment,
): boolean {
  const stored = config.environments[environment] ?? {};
  return descriptor.credentialSchema
    .filter((spec) => spec.required)
    .every((spec) => stored[spec.key]?.configured === true);
}

/**
 * Does every edited field match the SHAPE its provider declares?
 *
 * Shape only — it cannot know whether an account exists, which is what the
 * probe immediately after the save is for. But `$` followed by a few safe
 * characters is free to check, and it stops the ordinary slips (an e-mail, an
 * `@handle` with no `$`) reaching a confirmation dialog that would then ask the
 * owner to vouch for them.
 */
export function fieldsWellFormed(
  descriptor: ProviderDescriptor,
  values: Record<string, string>,
): boolean {
  return descriptor.credentialSchema.every((spec) => {
    const value = values[spec.key];
    if (!spec.pattern || value === undefined || value === '') return true;
    return new RegExp(spec.pattern).test(value.trim());
  });
}

export function saveLabel(descriptor: ProviderDescriptor): string {
  const required = descriptor.credentialSchema.filter((field) => field.required);
  const only = required.length === 1 ? required[0] : undefined;
  if (!only) return 'Salvar';
  return `Salvar ${only.label.replace(/\s*\([^)]*\)\s*$/, '')}`;
}

/**
 * The stored value of the field a finished step collapses around.
 *
 * Non-secret fields keep their value in `hint` (secrets never leave the
 * server), so a provider whose one credential is a public handle can show it
 * back verbatim — which is the entire content of the summary row.
 *
 * Deliberately narrow: EXACTLY ONE required field, and it must be readable
 * back. A form of four fields does not have a one-line summary, and collapsing
 * it would hide inputs the owner still has to reach — so those providers keep
 * the form they have always had.
 */
export function summaryOf(
  descriptor: ProviderDescriptor,
  config: MaskedProviderConfig | null,
  environment: PaymentEnvironment,
): { spec: CredentialFieldSpec; value: string } | null {
  const required = descriptor.credentialSchema.filter((field) => field.required);
  const spec = required.length === 1 ? required[0] : undefined;
  if (!spec || spec.secret) return null;
  const state = config?.environments[environment]?.[spec.key];
  if (!state?.configured || !state.hint) return null;
  return { spec, value: state.hint };
}

/**
 * Which field, if any, needs reading back before the write.
 *
 * Only when it is actually CHANGING: `confirmOnSave` guards against a wrong
 * value being stored, and re-saving the value already stored cannot introduce
 * one. Confirming a no-op would train the owner to click through the dialog,
 * which is the one way to make it useless.
 */
export function needsConfirmation(
  descriptor: ProviderDescriptor,
  config: MaskedProviderConfig | null,
  environment: PaymentEnvironment,
  values: Record<string, string>,
): PendingSave | null {
  for (const spec of descriptor.credentialSchema) {
    if (!spec.confirmOnSave) continue;
    const next = values[spec.key];
    if (next === undefined || next === '') continue;
    if (next === config?.environments[environment]?.[spec.key]?.hint) continue;
    return { spec, value: next };
  }
  return null;
}

/**
 * Everything the form remembers, and the two writes it can make.
 *
 * Hoisted out of the component so that stays about LAYOUT — which of the two
 * shapes (fields or summary row) is on screen — while this owns the rules that
 * decide it. Splitting the two is also what keeps each inside the size gate.
 */
