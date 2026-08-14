import type { ComponentType } from 'react';

import type { ImpersonationTenant, PreviewSubject } from '../core/types';

import {
  bindImpersonationBanner,
  type ImpersonationBannerProps,
} from './banner';
import {
  bindImpersonationDialog,
  type ImpersonationAppOption,
  type ImpersonationDialogProps,
} from './dialog';
import type { ImpersonationLabels } from './labels';
import {
  startImpersonation,
  type ImpersonationEndpoints,
  type ImpersonationStartResult,
} from './session-control';
import { httpImpersonationTransport, type ImpersonationTransport } from './transport';

/**
 * The one thing this package exposes to a FRONTEND host.
 *
 * Everything the browser half IS — the bar, its countdown, the chrome offset,
 * the wake-up handling, the exit's ordering, the start handshake and the start
 * dialog — lives inside this package. The host names where the API is mounted,
 * hands over its own words, and says what to do when a session ends. That is the
 * whole wiring.
 */

export interface ImpersonationDialogConfig {
  /** The apps a session may land in, in the order they are offered. */
  apps: readonly ImpersonationAppOption[];
  /**
   * Which of them may be started with WRITES. Required, `[]` included: a default
   * would be one product's policy, and the failure is open.
   */
  writableApps: readonly string[];
  /** Mirrors the server's rule so the refusal lands before the submit. */
  reasonLength: { min: number; max: number };
  /** The tenants the operator may pick from. */
  loadTenants(): Promise<ImpersonationTenant[]>;
  /** The tenant's staff user ids, for the note under the app picker. */
  loadStaff?(tenantSlug: string): Promise<readonly string[]>;
  /** Where a started session lands, in the host's own URL layout. */
  landingUrl(parts: { app: string; tenantSlug: string }): string;
}

export interface ImpersonationWebConfig {
  /** The path the platform session surface is mounted at. */
  platformPath: string;
  /** The tenant preview mount for a slug, in the host's own URL layout. */
  tenantPath(slug: string): string;
  /** How the surface reaches its data. Default: same-origin credentialed fetch. */
  transport?: ImpersonationTransport;
  /** Every word this surface puts on a screen. */
  labels: ImpersonationLabels;
  /**
   * Called after a session ENDS, however it ended — the exit button, the time
   * box closing, another tab, or a tab waking to find the session gone.
   *
   * This is where a host drops its query cache: the identity behind every cached
   * response just changed, so every cached response is now another person's.
   */
  onEnd?(): void;
  /** Told whenever the live session changes — a host tags its error reporter. */
  onSessionChange?(session: {
    impersonating: boolean;
    tenantSlug: string | null;
  }): void;
  /** The start dialog's wiring. Omit it and only the banner is returned. */
  dialog?: ImpersonationDialogConfig;
}

export interface WebImpersonation {
  /**
   * Mount ONCE per app, in the chrome — never per page.
   *
   * It renders nothing when there is no session but STAYS MOUNTED: the start
   * handshake refuses to begin a session in a document with no banner host.
   */
  banner: ComponentType<ImpersonationBannerProps>;
  /**
   * The start dialog, or `null` when {@link ImpersonationWebConfig.dialog} was
   * not configured — an app that only ever WEARS sessions (a storefront) mounts
   * the banner and nothing else.
   */
  dialog: ComponentType<ImpersonationDialogProps> | null;
  /**
   * Start a PREVIEW from the host's own picker.
   *
   * A function rather than a screen, because the picker IS the host's: which
   * roles a tenant has and which of its people may be looked through are its
   * catalogs, and it already renders them. What is not the host's is the start
   * itself — it has to go behind the same banner handshake as every other start,
   * or "if the banner cannot render, the session must not start" would hold for
   * one entry point and not the other.
   *
   * Rethrows the server's refusal untouched, so a caller can render the plan
   * prompt, the permission refusal or "close the open session first" in its own
   * words.
   */
  startPreview(request: {
    tenantSlug: string;
    previewOf: PreviewSubject;
  }): Promise<ImpersonationStartResult>;
}

export function createWebImpersonation(
  config: ImpersonationWebConfig,
): WebImpersonation {
  const endpoints: ImpersonationEndpoints = {
    transport: config.transport ?? httpImpersonationTransport(),
    platformPath: config.platformPath,
    tenantPath: config.tenantPath,
    onEnd: config.onEnd,
  };

  const banner = bindImpersonationBanner({
    endpoints,
    labels: config.labels.banner,
    onSessionChange: config.onSessionChange,
  });

  const startPreview: WebImpersonation['startPreview'] = (request) =>
    startImpersonation(endpoints, {
      path: config.tenantPath(request.tenantSlug),
      body: request.previewOf,
    });

  const dialogLabels = config.labels.dialog;
  const dialogConfig = config.dialog;
  if (!dialogConfig || !dialogLabels) return { banner, dialog: null, startPreview };

  const dialog = bindImpersonationDialog({
    endpoints,
    labels: dialogLabels,
    rules: {
      writableApps: dialogConfig.writableApps,
      reasonLength: dialogConfig.reasonLength,
      labels: dialogLabels,
    },
    apps: dialogConfig.apps,
    loadTenants: dialogConfig.loadTenants,
    loadStaff: dialogConfig.loadStaff,
    landingUrl: dialogConfig.landingUrl,
  });

  return { banner, dialog, startPreview };
}
