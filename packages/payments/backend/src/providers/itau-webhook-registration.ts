import { ProviderRequestError } from '../core/errors';
import type { ProbeCheck, ResolvedCredentials } from '../core/types';
import type { ItauCopy } from './copy';
import type { itauSession } from './itau-http';

type ItauCall = Awaited<ReturnType<typeof itauSession>>;

interface ItauWebhook {
  webhookUrl?: string;
}

/**
 * 4xx statuses on the registration that are NOT about the key: "try again
 * later" (408, 425, 429), and an application without the webhook scope or a
 * token Itaú would not take for this call (401, 403) — a red Pix key box would
 * blame a key that is fine.
 */
const NOT_ABOUT_THE_KEY = new Set([401, 403, 408, 425, 429]);

/**
 * Register the store's webhook for its Pix key — BACEN's
 * `PUT /webhook/{chave}` — once the token mint has proven the credentials, so
 * the owner never has to ask the bank for it. BACEN posts to
 * `{webhookUrl}/pix`, which the host serves beside the URL it hands us.
 *
 * **Never over another system's webhook.** BACEN keeps ONE webhook per key and
 * a PUT replaces it, so a key already notifying an ERP or a reconciliation
 * tool would silently stop doing so on every "Testar conexão". The current
 * registration is read first (`GET /webhook/{chave}`): none, or already ours,
 * and we register; anything else is left alone and named to the owner.
 *
 * Reported as a check on the Pix key, never as the probe's verdict: a store
 * whose webhook is missing still takes payments (the checkout and the sweep
 * find them, later), so nothing here may turn good credentials red. `FAIL` is
 * kept for Itaú refusing the KEY on the PUT — the one case where the box it
 * marks is where the owner has to look. A failed lookup, an outage, a scope or
 * auth refusal and a foreign webhook are all `UNCHECKED`.
 *
 * A URL WE registered under an older address (a renamed store slug, another
 * origin) reads as foreign and is left alone too: the package cannot tell the
 * host's old routes from another system's, and leaving it is the safe error.
 *
 * The URL is the host's (`notificationUrl`, resolved per probe and never
 * stored — `config/verify.ts`); without one there is nothing to register.
 */
export async function itauWebhookCheck(
  call: ItauCall,
  credentials: ResolvedCredentials,
  copy: ItauCopy,
): Promise<ProbeCheck> {
  const webhookUrl = credentials.fields['notificationUrl']?.trim();
  if (!webhookUrl) return unchecked(copy.webhook.notRegistered);
  const path = `/webhook/${encodeURIComponent(credentials.fields['pixKey'] ?? '')}`;
  let current: string | null;
  try {
    current = await currentWebhook(call, path);
  } catch {
    // The lookup failing says nothing about the KEY, and nothing may be
    // written over a webhook we could not see.
    return unchecked(copy.webhook.unreachable);
  }
  if (current === webhookUrl) return { key: 'pixKey', status: 'PASS', message: copy.webhook.registered };
  if (current) return unchecked(`${copy.webhook.elsewhere} ${current}`);
  try {
    await call<unknown>('pix/webhook', path, { method: 'PUT', json: { webhookUrl } });
    return { key: 'pixKey', status: 'PASS', message: copy.webhook.registered };
  } catch (error) {
    return refusedKey(error)
      ? { key: 'pixKey', status: 'FAIL', message: copy.webhook.refused }
      : unchecked(copy.webhook.unreachable);
  }
}

/** The URL the key notifies today, or null when it has none (BACEN answers 404). */
async function currentWebhook(call: ItauCall, path: string): Promise<string | null> {
  try {
    const registered = await call<ItauWebhook>('pix/webhook', path, { method: 'GET' });
    return registered.webhookUrl?.trim() || null;
  } catch (error) {
    if (error instanceof ProviderRequestError && error.options.httpStatus === 404) return null;
    throw error;
  }
}

function refusedKey(error: unknown): boolean {
  const status = error instanceof ProviderRequestError ? error.options.httpStatus : undefined;
  return status !== undefined && status >= 400 && status < 500 && !NOT_ABOUT_THE_KEY.has(status);
}

/**
 * The stub-mode answer: what a registration that went through would say, so a
 * stubbed store shows the screen a live one does — and registers nothing.
 */
export function itauStubWebhookCheck(credentials: ResolvedCredentials, copy: ItauCopy): ProbeCheck {
  return credentials.fields['notificationUrl']?.trim()
    ? { key: 'pixKey', status: 'PASS', message: copy.webhook.registered }
    : unchecked(copy.webhook.notRegistered);
}

function unchecked(message: string): ProbeCheck {
  return { key: 'pixKey', status: 'UNCHECKED', message };
}
