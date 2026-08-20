/**
 * The one thing this package exposes to a frontend host (FUT-884).
 *
 * Returns a single component under the name `page`, mirroring the backend
 * half's `routes` (the report-builder convention). The host supplies only
 * what is genuinely its own: how to reach the API, and — for a non-pt-BR
 * host — the copy. Members are component TYPES: the host memoises per config
 * identity, which the wiring consumer's binder does once.
 */

import type { JSX } from "react";

import { FeatureFlagsError } from "../index";
import type { FeatureFlagsApiClient } from "./api";
import { DEFAULT_FEATURE_FLAGS_COPY, type FeatureFlagsCopy } from "./copy";
import { FeatureFlagsPage } from "./page";

export interface FeatureFlagsWebConfig {
  /** The host's authenticated client for the mounted server surface. */
  api: FeatureFlagsApiClient;
  /** Overrides for the pt-BR defaults. */
  copy?: Partial<FeatureFlagsCopy>;
}

export function createWebFeatureFlags(config: FeatureFlagsWebConfig): {
  page: () => JSX.Element;
} {
  if (typeof config.api?.listFlags !== "function") {
    throw new FeatureFlagsError("invalid_config", "api is required — the host's client.");
  }
  const copy: FeatureFlagsCopy = { ...DEFAULT_FEATURE_FLAGS_COPY, ...config.copy };
  const api = config.api;

  function FeatureFlags(): JSX.Element {
    return <FeatureFlagsPage api={api} copy={copy} />;
  }

  return { page: FeatureFlags };
}
