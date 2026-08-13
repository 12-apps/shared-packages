import type { NotificationsApiClient } from './api';

/**
 * The browser half of Web Push: register the service worker, ask permission,
 * subscribe with the deployment's VAPID public key (read from the packaged
 * `GET <mount>/push-subscriptions`) and persist the subscription so the
 * WEB_PUSH transport can reach this browser.
 *
 * A preference alone cannot reach a device that never subscribed, which is why
 * this ships with the preferences screen rather than being left to the host.
 * The one thing that IS the host's is the service-worker path — path-routed SPAs
 * each control their own scope, and the file itself lives in the host's public
 * directory.
 */

/** Why enabling push failed, mapped to a user-facing hint by the caller. */
export type PushSetupResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'unconfigured' | 'permission-denied' | 'error' };

/** `PushManager.subscribe` needs the VAPID key as a Uint8Array. */
function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replaceAll('-', '+').replaceAll('_', '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export function pushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Whether this browser currently holds an active push subscription. */
export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

/** Register the SW and return this browser's (possibly new) subscription. */
async function obtainSubscription(
  swPath: string,
  vapidPublicKey: string,
): Promise<PushSubscription> {
  const registration = await navigator.serviceWorker.register(swPath);
  await navigator.serviceWorker.ready;
  return (
    (await registration.pushManager.getSubscription()) ??
    registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(vapidPublicKey) as BufferSource,
    })
  );
}

/**
 * Full enable flow: configured? → permission → SW registration → subscribe →
 * persist. Idempotent — an existing subscription is simply re-persisted (the
 * server upserts on the endpoint).
 */
/** Persist the browser's subscription server-side (upsert on the endpoint). */
async function persist(
  api: NotificationsApiClient,
  subscription: PushSubscription,
): Promise<PushSetupResult> {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    return { ok: false, reason: 'error' };
  }
  const saved = await api.savePushSubscription({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  });
  return saved.ok ? { ok: true } : { ok: false, reason: 'error' };
}

export async function enableWebPush(
  api: NotificationsApiClient,
  swPath = '/sw.js',
): Promise<PushSetupResult> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };

  const registration = await api.getPushRegistration().catch(() => null);
  if (!registration?.vapidPublicKey) return { ok: false, reason: 'unconfigured' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'permission-denied' };

  try {
    return await persist(
      api,
      await obtainSubscription(swPath, registration.vapidPublicKey),
    );
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/** Disable flow: unsubscribe the browser and drop the server-side row. */
export async function disableWebPush(api: NotificationsApiClient): Promise<void> {
  const subscription = await getExistingPushSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe().catch(() => false);
  await api.removePushSubscription(endpoint).catch(() => undefined);
}
